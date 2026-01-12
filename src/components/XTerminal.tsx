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

                // Record the current buffer position
                const startIndex = outputBufferRef.current.length;

                // Store resolver
                commandResolverRef.current = {
                    resolve,
                    markerId,
                    startIndex
                };

                // Send command with completion marker that includes exit code and current working directory
                // Format: ___AI_CMD_DONE___<exit_code>___CWD___<path>___
                const wrappedCommand = `${command}; __AI_EXIT_CODE__=$?; printf '${COMMAND_MARKER}%d___CWD___%s___\\n' $__AI_EXIT_CODE__ "$PWD"\n`;
                channelRef.current.input(wrappedCommand, true);

                // Timeout after 60 seconds
                setTimeout(() => {
                    if (commandResolverRef.current?.markerId === markerId) {
                        commandResolverRef.current = null;
                        resolve({
                            output: 'Command timed out after 60 seconds',
                            exitCode: -1,
                            cwd: ''
                        });
                    }
                }, 60000);
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
        }
    }));

    useEffect(() => {
        // Prevent double initialization (React StrictMode)
        if (initializedRef.current || !containerRef.current) return;
        initializedRef.current = true;

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

        // Handle terminal resize - use stty to update terminal size
        terminal.onResize(({ cols, rows }) => {
            if (channelRef.current && initialSetupDone) {
                // Send stty command to update terminal size
                // Use Ctrl+C first to clear any partial input, then stty, then Ctrl+L to refresh
                channelRef.current.input(`stty cols ${cols} rows ${rows}; printf '\\033[2J\\033[H'\n`, true);
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
                ]
            });

            channelRef.current = proc;

            // Handle output
            proc.stream((data: string) => {
                // Buffer the raw output for command detection (includes markers)
                outputBufferRef.current += data;

                // Filter out marker-related content from terminal display
                let displayData = data;
                // Remove the marker command echo and output (new format with CWD)
                displayData = displayData.replace(/; __AI_EXIT_CODE__=\$\?; printf '___AI_CMD_DONE___%d___CWD___%s___\\n' \$__AI_EXIT_CODE__ "\$PWD"/g, '');
                displayData = displayData.replace(/___AI_CMD_DONE___\d+___CWD___[^_]*___/g, '');
                displayData = displayData.replace(/__AI_EXIT_CODE__=\d+/g, '');
                // Remove stty resize commands (we send these internally)
                displayData = displayData.replace(/stty cols \d+ rows \d+[^\r\n]*\r?\n?/g, '');

                // Write to terminal if there's anything to display (including spaces)
                if (displayData.length > 0) {
                    terminal.write(displayData);
                }

                // Check for command completion
                // Look for the ACTUAL marker output: ___AI_CMD_DONE___<exitcode>___CWD___<path>___
                if (commandResolverRef.current) {
                    const { resolve, startIndex, markerId } = commandResolverRef.current;
                    // Match the actual marker output with exit code and CWD
                    const markerPattern = new RegExp(`${COMMAND_MARKER}(\\d+)___CWD___([^_]*)___[\\r\\n]`);
                    const bufferSinceCommand = outputBufferRef.current.substring(startIndex);
                    const match = markerPattern.exec(bufferSinceCommand);

                    if (match && match.index !== undefined) {
                        // Debounce - wait a bit for any trailing output
                        const capturedMatch = match;
                        const capturedIndex = match.index;

                        // Small delay to let any remaining output arrive
                        setTimeout(() => {
                            // Only process if we're still waiting for this command
                            if (!commandResolverRef.current || commandResolverRef.current.markerId !== markerId) {
                                return;
                            }

                            // Re-check the buffer (may have more data now)
                            const finalBuffer = outputBufferRef.current.substring(startIndex);
                            const exitCode = parseInt(capturedMatch[1], 10);
                            const cwd = capturedMatch[2] || '';

                            // Find the actual marker position using regex (not indexOf which would find the echo)
                            const finalMatch = markerPattern.exec(finalBuffer);
                            if (!finalMatch) {
                                console.error('[XTerminal] Lost marker in final buffer');
                                return;
                            }

                            const markerIdx = finalMatch.index;
                            let output = finalBuffer.substring(0, markerIdx);

                            if (isDebugMode()) {
                                console.log('[XTerminal] Raw output before filtering (length=' + output.length + '):', output.substring(0, 500));
                                console.log('[XTerminal] CWD:', cwd);
                            }

                            // Split into lines and filter out only the command echo and marker lines
                            const lines = output.split('\n');
                            const cleanLines = lines.filter(line => {
                                // Remove lines that are the marker command itself (contains %d not actual digit)
                                if (line.includes('__AI_EXIT_CODE__=$?')) return false;
                                if (line.includes("printf '" + COMMAND_MARKER)) return false;
                                if (line.includes('%d___CWD___%s___')) return false;  // The format specifier
                                if (line.includes('%d___')) return false;  // Old format specifier
                                return true;
                            });

                            // Also remove the first line if it's the command echo
                            if (cleanLines.length > 0 && cleanLines[0].includes('; __AI_EXIT_CODE__=')) {
                                cleanLines.shift();
                            }

                            output = cleanLines.join('\n').trim();
                            if (isDebugMode()) {
                                console.log('[XTerminal] Filtered output (length=' + output.length + '):', output.substring(0, 500));
                                console.log('[XTerminal] Exit code:', exitCode);
                            }

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

                // After shell spawns, set the terminal size via stty and clear screen for clean start
                setTimeout(() => {
                    if (channelRef.current) {
                        // Set terminal size and clear screen to avoid double prompt
                        channelRef.current.input(`stty cols ${cols} rows ${rows}; clear\n`, true);
                        initialSetupDone = true;
                    }
                }, 200);

                terminal.focus();

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
