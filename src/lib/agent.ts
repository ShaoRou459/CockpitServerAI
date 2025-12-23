/*
 * Agent Controller - Orchestrates AI interactions and command execution
 * 
 * Supports multi-step execution where the AI can run multiple commands
 * and iterate until it completes the task.
 */

import cockpit from 'cockpit';
import { AIClient, ChatMessage } from './ai-client';
import { Settings, DEFAULT_SETTINGS } from './settings';
import type { Action, AIResponse, SystemContext, CommandResult } from './types';

// Callback types
type ActionCallback = (action: Action) => Promise<boolean>;
type OutputCallback = (output: string) => void;
type ActionLogCallback = (action: Action, result: CommandResult) => void;

interface ProcessOptions {
    hostname: string;
    onAction: ActionCallback;
    onOutput: OutputCallback;
    onActionExecuted?: ActionLogCallback; // New: callback when action is executed
}

// Maximum iterations to prevent infinite loops
const MAX_ITERATIONS = 10;

export class AgentController {
    private aiClient: AIClient;
    private settings: Settings;
    private conversationHistory: ChatMessage[] = [];
    private currentDirectory: string = '/root';

    constructor() {
        this.settings = DEFAULT_SETTINGS;
        this.aiClient = new AIClient(this.settings);
    }

    updateSettings(settings: Settings) {
        this.settings = settings;
        this.aiClient.updateSettings(settings);
    }

    async processMessage(userMessage: string, options: ProcessOptions): Promise<string> {
        const { hostname, onAction, onOutput, onActionExecuted } = options;

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
                const aiResponse = await this.aiClient.sendMessage(
                    this.conversationHistory,
                    systemPrompt
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

                // Execute actions
                const results = await this.executeActions(
                    aiResponse.actions,
                    onAction,
                    onOutput,
                    onActionExecuted
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
        onActionExecuted?: ActionLogCallback
    ): Promise<{ action: Action; result: CommandResult }[]> {
        const results: { action: Action; result: CommandResult }[] = [];

        for (const action of actions) {
            // Check blocklist
            if (this.isBlocked(action)) {
                onOutput(`\n⛔ Blocked: "${action.command}" matches blocklist pattern\n`);
                continue;
            }

            // Request approval
            const approved = await onAction(action);

            if (!approved) {
                onOutput(`\n❌ Denied: ${action.description}\n`);
                continue;
            }

            // Execute the action
            const result = await this.executeAction(action, onOutput);
            results.push({ action, result });

            // Notify about executed action
            if (onActionExecuted) {
                onActionExecuted(action, result);
            }
        }

        return results;
    }

    private async executeAction(action: Action, onOutput: OutputCallback): Promise<CommandResult> {
        switch (action.type) {
            case 'command':
                return this.executeCommand(action.command!, onOutput);
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

    private executeCommand(command: string, onOutput: OutputCallback): Promise<CommandResult> {
        return new Promise((resolve) => {
            onOutput(`\n$ ${command}\n`);

            const proc = cockpit.spawn(['bash', '-c', command], {
                pty: true,
                environ: ['TERM=xterm-256color'],
                directory: this.currentDirectory,
                superuser: 'try'
            });

            let stdout = '';
            let stderr = '';

            proc.stream((data: string) => {
                stdout += data;
                onOutput(data);
            });

            proc.then(() => {
                resolve({
                    exitCode: 0,
                    stdout,
                    stderr,
                    success: true
                });
            }).catch((error: any) => {
                stderr = error.message || 'Command failed';
                resolve({
                    exitCode: error.exit_status || 1,
                    stdout,
                    stderr,
                    success: false
                });
            });
        });
    }

    private async readFile(path: string, onOutput: OutputCallback): Promise<CommandResult> {
        onOutput(`\n📄 Reading: ${path}\n`);

        try {
            const file = cockpit.file(path);
            const content = await file.read();
            file.close();

            onOutput(content || '(empty file)\n');

            return {
                exitCode: 0,
                stdout: content || '',
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
        onOutput(`\n📝 Writing to: ${path}\n`);

        try {
            const file = cockpit.file(path, { superuser: 'try' });
            await file.replace(content);
            file.close();

            onOutput(`✓ Written ${content.length} bytes\n`);

            return {
                exitCode: 0,
                stdout: `Written ${content.length} bytes to ${path}`,
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
        const parts = results.map(({ action, result }) => {
            const status = result.success ? 'SUCCESS' : 'FAILED';
            // Truncate very long outputs
            let output = result.stdout;
            if (output.length > 2000) {
                output = output.substring(0, 2000) + '\n...(truncated)';
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

Based on these results, continue with the next steps if needed. If the task is complete, summarize the outcome. If you need to run more commands, include them in your response. If no more commands are needed, respond with an empty actions array.`;
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

## Multi-Step Execution
- You can include multiple actions in one response
- After executing commands, you will receive the results
- You can then decide to run more commands or conclude the task
- When the task is complete, respond with an empty actions array

## Guidelines
1. Keep responses concise but helpful
2. Explain what you're doing before executing commands
3. Always specify accurate risk levels - this affects whether user approval is needed
4. Break complex tasks into steps - you can run multiple commands
5. If a task is unclear, ask for clarification instead of guessing
6. When reporting command results, summarize key findings
7. If you don't need to run any commands, use an empty actions array
8. You can run multiple commands in sequence for complex tasks

## IMPORTANT
- Always respond with valid JSON, nothing else
- Never include markdown formatting around the JSON
- Be conservative with risk levels - when in doubt, use a higher level`;
    }

    clearHistory() {
        this.conversationHistory = [];
    }
}
