/*
 * Agent Controller - Orchestrates AI interactions and command execution
 * 
 * Supports multi-step execution where the AI can run multiple commands
 * and iterate until it completes the task.
 * 
 * Uses a persistent shell session to maintain state between commands.
 */

import cockpit from 'cockpit';
import { AIClient, ChatMessage } from './ai-client';
import { Settings, DEFAULT_SETTINGS } from './settings';
import { secretManager } from './secrets';
import { debugLogger } from './debug-logger';
import type { Action, AIResponse, SystemContext, CommandResult } from './types';

// Callback types
type ActionCallback = (action: Action) => Promise<boolean>;
type OutputCallback = (output: string) => void;
type ActionStartCallback = (action: Action) => void;
type ActionLogCallback = (action: Action, result: CommandResult) => void;
type CommandExecutor = (command: string) => Promise<{ output: string; exitCode: number; cwd: string }>;
type InteractiveCallback = (action: Action, hint: string) => void;
type IntermediateResponseCallback = (response: string) => void;

interface ProcessOptions {
    hostname: string;
    terminalContext?: string;
    terminalCwd?: string;
    onAction: ActionCallback;
    onOutput: OutputCallback;
    onActionStarted?: ActionStartCallback;
    onActionExecuted?: ActionLogCallback;
    onInteractiveCommand?: InteractiveCallback;  // Called when interactive command starts
    onIntermediateResponse?: IntermediateResponseCallback;  // Called to show AI response before command completes
    onAssistantStream?: (text: string) => void; // Called with streaming assistant "response" field content
    executeCommand: CommandExecutor;  // Execute command via terminal
}

// Default max iterations (overridden by settings.maxExecutionSteps)
const DEFAULT_MAX_ITERATIONS = 10;

export class AgentController {
    private aiClient: AIClient;
    private settings: Settings;
    private conversationHistory: ChatMessage[] = [];
    private currentDirectory: string = '~';
    private isAborted: boolean = false;
    private currentExecutionId: number = 0;

    constructor() {
        this.settings = DEFAULT_SETTINGS;
        this.aiClient = new AIClient(this.settings);
    }

    updateSettings(settings: Settings) {
        this.settings = settings;
        this.aiClient.updateSettings(settings);
        // Sync secret redaction setting
        secretManager.setEnabled(settings.secretRedaction);
        // Sync debug logger setting
        debugLogger.setEnabled(settings.debugMode);
    }

    /**
     * Replace the in-memory conversation history (used to restore a chat session's context).
     * Note: system prompt/context is still provided separately via buildSystemPrompt().
     */
    setConversationHistory(history: ChatMessage[]): void {
        this.conversationHistory = [...history];
    }

    /**
     * Abort any in-progress AI request
     */
    abort(): void {
        this.isAborted = true;
        this.aiClient.abort();
    }

    /**
     * Check if a request is currently in progress
     */
    isRequestInProgress(): boolean {
        return this.aiClient.isRequestInProgress();
    }

    async processMessage(userMessage: string, options: ProcessOptions): Promise<string> {
        this.currentExecutionId++;
        const executionId = this.currentExecutionId;
        this.isAborted = false;
        const { hostname, onAction, onOutput, onActionStarted, onActionExecuted, onInteractiveCommand, onIntermediateResponse, onAssistantStream, executeCommand } = options;

        // Synchronize agent CWD with the actual terminal CWD if available
        if (options.terminalCwd && options.terminalCwd !== '~') {
            this.currentDirectory = options.terminalCwd;
        }

        // Add user message to history
        this.conversationHistory.push({
            role: 'user',
            content: userMessage
        });

        // Redact secrets in the terminal context if secret redaction is enabled
        const redactedTerminalContext = options.terminalContext
            ? secretManager.scanAndRedact(options.terminalContext, 'terminal').redactedText
            : undefined;

        // Build system prompt with current context
        const systemPrompt = this.buildSystemPrompt({
            hostname,
            cwd: this.currentDirectory,
            terminalContext: redactedTerminalContext
        });

        try {
            let iteration = 0;
            let finalResponse = '';

            const maxSteps = this.settings.maxExecutionSteps || DEFAULT_MAX_ITERATIONS;

            // Multi-step execution loop
            while (iteration < maxSteps) {
                if (this.isAborted || this.currentExecutionId !== executionId) {
                    throw new Error('AbortError');
                }

                iteration++;

                // Send to AI
                const sendOpts: { onResponseStream?: (text: string) => void } = {};
                if (this.settings.streamResponses && onAssistantStream) {
                    // Mark a new iteration boundary for the UI (without clearing already-rendered text)
                    onAssistantStream('');
                    sendOpts.onResponseStream = onAssistantStream;
                }

                const aiResponse = await this.aiClient.sendMessage(
                    this.conversationHistory,
                    systemPrompt,
                    sendOpts
                );

                if (this.isAborted || this.currentExecutionId !== executionId) {
                    throw new Error('AbortError');
                }

                const hasDone = aiResponse.actions?.some(a => a.type === 'done');
                const hasAskUser = aiResponse.actions?.some(a => a.type === 'ask_user');
                const executableActions = aiResponse.actions ? aiResponse.actions.filter(a => a.type !== 'done') : [];

                // If no actions, prompt the model again
                if (!aiResponse.actions || aiResponse.actions.length === 0) {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.response
                    });
                    
                    this.conversationHistory.push({
                        role: 'user',
                        content: 'System: You did not output a JSON block with actions. If you have commands to run, output them now. If you have finished the task, output the "done" action.'
                    });
                    
                    finalResponse = aiResponse.response;
                    continue;
                }

                // If 'done' is the only action, we're finished
                if (hasDone && executableActions.length === 0) {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.response
                    });
                    finalResponse = aiResponse.response;
                    break;
                }

                // If ask_user is present, abort execution and wait for user response
                if (hasAskUser) {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.response
                    });
                    finalResponse = aiResponse.response;
                    break;
                }

                // For interactive commands, show the AI response immediately before waiting
                const hasInteractive = executableActions.some(a => a.interactive);
                if (hasInteractive && onIntermediateResponse && aiResponse.response && !(this.settings.streamResponses && onAssistantStream)) {
                    onIntermediateResponse(aiResponse.response);
                }

                // Execute actions
                const results = await this.executeActions(
                    executionId,
                    executableActions,
                    onAction,
                    onOutput,
                    onActionStarted,
                    onActionExecuted,
                    onInteractiveCommand,
                    executeCommand
                );

                if (this.isAborted || this.currentExecutionId !== executionId) {
                    throw new Error('AbortError');
                }

                // Add AI's response to history
                this.conversationHistory.push({
                    role: 'assistant',
                    content: aiResponse.response
                });

                // If all actions were blocked/denied, break
                if (results.length === 0) {
                    finalResponse = aiResponse.response;
                    break;
                }

                // If the model also included a done action along with commands, break after execution
                if (hasDone) {
                    finalResponse = aiResponse.response;
                    break;
                }

                // Format results and send back to AI for continuation
                const resultsMessage = this.formatResultsForAI(results);
                this.conversationHistory.push({
                    role: 'system',
                    content: resultsMessage
                });

                // Update the intermediate response
                finalResponse = aiResponse.response;
            }

            if (iteration >= maxSteps) {
                console.warn('Agent reached maximum iterations');
                this.conversationHistory.push({
                    role: 'assistant',
                    content: 'I reached the maximum number of steps for this task. Please review the results above.'
                });
                return finalResponse + '\n\n⚠️ Reached maximum execution steps.';
            }

            return finalResponse;
        } catch (error) {
            console.error('Agent error:', error);
            throw error;
        }
    }

    private async executeActions(
        executionId: number,
        actions: Action[],
        onAction: ActionCallback,
        onOutput: OutputCallback,
        onActionStarted: ActionStartCallback | undefined,
        onActionExecuted: ActionLogCallback | undefined,
        onInteractiveCommand: InteractiveCallback | undefined,
        executeCommand: CommandExecutor
    ): Promise<{ action: Action; result: CommandResult }[]> {
        const results: { action: Action; result: CommandResult }[] = [];

        for (const action of actions) {
            if (this.isAborted || this.currentExecutionId !== executionId) {
                throw new Error('AbortError');
            }

            // Log action request
            debugLogger.logAction(action, 'requested');

            // Check blocklist
            if (this.isBlocked(action)) {
                debugLogger.logAction(action, 'blocked');
                onOutput(`\n⛔ Blocked: "${action.command}" matches blocklist pattern\n`);
                continue;
            }

            // Request approval
            const approved = await onAction(action);

            if (!approved) {
                debugLogger.logAction(action, 'denied');
                onOutput(`\n❌ Denied: ${action.description}\n`);
                continue;
            }

            debugLogger.logAction(action, 'approved');

            // Notify about interactive command BEFORE executing
            if (action.interactive && onInteractiveCommand) {
                const hint = action.interactive_hint || 'This command requires input in the terminal';
                onInteractiveCommand(action, hint);
            } else if (onActionStarted) {
                // For non-interactive actions, emit a "started" event so the UI can show the command immediately
                onActionStarted(action);
            }

            // Execute the action
            const result = await this.executeAction(action, onOutput, executeCommand);
            results.push({ action, result });

            // Log execution result
            debugLogger.logAction(action, 'executed', result);

            // Notify about executed action
            if (onActionExecuted) {
                onActionExecuted(action, result);
            }
        }

        return results;
    }

    private async executeAction(action: Action, onOutput: OutputCallback, executeCommand: CommandExecutor): Promise<CommandResult> {
        switch (action.type) {
            case 'command':
                return this.runCommand(action.command!, executeCommand);
            case 'file_read':
                return this.readFile(action.path!, onOutput);
            case 'file_write':
                return this.writeFile(action.path!, action.content!, onOutput);
            case 'service':
                return this.manageService(action.service!, action.operation!, onOutput);
            default:
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: `Unknown action type: ${action.type}`,
                    success: false
                };
        }
    }

    /**
     * Execute a command via the terminal's persistent shell
     * Handles secret substitution and output redaction
     */
    private async runCommand(command: string, executeCommand: CommandExecutor): Promise<CommandResult> {
        try {
            // Substitute any secret placeholders with actual values before execution
            const actualCommand = secretManager.substituteSecrets(command);

            if (this.settings.debugMode && actualCommand !== command) {
                console.log('Secrets substituted in command');
            }

            const result = await executeCommand(actualCommand);

            // Update current directory from the shell's actual CWD
            if (result.cwd) {
                this.currentDirectory = result.cwd;
            }

            // Redact any secrets found in the output before sending to AI
            const { redactedText, detectedSecrets } = secretManager.scanAndRedact(
                result.output,
                `command: ${command}`
            );

            if (this.settings.debugMode) {
                console.log('Command executed:', command);
                console.log('Output received:', result.output?.substring(0, 200) + (result.output?.length > 200 ? '...' : ''));
                console.log('Exit code:', result.exitCode);
                console.log('Current directory:', this.currentDirectory);
                if (detectedSecrets.length > 0) {
                    console.log('Secrets detected and redacted:', detectedSecrets);
                }
            }

            return {
                exitCode: result.exitCode,
                stdout: redactedText,  // Return redacted output to AI
                stderr: '',
                success: result.exitCode === 0
            };
        } catch (error) {
            console.error('Command execution error:', error);
            return {
                exitCode: 1,
                stdout: '',
                stderr: error instanceof Error ? error.message : 'Command failed',
                success: false
            };
        }
    }

    /**
     * Reset the shell state (for clear history)
     */
    resetShell(): void {
        this.currentDirectory = '~';
    }

    /**
     * Resolve a path relative to the terminal's active working directory
     */
    private resolvePath(path: string): string {
        const substitutedPath = secretManager.substituteSecrets(path);

        // If absolute path or relative to home
        if (substitutedPath.startsWith('/') || substitutedPath.startsWith('~')) {
            return substitutedPath;
        }

        // If relative to terminal CWD
        if (this.currentDirectory && this.currentDirectory !== '~' && this.currentDirectory.startsWith('/')) {
            let relativePath = substitutedPath;
            if (relativePath.startsWith('./')) {
                relativePath = relativePath.substring(2);
            } else if (relativePath === '.') {
                relativePath = '';
            }

            const baseDir = this.currentDirectory.endsWith('/')
                ? this.currentDirectory
                : this.currentDirectory + '/';
            return baseDir + relativePath;
        }

        return substitutedPath;
    }

    private async readFile(path: string, onOutput: OutputCallback): Promise<CommandResult> {
        const actualPath = this.resolvePath(path);

        if (this.settings.debugMode && actualPath !== path) {
            console.log(`Path resolved in file_read: ${path} -> ${actualPath}`);
        }

        onOutput(`\n📄 Reading: ${path}\n`);

        try {
            const file = cockpit.file(actualPath);
            const content = await file.read() as string | null;
            file.close();

            // Redact secrets from file content before sending to AI
            const { redactedText, detectedSecrets } = secretManager.scanAndRedact(
                content || '',
                `file: ${path}`
            );

            onOutput(content || '(empty file)\n');

            if (this.settings.debugMode && detectedSecrets.length > 0) {
                console.log(`Secrets redacted from ${path}:`, detectedSecrets);
            }

            return {
                exitCode: 0,
                stdout: redactedText,  // Return redacted content to AI
                stderr: '',
                success: true
            };
        } catch (error: any) {
            const errorMsg = error.message || 'Failed to read file';
            onOutput(`Error: ${errorMsg}\n`);
            return {
                exitCode: 1,
                stdout: '',
                stderr: errorMsg,
                success: false
            };
        }
    }

    private async writeFile(path: string, content: string, onOutput: OutputCallback): Promise<CommandResult> {
        const actualPath = this.resolvePath(path);
        const actualContent = secretManager.substituteSecrets(content);

        if (this.settings.debugMode && (actualPath !== path || actualContent !== content)) {
            console.log('Secrets substituted or path resolved in file_write operation');
        }

        onOutput(`\n📝 Writing to: ${path}\n`);

        try {
            // First ensure the parent directory exists
            const lastSlashIndex = actualPath.lastIndexOf('/');
            if (lastSlashIndex > 0) {
                const dirPath = actualPath.substring(0, lastSlashIndex);
                try {
                    await new Promise<void>((resolve, reject) => {
                        cockpit.spawn(['mkdir', '-p', dirPath], { superuser: 'try' })
                            .then(() => resolve())
                            .catch(reject);
                    });
                } catch (e) {
                    // Just log and proceed; file.replace might still work or will throw its own error
                    console.warn(`Attempt to create directory ${dirPath} returned:`, e);
                }
            }

            const file = cockpit.file(actualPath, { superuser: 'try' });
            await file.replace(actualContent);
            file.close();

            onOutput(`✓ Written ${actualContent.length} bytes\n`);

            return {
                exitCode: 0,
                stdout: `Written ${actualContent.length} bytes to ${path}`,
                stderr: '',
                success: true
            };
        } catch (error: any) {
            const errorMsg = error.message || 'Failed to write file';
            onOutput(`Error: ${errorMsg}\n`);
            return {
                exitCode: 1,
                stdout: '',
                stderr: errorMsg,
                success: false
            };
        }
    }

    private executeService(service: string, operation: string): Promise<CommandResult> {
        return new Promise((resolve) => {
            cockpit.spawn(['systemctl', operation, service], {
                superuser: 'require'
            }).then(() => {
                resolve({
                    exitCode: 0,
                    stdout: `Service ${service} ${operation} successful`,
                    stderr: '',
                    success: true
                });
            }).catch((error: any) => {
                resolve({
                    exitCode: error.exit_status || 1,
                    stdout: '',
                    stderr: error.message || `Failed to ${operation} ${service}`,
                    success: false
                });
            });
        });
    }

    private async manageService(service: string, operation: string, onOutput: OutputCallback): Promise<CommandResult> {
        onOutput(`\n🔧 ${operation} service: ${service}\n`);
        const result = await this.executeService(service, operation);
        onOutput(result.success ? `✓ ${result.stdout}\n` : `✗ ${result.stderr}\n`);
        return result;
    }

    private isBlocked(action: Action): boolean {
        if (action.type !== 'command' || !action.command) {
            return false;
        }

        const cmd = action.command.toLowerCase().trim();
        return this.settings.commandBlocklist.some(pattern => {
            const p = pattern.toLowerCase().trim();
            return cmd.includes(p) || cmd === p;
        });
    }

    private formatResultsForAI(results: { action: Action; result: CommandResult }[]): string {
        const maxLength = this.settings.outputTruncateLength || 8000;
        const parts = results.map(({ action, result }) => {
            const status = result.success ? 'SUCCESS' : 'FAILED';
            // Truncate very long outputs based on settings
            let output = result.stdout;
            if (output.length > maxLength) {
                output = output.substring(0, maxLength) + `\n...(truncated ${output.length - maxLength} chars)`;
            }
            return `[${status}] ${action.description}
Command: ${action.command || action.type}
Exit code: ${result.exitCode}
Output:
${output}
${result.stderr ? `Errors:\n${result.stderr}` : ''}`;
        });

        return `System: Here are the results of the actions you requested:

${parts.join('\n\n---\n\n')}

Based on these results, decide on the next steps.

IMPORTANT: If you need to execute more commands, you MUST output the actual commands as a JSON array inside a \`\`\`json block at the end of your response. If you have finished the task, you MUST output the JSON block with the 'done' action type.`;
    }

    private buildSystemPrompt(context: SystemContext): string {
        const terminalInfo = context.terminalContext
            ? `\n\n## Recent Terminal Visible Content\nThe following is the actual text currently visible on the user's terminal screen. You can use this to understand what commands the user has recently run manually and their outputs:\n\`\`\`\n${context.terminalContext}\n\`\`\``
            : '';

        return `You are an AI assistant integrated into Cockpit, helping administrators manage a Linux server.

## Current Context
- Hostname: ${context.hostname}
- Current directory: ${context.cwd || '/root'}
- Timestamp: ${new Date().toISOString()}${terminalInfo}

## Reasoning Requirement
Before writing any natural language response or executing any actions, you MUST analyze the user's request and the current context, and write down your reasoning process. Wrap your entire reasoning/thought process in <think>...</think> tags at the very beginning of your response.

## Response Format
After your reasoning block, answer the user naturally. You can use markdown styling, code blocks, and multi-paragraph formatting.
If you need to execute commands, file operations, or services, append them at the very end of your response wrapped in a \`\`\`json block.

Example — running a command:
<think>
The user wants to check the operating system details. I will execute the 'cat /etc/os-release' command, which is a low-risk informational command, to retrieve the OS configuration.
</think>
I will check the operating system details for you now!
\`\`\`json
[
  {
    "type": "command",
    "command": "cat /etc/os-release",
    "description": "Checking OS version",
    "risk_level": "low"
  }
]
\`\`\`

Example — writing a file:
\`\`\`json
[
  {
    "type": "file_write",
    "path": "/home/user/notes.md",
    "description": "Writing notes file",
    "risk_level": "medium"
  }
]
\`\`\`

__FILE_CONTENT__
# My Notes
This is the content of the file.
It can contain any characters, code blocks, markdown, etc.
__END_FILE_CONTENT__

CRITICAL FORMATTING RULES:
- Start your response with <think>...</think> enclosing your reasoning.
- The \`\`\`json block must contain an Array of action objects.
- You MUST output the JSON block with your actions. If you have finished the task and no further commands are needed, you MUST output a JSON array containing a single "done" action. Do NOT omit the JSON block.
- For file_write actions: Do NOT put file content in the JSON "content" field. Instead, place the content AFTER the JSON block between __FILE_CONTENT__ and __END_FILE_CONTENT__ markers. This prevents formatting issues with special characters. If writing multiple files, use one pair of markers per file in the same order as the actions.

## Action Types
- command: Execute a shell command
- file_read: Read a file (use "path" field instead of "command")
- file_write: Write to a file (use "path" field in JSON, file content goes in __FILE_CONTENT__ block AFTER the JSON)
- service: Manage systemd service (use "service" and "operation" fields, operation: start|stop|restart|status)
- ask_user: Ask the user a question and wait for their response (use "question" field). DO NOT queue any other commands after this!
- done: Indicate that you have completed the task and no further commands are needed. (use "description" field).

## Risk Levels - BE ACCURATE
- low: Read-only, informational commands (ls, cat, df, ps, top, journalctl, systemctl status)
- medium: Service management, package installation, non-destructive changes
- high: Configuration file changes, user management, firewall rules
- critical: rm -rf, disk operations, /etc/passwd changes, anything destructive

## Interactive Commands
Some commands require user input in the terminal (passwords, confirmations, interactive editors).
For these commands, set "interactive": true and provide "interactive_hint" with instructions.

Examples of interactive commands:
- sudo (requires password): interactive_hint: "Enter your sudo password in the terminal"
- ssh (may require password/confirmation): interactive_hint: "Confirm host key or enter password in terminal"
- passwd: interactive_hint: "Enter the new password when prompted"
- apt install without -y: interactive_hint: "Confirm installation in the terminal"
- vim/nano/editors: interactive_hint: "Edit the file in the terminal, then save and exit"
- mysql/psql interactive: interactive_hint: "Execute your queries, then type 'exit' to finish"

When a command is interactive, I will show your hint to the user so they know to interact with the terminal.

## Multi-Step Execution
- You can include multiple actions in one response
- After executing commands, you will receive the results
- You can then decide to run more commands or conclude the task
- When the task is complete, respond with an empty actions array
- Commands run in a PERSISTENT shell session - environment variables, working directory changes (cd), and shell state are preserved between commands

## Guidelines
1. Keep responses concise but helpful
2. Explain what you're doing before executing commands
3. Always specify accurate risk levels - this affects whether user approval is needed
4. Break complex tasks into steps - you can run multiple commands
5. If a task is unclear, ask for clarification instead of guessing
6. When reporting command results, summarize key findings
7. If you have finished the task, output a JSON block with the "done" action.
8. You can run multiple commands in sequence for complex tasks, just add multiple items to the json array.

## Secret Handling
- Sensitive data (passwords, API keys, tokens, private keys) is automatically detected and redacted
- Secrets appear as placeholders like \`__SECRET_1__\`, \`__SECRET_2__\`, etc.
- You can reference these placeholders in commands and they will be substituted with actual values at execution time
- Example: If you see \`password=__SECRET_1__\` in output, you can use \`mysql -p__SECRET_1__\` in a command
- You will NEVER see the actual secret values - this is for security
- Treat the placeholder as if it were the real secret in your reasoning

## IMPORTANT
- Be conservative with risk levels - when in doubt, use a higher level
- Never try to decode, guess, or ask about the actual values of secret placeholders`;
    }

    /**
     * Clear conversation history and optionally reset the shell session
     */
    clearHistory(resetSession: boolean = true, clearSecrets: boolean = false) {
        this.clearConversationHistory();
        if (resetSession) {
            this.resetShell();
        }
        if (clearSecrets) {
            secretManager.clear();
        }
    }

    /**
     * Clear only conversation history
     */
    clearConversationHistory() {
        this.conversationHistory = [];
    }

    /**
     * Get list of detected secrets (IDs and types only, never values)
     */
    getDetectedSecrets(): { id: string; type: string; detectedAt: Date }[] {
        return secretManager.listSecrets();
    }

    /**
     * Get count of stored secrets
     */
    getSecretCount(): number {
        return secretManager.getSecretCount();
    }

    /**
     * Clear all stored secrets
     */
    clearSecrets(): void {
        secretManager.clear();
    }

    /**
     * Manually add a secret (user-provided)
     */
    addSecret(value: string, type: string = 'user_defined'): string {
        return secretManager.addSecret(value, type);
    }
}
