/*
 * Cockpit AI Agent - Main Application
 * 
 * An AI-powered terminal assistant for server administration
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Flex, FlexItem, Button, Tooltip } from "@patternfly/react-core";
import { CogIcon, RocketIcon, LockIcon, ShieldAltIcon, BoltIcon, SkullIcon, MoonIcon, SunIcon, BugIcon, TerminalIcon, ColumnsIcon, HistoryIcon } from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { ChatPanel } from './components/ChatPanel';
import { TerminalView, TerminalViewHandle } from './components/TerminalView';
import { SettingsModal } from './components/SettingsModal';
import { SecretsIndicator } from './components/SecretsIndicator';
import { DebugPanel } from './components/DebugPanel';
import { OnboardingModal } from './components/OnboardingModal';
import { ErrorModal } from './components/ErrorModal';
import type { ApiError } from './components/ErrorModal';
import { SessionDrawer } from './components/SessionDrawer';
import { AgentController } from './lib/agent';
import { ApiRetryError } from './lib/ai-client';
import { loadSettings, saveSettings, Settings, DEFAULT_SETTINGS, SAFETY_MODES, RiskLevel } from './lib/settings';
import { debugLogger } from './lib/debug-logger';
import {
    loadSessionList,
    loadSession,
    saveSession,
    deleteSession,
    createSession,
} from './lib/sessions';

import type { Message, PendingAction, ChatSession, SessionMetadata } from './lib/types';

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
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [apiError, setApiError] = useState<ApiError | null>(null);
    const [errorModalOpen, setErrorModalOpen] = useState(false);
    const [lastUserMessage, setLastUserMessage] = useState<string>('');
    const [terminalVisible, setTerminalVisible] = useState(true);
    const [chatPanelWidth, setChatPanelWidth] = useState(50); // percentage
    const [isResizing, setIsResizing] = useState(false);

    // Session state
    const [sessions, setSessions] = useState<SessionMetadata[]>([]);
    const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [sessionSaveTimeout, setSessionSaveTimeout] = useState<NodeJS.Timeout | null>(null);

    // Terminal ref for sending commands
    const terminalRef = useRef<TerminalViewHandle>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Initialize agent controller
    const [agent] = useState(() => new AgentController());

    // Load settings and hostname on mount
    useEffect(() => {
        loadSettings().then(s => {
            setSettings(s);
            setSettingsLoaded(true);
            // Show onboarding if not completed
            if (!s.onboardingComplete) {
                setOnboardingOpen(true);
            }
        });

        const hostnameFile = cockpit.file('/etc/hostname');
        hostnameFile.watch(content => setHostname((content as string)?.trim() ?? 'unknown'));

        // Load sessions and create/restore current session
        loadSessionList().then(sessionList => {
            setSessions(sessionList);
            if (sessionList.length > 0) {
                // Load the most recent session
                loadSession(sessionList[0].id).then(session => {
                    if (session) {
                        setCurrentSession(session);
                        // Restore messages, converting date strings back to Date objects
                        setMessages(session.messages.map(m => ({
                            ...m,
                            timestamp: new Date(m.timestamp)
                        })));
                    } else {
                        // Session file was corrupted, create new
                        const newSession = createSession();
                        setCurrentSession(newSession);
                    }
                });
            } else {
                // No sessions exist, create a new one
                const newSession = createSession();
                setCurrentSession(newSession);
            }
        });

        return () => hostnameFile.close();
    }, []);

    // Auto-save session when messages change (debounced)
    useEffect(() => {
        if (!currentSession || messages.length === 0) return;

        // Clear existing timeout
        if (sessionSaveTimeout) {
            clearTimeout(sessionSaveTimeout);
        }

        // Debounce save by 1 second
        const timeout = setTimeout(() => {
            const updatedSession: ChatSession = {
                ...currentSession,
                messages: messages.map(m => ({
                    ...m,
                    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
                })) as any,
                updatedAt: new Date().toISOString()
            };
            saveSession(updatedSession).then(() => {
                setCurrentSession(updatedSession);
                // Refresh session list
                loadSessionList().then(setSessions);
            }).catch(err => {
                console.error('Failed to save session:', err);
            });
        }, 1000);

        setSessionSaveTimeout(timeout);

        return () => {
            if (timeout) clearTimeout(timeout);
        };
    }, [messages, currentSession?.id]);

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
            // Check if this is an ApiRetryError (after all retries exhausted)
            if (error instanceof ApiRetryError) {
                // Show the custom error modal
                setApiError({
                    message: error.message,
                    provider: error.provider,
                    endpoint: error.endpoint,
                    statusCode: error.statusCode,
                    attemptsMade: error.attemptsMade,
                    maxRetries: error.maxRetries,
                    lastAttemptTime: error.lastAttemptTime
                });
                setLastUserMessage(content);
                setErrorModalOpen(true);

                // Also add a brief message in the chat
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `Connection failed after ${error.attemptsMade} attempts. Click the error notification for details.`,
                    timestamp: new Date(),
                    isError: true
                };
                setMessages(prev => [...prev, errorMessage]);
            } else {
                // Handle other errors normally
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`,
                    timestamp: new Date(),
                    isError: true
                };
                setMessages(prev => [...prev, errorMessage]);
            }
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

    // Handle stop processing - abort in-flight requests
    const handleStop = useCallback(() => {
        agent.abort();
        setIsProcessing(false);
    }, [agent]);

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

    // Handle onboarding completion
    const handleOnboardingComplete = useCallback(async (newSettings: Settings) => {
        await saveSettings(newSettings);
        setSettings(newSettings);
        setOnboardingOpen(false);
    }, []);

    // Check if API is configured
    const isConfigured = Boolean(settings.apiKey && settings.provider);

    // Terminal toggle
    const toggleTerminal = useCallback(() => {
        setTerminalVisible(prev => !prev);
    }, []);

    // Resize handlers for draggable divider
    const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    const handleResize = useCallback((clientX: number) => {
        if (!contentRef.current) return;

        const containerRect = contentRef.current.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const relativeX = clientX - containerRect.left;

        // Calculate percentage, clamped between 25% and 75%
        let percentage = (relativeX / containerWidth) * 100;
        percentage = Math.max(25, Math.min(75, percentage));

        setChatPanelWidth(percentage);
    }, []);

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false);
    }, []);

    // Global mouse/touch move and up handlers for resize
    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            handleResize(e.clientX);
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length > 0) {
                handleResize(e.touches[0].clientX);
            }
        };

        const handleMouseUp = () => {
            handleResizeEnd();
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleMouseUp);

        // Add no-select class to body during resize
        document.body.classList.add('resizing');

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleMouseUp);
            document.body.classList.remove('resizing');
        };
    }, [isResizing, handleResize, handleResizeEnd]);

    // Session handlers
    const handleNewSession = useCallback(() => {
        const newSession = createSession();
        setCurrentSession(newSession);
        setMessages([]);
        agent.clearConversationHistory();
        setDrawerOpen(false);
    }, [agent]);

    const handleSelectSession = useCallback(async (id: string) => {
        if (id === currentSession?.id) {
            setDrawerOpen(false);
            return;
        }

        const session = await loadSession(id);
        if (session) {
            setCurrentSession(session);
            setMessages(session.messages.map(m => ({
                ...m,
                timestamp: new Date(m.timestamp)
            })));
            agent.clearConversationHistory();
        }
        setDrawerOpen(false);
    }, [currentSession?.id, agent]);

    const handleDeleteSession = useCallback(async (id: string) => {
        await deleteSession(id);
        const updatedSessions = sessions.filter(s => s.id !== id);
        setSessions(updatedSessions);

        // If we deleted the current session, create a new one
        if (id === currentSession?.id) {
            if (updatedSessions.length > 0) {
                const session = await loadSession(updatedSessions[0].id);
                if (session) {
                    setCurrentSession(session);
                    setMessages(session.messages.map(m => ({
                        ...m,
                        timestamp: new Date(m.timestamp)
                    })));
                } else {
                    handleNewSession();
                }
            } else {
                handleNewSession();
            }
        }
    }, [sessions, currentSession?.id, handleNewSession]);

    const handleClearChat = useCallback(() => {
        handleNewSession();
    }, [handleNewSession]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if user is typing in an input field
            const activeElement = document.activeElement;
            const isTyping = activeElement?.tagName === 'INPUT' ||
                activeElement?.tagName === 'TEXTAREA' ||
                (activeElement as HTMLElement)?.isContentEditable;

            // Ctrl+L - Clear chat (only when not typing)
            if (e.ctrlKey && e.key === 'l' && !isTyping) {
                e.preventDefault();
                handleClearChat();
                return;
            }

            // Ctrl+` - Toggle terminal
            if (e.ctrlKey && e.key === '`') {
                e.preventDefault();
                toggleTerminal();
                return;
            }

            // Ctrl+, - Open settings
            if (e.ctrlKey && e.key === ',') {
                e.preventDefault();
                setSettingsOpen(true);
                return;
            }

            // Ctrl+H - Toggle history drawer
            if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                setDrawerOpen(prev => !prev);
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleClearChat, toggleTerminal]);

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
                                <Tooltip content={_("Chat History (Ctrl+H)")}>
                                    <Button
                                        variant="plain"
                                        aria-label="Chat History"
                                        onClick={() => setDrawerOpen(prev => !prev)}
                                        className={`header-settings-btn ${drawerOpen ? 'header-settings-btn--active' : ''}`}
                                    >
                                        <HistoryIcon />
                                    </Button>
                                </Tooltip>
                            </FlexItem>
                            <FlexItem>
                                <Tooltip content={terminalVisible ? _("Hide Terminal (Immersive Chat)") : _("Show Terminal")}>
                                    <Button
                                        variant="plain"
                                        aria-label={terminalVisible ? "Hide Terminal" : "Show Terminal"}
                                        onClick={toggleTerminal}
                                        className={`header-settings-btn terminal-toggle-btn ${!terminalVisible ? 'terminal-toggle-btn--hidden' : ''}`}
                                    >
                                        {terminalVisible ? <ColumnsIcon /> : <TerminalIcon />}
                                    </Button>
                                </Tooltip>
                            </FlexItem>
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
            <div
                className={`ai-agent-content ${isResizing ? 'ai-agent-content--resizing' : ''} ${!terminalVisible ? 'ai-agent-content--full-chat' : ''}`}
                ref={contentRef}
            >
                {/* Chat Panel - Left Side */}
                <div
                    className="ai-agent-chat"
                    style={{
                        flex: terminalVisible ? `0 0 ${chatPanelWidth}%` : '1 1 100%',
                        maxWidth: terminalVisible ? `${chatPanelWidth}%` : '100%'
                    }}
                >
                    <ChatPanel
                        messages={messages}
                        isProcessing={isProcessing}
                        isConfigured={isConfigured}
                        onSendMessage={handleSendMessage}
                        onOpenSettings={() => setSettingsOpen(true)}
                        pendingAction={pendingAction}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        onStop={handleStop}
                    />
                </div>

                {/* Resizable Divider */}
                {terminalVisible && (
                    <div
                        className={`resize-divider ${isResizing ? 'resize-divider--active' : ''}`}
                        onMouseDown={handleResizeStart}
                        onTouchStart={handleResizeStart}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize panels"
                        tabIndex={0}
                    >
                        <div className="resize-divider__handle">
                            <div className="resize-divider__dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Terminal View - Right Side */}
                {terminalVisible && (
                    <div
                        className="ai-agent-terminal"
                        style={{ flex: `0 0 ${100 - chatPanelWidth}%` }}
                    >
                        <TerminalView
                            ref={terminalRef}
                            onReady={() => setTerminalReady(true)}
                        />
                    </div>
                )}
            </div>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={settingsOpen}
                settings={settings}
                onSave={handleSaveSettings}
                onClose={() => setSettingsOpen(false)}
                onRestartOnboarding={() => setOnboardingOpen(true)}
            />

            {/* Debug Panel */}
            {settings.debugMode && (
                <DebugPanel
                    isOpen={debugPanelOpen}
                    onClose={() => setDebugPanelOpen(false)}
                />
            )}

            {/* Session History Drawer */}
            <SessionDrawer
                isOpen={drawerOpen}
                sessions={sessions}
                currentSessionId={currentSession?.id || null}
                onClose={() => setDrawerOpen(false)}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
            />

            {/* Onboarding Modal */}
            <OnboardingModal
                isOpen={onboardingOpen}
                initialSettings={settings}
                onComplete={handleOnboardingComplete}
            />

            {/* Error Modal */}
            <ErrorModal
                isOpen={errorModalOpen}
                error={apiError}
                onClose={() => {
                    setErrorModalOpen(false);
                    setApiError(null);
                }}
                onRetry={() => {
                    setErrorModalOpen(false);
                    setApiError(null);
                    if (lastUserMessage) {
                        handleSendMessage(lastUserMessage);
                    }
                }}
            />
        </div>
    );
};
