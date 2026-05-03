/*
 * XTerminal - Real terminal using xterm.js with a persistent Cockpit PTY
 * 
 * This provides a real bash shell that the AI can send commands to.
 * The terminal state (env vars, cwd, etc.) persists across commands.
 */

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import cockpit from 'cockpit';

// Unique marker for command completion detection
const COMMAND_MARKER = '___AI_CMD_DONE___';

// Helper to check if debug mode is enabled
const isDebugMode = (): boolean => {
    try {
        const stored = localStorage.getItem('cockpit-ai-agent-settings');
        if (stored) {
            const settings = JSON.parse(stored);
            return settings.debugMode === true;
        }
    } catch {
        // Ignore errors
    }
    return false;
};

// Handle for parent component to send commands
export interface XTerminalHandle {
    /**
     * Execute a command and wait for completion
     * Returns the output, exit code, and current working directory
     */
    executeCommand: (command: string) => Promise<{ output: string; exitCode: number; cwd: string }>;

    /**
     * Send raw input to the terminal (for user typing)
     */
    sendInput: (data: string) => void;

    /**
     * Clear the terminal
     */
    clear: () => void;

    /**
     * Focus the terminal
     */
    focus: () => void;

    /**
     * Get the visible text of the terminal screen
     */
    getVisibleText: () => string;
}

interface XTerminalProps {
    onReady?: (() => void) | undefined;
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(({ onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const channelRef = useRef<any>(null);
    const initializedRef = useRef(false);

    // For command completion detection
    const outputBufferRef = useRef<string>('');
    const commandResolverRef = useRef<{
        resolve: (result: { output: string; exitCode: number; cwd: string }) => void;
        markerId: string;
        startIndex: number;
    } | null>(null);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        executeCommand: (command: string): Promise<{ output: string; exitCode: number; cwd: string }> => {
            return new Promise((resolve, reject) => {
                if (!channelRef.current) {
                    reject(new Error('Shell not initialized'));
                    return;
                }

                // Generate unique marker ID
                const markerId = `${Date.now()}`;

                // Record the current buffer position (we now clear it per-command)
                outputBufferRef.current = '';
                const startIndex = 0;

                // Store resolver
                commandResolverRef.current = {
                    resolve,
                    markerId,
                    startIndex
                };

                // Send command natively without any wrappers.
                // We rely on the invisible PROMPT_COMMAND OSC payload to know when it finishes.
                channelRef.current.input(`${command}\n`, true);

                // Timeout after 360 seconds
                setTimeout(() => {
                    if (commandResolverRef.current?.markerId === markerId) {
                        commandResolverRef.current = null;
                        resolve({
                            output: 'Command timed out after 360 seconds',
                            exitCode: -1,
                            cwd: ''
                        });
                    }
                }, 360000);
            });
        },

        sendInput: (data: string) => {
            if (channelRef.current) {
                channelRef.current.input(data, true);
            }
        },

        clear: () => {
            if (terminalRef.current) {
                terminalRef.current.clear();
            }
            outputBufferRef.current = '';
        },

        focus: () => {
            if (terminalRef.current) {
                terminalRef.current.focus();
            }
        },

        getVisibleText: () => {
            if (!terminalRef.current) return '';
            const terminal = terminalRef.current;
            const buffer = terminal.buffer.active;
            const lines: string[] = [];
            // Get up to the last 150 lines of the terminal buffer to avoid huge prompts but capture enough context
            const startY = Math.max(0, buffer.length - 150);
            for (let i = startY; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) {
                    lines.push(line.translateToString(true)); // true trims trailing whitespace
                }
            }
            // Filter out empty lines from the bottom to save token space
            while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                lines.pop();
            }
            return lines.join('\n');
        }
    }));

    useEffect(() => {
        // Prevent double initialization but allow remount if terminal was disposed
        if (!containerRef.current) return;
        if (terminalRef.current) return;

        // Create terminal
        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "'RedHatMono', 'Liberation Mono', 'Consolas', monospace",
            theme: {
                background: '#151515',
                foreground: '#d0d0d0',
                cursor: '#73bcf7',
                cursorAccent: '#151515',
                selectionBackground: 'rgba(115, 188, 247, 0.3)',
                black: '#151515',
                red: '#f54f47',
                green: '#92d400',
                yellow: '#f0ab00',
                blue: '#73bcf7',
                magenta: '#a4508b',
                cyan: '#2b9af3',
                white: '#d0d0d0',
                brightBlack: '#8a8d90',
                brightRed: '#ff6b6b',
                brightGreen: '#a8e000',
                brightYellow: '#ffc107',
                brightBlue: '#8ec8f9',
                brightMagenta: '#b86fb8',
                brightCyan: '#54aef7',
                brightWhite: '#ffffff',
            },
            allowProposedApi: true,
        });

        // Add addons
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        // Open terminal in container
        terminal.open(containerRef.current);
        
        // Show loading message while shell spawns (cleared automatically by stty/clear)
        terminal.write('\r\n\x1b[36m  Connecting to integrated shell...\x1b[0m\r\n');

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // Handle window resize
        const handleResize = () => {
            if (fitAddonRef.current && channelRef.current) {
                fitAddonRef.current.fit();
            }
        };

        window.addEventListener('resize', handleResize);

        // Forward terminal input to channel
        terminal.onData((data: string) => {
            if (channelRef.current) {
                channelRef.current.input(data, true);
            }
        });

        // Track if initial setup is done to avoid double prompts
        let initialSetupDone = false;

        // Handle terminal resize - use Cockpit control API to update PTY window size silently
        terminal.onResize(({ cols, rows }) => {
            if (channelRef.current) {
                // Send window resize control command (pass various synonyms as Cockpit API surface may expect lines/columns or rows/cols depending on the bridge version)
                channelRef.current.control({ command: 'window', visible: true, rows: rows, cols: cols, lines: rows, columns: cols });
            }
        });

        // Function to spawn shell
        const spawnShell = () => {

            // Use the absolute simplest spawn - just bash with pty
            // We use 'cd; exec bash -i' to ensure we start in the user's home directory
            const proc = cockpit.spawn(["/bin/bash", "-c", "cd; exec /bin/bash -i"], {
                pty: true,
                environ: [
                    "TERM=xterm-256color"
                ],
                window: { rows: terminalRef.current?.rows || 24, cols: terminalRef.current?.cols || 80 }
            });

            channelRef.current = proc;

            // Handle output
            proc.stream((data: string) => {
                // DO NOT intercept or strip data with regex! This breaks readline cursor synchronization.
                // Write exactly what bash sends to maintaining 100% 1:1 state mapping.
                terminal.write(data);

                // Check for command completion using the invisible OSC emitted by PROMPT_COMMAND
                if (commandResolverRef.current) {
                    outputBufferRef.current += data;
                    const { resolve, startIndex, markerId } = commandResolverRef.current;
                    // Match the invisible OSC output from PROMPT_COMMAND
                    const markerPattern = /\x1b\]1337;AI_CMD_STATUS=(\d+)\|([^\x07]+)\x07/;
                    const bufferSinceCommand = outputBufferRef.current.substring(startIndex);
                    const match = markerPattern.exec(bufferSinceCommand);

                    if (match && match.index !== undefined) {
                        // Debounce - wait a bit for any trailing output
                        const capturedMatch = match;

                        // Small delay to let any remaining output arrive
                        setTimeout(() => {
                            // Only process if we're still waiting for this command
                            if (!commandResolverRef.current || commandResolverRef.current.markerId !== markerId) {
                                return;
                            }

                            const finalBuffer = outputBufferRef.current.substring(startIndex);
                            const exitCode = parseInt(capturedMatch[1], 10);
                            const cwd = capturedMatch[2] || '';

                            const finalMatch = markerPattern.exec(finalBuffer);
                            if (!finalMatch) {
                                return;
                            }

                            const markerIdx = finalMatch.index;
                            let output = finalBuffer.substring(0, markerIdx);

                            if (isDebugMode()) {
                                console.log('[XTerminal] Raw OSC parsed output (length=' + output.length + '):', output.substring(0, 500));
                                console.log('[XTerminal] CWD:', cwd);
                            }

                            // Trim trailing empty lines
                            output = output.trim();

                            commandResolverRef.current = null;
                            resolve({ output, exitCode, cwd });
                        }, 50); // 50ms debounce
                    }
                }
            });

            // Handle exit
            proc.then(() => {
                terminal.write('\r\n\x1b[33mShell closed normally\x1b[0m\r\n');
                channelRef.current = null;
            }).catch((error: any) => {
                console.error('Shell error:', error);
                terminal.write(`\r\n\x1b[31mShell error: ${error.message || error.problem || error.exit_signal || 'unknown'}\x1b[0m\r\n`);
                channelRef.current = null;
            });

            return proc;
        };

        // Delay shell spawn until terminal is rendered
        requestAnimationFrame(() => {
            setTimeout(() => {
                fitAddon.fit();
                const cols = terminal.cols || 80;
                const rows = terminal.rows || 24;

                spawnShell();

                // After shell spawns, set up hidden environment flags and clear screen for clean start
                setTimeout(() => {
                    if (channelRef.current) {
                        // Use a custom PROMPT_COMMAND that fires an invisible OSC code to xterm.js so we know when commands finish (and exitCode/cwd) naturally.
                        // We also set HISTCONTROL=ignoreboth just to be safe, but AI commands execute as normal history items now!
                        channelRef.current.input(` [[ ":$HISTCONTROL:" != *":ignorespace:"* ]] && export HISTCONTROL=ignoreboth; export PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }printf '\\033]1337;AI_CMD_STATUS=%d|%s\\007' \\$? \\"$PWD\\""; clear\n`, true);
                        initialSetupDone = true;
                    }
                }, 200);

                if (onReady) {
                    onReady();
                }
            }, 100);
        });

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            if (channelRef.current) {
                try {
                    channelRef.current.close();
                } catch (e) {
                    console.warn('Failed to close channel:', e);
                }
                channelRef.current = null;
            }
            if (terminalRef.current) {
                terminalRef.current.dispose();
                terminalRef.current = null;
            }
        };
    }, []);

    const handleClick = () => {
        if (terminalRef.current) {
            terminalRef.current.focus();
        }
    };

    return (
        <div
            ref={containerRef}
            onClick={handleClick}
            style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#151515',
                cursor: 'text',
            }}
        />
    );
});

XTerminal.displayName = 'XTerminal';
