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
    onAction: ActionCallback;
    onOutput: OutputCallback;
    onActionStarted?: ActionStartCallback;
    onActionExecuted?: ActionLogCallback;
    onInteractiveCommand?: InteractiveCallback;  // Called when interactive command starts
    onIntermediateResponse?: IntermediateResponseCallback;  // Called to show AI response before command completes
    onAssistantStream?: (text: string) => void; // Called with streaming assistant "response" field content
    executeCommand: CommandExecutor;  // Execute command via terminal
}

// Maximum iterations to prevent infinite loops
const MAX_ITERATIONS = 10;

export class AgentController {
    private aiClient: AIClient;
    private settings: Settings;
    private conversationHistory: ChatMessage[] = [];
    private currentDirectory: string = '~';

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
        this.aiClient.abort();
    }

    /**
     * Check if a request is currently in progress
     */
    isRequestInProgress(): boolean {
        return this.aiClient.isRequestInProgress();
    }

    async processMessage(userMessage: string, options: ProcessOptions): Promise<string> {
        const { hostname, onAction, onOutput, onActionStarted, onActionExecuted, onInteractiveCommand, onIntermediateResponse, onAssistantStream, executeCommand } = options;

        // Add user message to history
        this.conversationHistory.push({
            role: 'user',
            content: userMessage
        });

        // Build system prompt with current context
        const systemPrompt = this.buildSystemPrompt({
            hostname,
            cwd: this.currentDirectory
        });

        try {
            let iteration = 0;
            let finalResponse = '';

            // Multi-step execution loop
            while (iteration < MAX_ITERATIONS) {
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

                // If no actions, we're done
                if (!aiResponse.actions || aiResponse.actions.length === 0) {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.response
                    });
                    finalResponse = aiResponse.response;
                    break;
                }

                // For interactive commands, show the AI response immediately before waiting
                const hasInteractive = aiResponse.actions.some(a => a.interactive);
                if (hasInteractive && onIntermediateResponse && aiResponse.response && !(this.settings.streamResponses && onAssistantStream)) {
                    onIntermediateResponse(aiResponse.response);
                }

                // Execute actions
                const results = await this.executeActions(
                    aiResponse.actions,
                    onAction,
                    onOutput,
                    onActionStarted,
                    onActionExecuted,
                    onInteractiveCommand,
                    executeCommand
                );

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

                // Format results and send back to AI for continuation
                const resultsMessage = this.formatResultsForAI(results);
                this.conversationHistory.push({
                    role: 'user',
                    content: resultsMessage
                });

                // Update the intermediate response
                finalResponse = aiResponse.response;
            }

            if (iteration >= MAX_ITERATIONS) {
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

    private async readFile(path: string, onOutput: OutputCallback): Promise<CommandResult> {
        // Substitute any secret placeholders in the path
        const actualPath = secretManager.substituteSecrets(path);

        if (this.settings.debugMode && actualPath !== path) {
            console.log('Secrets substituted in file_read path');
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
        // Substitute any secret placeholders with actual values before writing
        const actualPath = secretManager.substituteSecrets(path);
        const actualContent = secretManager.substituteSecrets(content);

        if (this.settings.debugMode && (actualPath !== path || actualContent !== content)) {
            console.log('Secrets substituted in file_write operation');
        }

        onOutput(`\n📝 Writing to: ${path}\n`);

        try {
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

        return `Here are the results of the commands I executed:

${parts.join('\n\n---\n\n')}

Based on these results, decide the next steps.

IMPORTANT: Your entire next assistant message MUST be a single valid JSON object matching the required schema (no prose before/after). If you need to explain anything to the user, put it inside the "response" string. If no more commands are needed, set "actions" to an empty array.`;
    }

    private buildSystemPrompt(context: SystemContext): string {
        return `You are an AI assistant integrated into Cockpit, helping administrators manage a Linux server.

## Current Context
- Hostname: ${context.hostname}
- Current directory: ${context.cwd || '/root'}
- Timestamp: ${new Date().toISOString()}

## Response Format
You MUST respond with valid JSON in this exact format:
{
  "thought": "Your internal reasoning about what you need to do",
  "actions": [
    {
      "type": "command",
      "command": "the shell command to run",
      "description": "brief description of what this does",
      "risk_level": "low"
    }
  ],
  "response": "Your message to the user explaining what you're doing or answering their question"
}

CRITICAL FORMATTING RULES (non-negotiable):
- Output ONLY the JSON object. Do not output any other text before or after it.
- Do NOT wrap the JSON in markdown code fences.
- If you want to show markdown/code blocks to the user, include them inside the "response" string value.
- Never repeat the "response" text outside the JSON object.

## Action Types
- command: Execute a shell command
- file_read: Read a file (use "path" field instead of "command")
- file_write: Write to a file (use "path" and "content" fields)
- service: Manage systemd service (use "service" and "operation" fields, operation: start|stop|restart|status)

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
7. If you don't need to run any commands, use an empty actions array
8. You can run multiple commands in sequence for complex tasks

## Secret Handling
- Sensitive data (passwords, API keys, tokens, private keys) is automatically detected and redacted
- Secrets appear as placeholders like \`__SECRET_1__\`, \`__SECRET_2__\`, etc.
- You can reference these placeholders in commands and they will be substituted with actual values at execution time
- Example: If you see \`password=__SECRET_1__\` in output, you can use \`mysql -p__SECRET_1__\` in a command
- You will NEVER see the actual secret values - this is for security
- Treat the placeholder as if it were the real secret in your reasoning

## IMPORTANT
- Always respond with valid JSON, nothing else
- Never include markdown formatting around the JSON
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
