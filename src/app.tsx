/*
 * Cockpit AI Agent - Main Application
 * 
 * An AI-powered terminal assistant for server administration
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Flex, FlexItem, Button } from "@patternfly/react-core";
import { CogIcon, RocketIcon, LockIcon, ShieldAltIcon, BoltIcon, SkullIcon, MoonIcon, SunIcon, BugIcon } from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { ChatPanel } from './components/ChatPanel';
import { TerminalView, TerminalViewHandle } from './components/TerminalView';
import { SettingsModal } from './components/SettingsModal';
import { SecretsIndicator } from './components/SecretsIndicator';
import { DebugPanel } from './components/DebugPanel';
import { AgentController } from './lib/agent';
import { loadSettings, saveSettings, Settings, DEFAULT_SETTINGS, SAFETY_MODES, RiskLevel } from './lib/settings';
import { debugLogger } from './lib/debug-logger';

import type { Message, PendingAction } from './lib/types';

const _ = cockpit.gettext;

// Map safety mode icons
const SAFETY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    lock: LockIcon,
    shield: ShieldAltIcon,
    bolt: BoltIcon,
    rocket: RocketIcon,
    skull: SkullIcon,
};

export const Application = () => {
    // State
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [hostname, setHostname] = useState<string>('');
    const [terminalReady, setTerminalReady] = useState(false);
    const [detectedSecrets, setDetectedSecrets] = useState<{ id: string; type: string; detectedAt: Date }[]>([]);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [debugPanelOpen, setDebugPanelOpen] = useState(false);

    // Terminal ref for sending commands
    const terminalRef = useRef<TerminalViewHandle>(null);

    // Initialize agent controller
    const [agent] = useState(() => new AgentController());

    // Load settings and hostname on mount
    useEffect(() => {
        loadSettings().then(s => {
            setSettings(s);
            setSettingsLoaded(true);
        });

        const hostnameFile = cockpit.file('/etc/hostname');
        hostnameFile.watch(content => setHostname((content as string)?.trim() ?? 'unknown'));
        return () => hostnameFile.close();
    }, []);

    // Update agent and theme when settings change
    useEffect(() => {
        agent.updateSettings(settings);

        // Sync debug logger with settings
        debugLogger.setEnabled(settings.debugMode);

        // Apply theme to document element for PatternFly and CSS variables
        if (settings.theme === 'dark') {
            document.documentElement.classList.add('pf-v6-theme-dark');
        } else {
            document.documentElement.classList.remove('pf-v6-theme-dark');
        }
    }, [settings, agent]);

    // Add welcome message on first load
    useEffect(() => {
        if (messages.length === 0 && hostname && settingsLoaded) {
            const configured = settings.provider === 'custom'
                ? Boolean(settings.baseUrl && settings.model)
                : Boolean(settings.apiKey && settings.provider);
            const status = configured ? 'Ready' : 'Not Configured';
            setMessages([{
                role: 'assistant',
                content: `**${hostname}** | ${settings.model} | ${status}`,
                timestamp: new Date()
            }]);
        }
    }, [hostname, messages.length, settingsLoaded, settings]);

    // Handle sending a message
    const handleSendMessage = useCallback(async (content: string) => {
        // Add user message
        const userMessage: Message = {
            role: 'user',
            content,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        setIsProcessing(true);

        // Track if we've already shown an intermediate response (to avoid duplicates)
        let intermediateResponseShown = false;
        let lastIntermediateResponse = '';

        try {
            // Get the auto-approve levels for current safety mode
            const safetyConfig = SAFETY_MODES[settings.safetyMode];
            const autoApproveLevels = safetyConfig.autoApprove;

            const response = await agent.processMessage(content, {
                hostname,
                onAction: (action) => {
                    // Check if this risk level should be auto-approved based on safety mode
                    const riskLevel = action.risk_level as RiskLevel;
                    if (autoApproveLevels.includes(riskLevel)) {
                        return Promise.resolve(true);
                    }
                    // Otherwise, prompt for approval
                    return new Promise((resolve) => {
                        setPendingAction({
                            ...action,
                            onApprove: () => {
                                setPendingAction(null);
                                resolve(true);
                            },
                            onDeny: () => {
                                setPendingAction(null);
                                resolve(false);
                            }
                        });
                    });
                },
                onOutput: () => {
                    // Output goes directly to the terminal via executeCommand
                },
                onActionExecuted: (action, result) => {
                    // If this was an interactive command, transform the interactive message into action message
                    // Otherwise, add a new action message
                    setMessages(prev => {
                        // Find if there's an interactive message for this action
                        const interactiveIdx = prev.findIndex(
                            m => m.role === 'interactive' &&
                                m.action?.command === action.command &&
                                m.action?.type === action.type
                        );

                        if (interactiveIdx !== -1) {
                            // Transform the interactive message into an action message
                            const updated = [...prev];
                            updated[interactiveIdx] = {
                                ...updated[interactiveIdx],
                                role: 'action',
                                content: action.description,
                                result
                            };
                            // Resume "Thinking..." since AI will continue processing
                            setIsProcessing(true);
                            return updated;
                        } else {
                            // Add new action message
                            return [...prev, {
                                role: 'action',
                                content: action.description,
                                timestamp: new Date(),
                                action,
                                result
                            }];
                        }
                    });
                },
                onInteractiveCommand: (action, hint) => {
                    // Stop the "thinking" animation and show hint to user
                    setIsProcessing(false);
                    const interactiveMessage: Message = {
                        role: 'interactive',
                        content: hint,
                        timestamp: new Date(),
                        action  // Include the action so we can show the command
                    };
                    setMessages(prev => [...prev, interactiveMessage]);
                },
                onIntermediateResponse: (intermediateResponse) => {
                    // Show AI response immediately (before waiting for interactive command)
                    intermediateResponseShown = true;
                    lastIntermediateResponse = intermediateResponse;
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: intermediateResponse,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, assistantMessage]);
                },
                executeCommand: async (command: string) => {
                    // Execute command via the terminal's persistent shell
                    if (terminalRef.current) {
                        return terminalRef.current.executeCommand(command);
                    }
                    return { output: 'Terminal not ready', exitCode: -1, cwd: '' };
                }
            });

            // Only add final response if it's different from intermediate response
            // or if no intermediate response was shown
            if (!intermediateResponseShown || response !== lastIntermediateResponse) {
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: response,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
            }

            // Update detected secrets list
            setDetectedSecrets(agent.getDetectedSecrets());
        } catch (error) {
            const errorMessage: Message = {
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`,
                timestamp: new Date(),
                isError: true
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsProcessing(false);
        }
    }, [agent, hostname, settings.safetyMode, terminalReady]);

    // Handle settings save
    const handleSaveSettings = useCallback(async (newSettings: Settings) => {
        await saveSettings(newSettings);
        setSettings(newSettings);
        setSettingsOpen(false);
    }, []);

    // Handle approval decisions
    const handleApprove = useCallback(() => {
        pendingAction?.onApprove();
    }, [pendingAction]);

    const handleDeny = useCallback(() => {
        pendingAction?.onDeny();
    }, [pendingAction]);

    // Clear terminal
    const handleClearTerminal = useCallback(() => {
        if (terminalRef.current) {
            terminalRef.current.clear();
        }
    }, []);

    const toggleTheme = () => {
        const newTheme = settings.theme === 'light' ? 'dark' : 'light';
        const newSettings: Settings = { ...settings, theme: newTheme };
        setSettings(newSettings);
        saveSettings(newSettings);
    };

    const handleClearSecrets = useCallback(() => {
        agent.clearSecrets();
        setDetectedSecrets([]);
    }, [agent]);

    // Check if API is configured
    const isConfigured = Boolean(settings.apiKey && settings.provider);

    return (
        <div className="ai-agent-container">
            {/* Compact Header Bar */}
            <div className="ai-agent-header">
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <RocketIcon className="header-icon" />
                            </FlexItem>
                            <FlexItem>
                                <span className="header-title">{_("AI Agent")}</span>
                            </FlexItem>
                            <FlexItem>
                                <span className="header-hostname">@ {hostname || 'loading...'}</span>
                            </FlexItem>
                            {settings.safetyMode !== 'paranoid' && (() => {
                                const config = SAFETY_MODES[settings.safetyMode];
                                const IconComponent = SAFETY_ICONS[config.icon];
                                return (
                                    <FlexItem>
                                        <span className={`safety-badge safety-badge--${config.variant}`}>
                                            <IconComponent className="safety-badge-icon" />
                                            {config.name}
                                        </span>
                                    </FlexItem>
                                );
                            })()}
                        </Flex>
                    </FlexItem>
                    <FlexItem>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <SecretsIndicator
                                    secrets={detectedSecrets}
                                    onClear={handleClearSecrets}
                                    isEnabled={settings.secretRedaction}
                                />
                            </FlexItem>
                            {settings.debugMode && (
                                <FlexItem>
                                    <Button
                                        variant="plain"
                                        aria-label="Toggle Debug Panel"
                                        onClick={() => setDebugPanelOpen(!debugPanelOpen)}
                                        className={`debug-toggle-btn ${debugPanelOpen ? 'debug-toggle-btn--active' : ''}`}
                                    >
                                        <BugIcon />
                                    </Button>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Button
                                    variant="plain"
                                    aria-label={settings.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                                    onClick={toggleTheme}
                                    className="header-settings-btn"
                                >
                                    {settings.theme === 'light' ? <MoonIcon /> : <SunIcon />}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                <Button
                                    variant="plain"
                                    aria-label="Settings"
                                    onClick={() => setSettingsOpen(true)}
                                    className="header-settings-btn"
                                >
                                    <CogIcon />
                                </Button>
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
            </div>

            {/* Main Content - Split View */}
            <div className="ai-agent-content">
                {/* Chat Panel - Left Side */}
                <div className="ai-agent-chat">
                    <ChatPanel
                        messages={messages}
                        isProcessing={isProcessing}
                        isConfigured={isConfigured}
                        onSendMessage={handleSendMessage}
                        onOpenSettings={() => setSettingsOpen(true)}
                        pendingAction={pendingAction}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                    />
                </div>

                {/* Terminal View - Right Side */}
                <div className="ai-agent-terminal">
                    <TerminalView
                        ref={terminalRef}
                        onReady={() => setTerminalReady(true)}
                    />
                </div>
            </div>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={settingsOpen}
                settings={settings}
                onSave={handleSaveSettings}
                onClose={() => setSettingsOpen(false)}
            />

            {/* Debug Panel */}
            {settings.debugMode && (
                <DebugPanel
                    isOpen={debugPanelOpen}
                    onClose={() => setDebugPanelOpen(false)}
                />
            )}
        </div>
    );
};
