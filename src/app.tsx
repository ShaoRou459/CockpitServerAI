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

const MAX_TERMINAL_SESSIONS = 6;

export const Application = () => {
    // State
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [hostname, setHostname] = useState<string>('');
    const [terminalReadyBySession, setTerminalReadyBySession] = useState<Record<string, boolean>>({});
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

    const activeSessionId = currentSession?.id ?? null;
    const terminalReady = activeSessionId ? Boolean(terminalReadyBySession[activeSessionId]) : false;

    // Per-session runtime pools (LRU-capped)
    const [terminalPool, setTerminalPool] = useState<string[]>([]); // most-recent first
    const terminalHandlesRef = useRef<Record<string, TerminalViewHandle | null>>({});
    const terminalReadyRef = useRef<Record<string, boolean>>({});
    const terminalReadyWaitersRef = useRef<Record<string, Array<() => void>>>({});
    const agentPoolRef = useRef<Record<string, AgentController>>({});

    const contentRef = useRef<HTMLDivElement>(null);

    const ensureTerminalMounted = useCallback((sessionId: string) => {
        setTerminalPool(prev => {
            const without = prev.filter(id => id !== sessionId);
            const next = [sessionId, ...without];

            if (next.length <= MAX_TERMINAL_SESSIONS) {
                return next;
            }

            const keep = next.slice(0, MAX_TERMINAL_SESSIONS);
            const evicted = next.slice(MAX_TERMINAL_SESSIONS);

            for (const evictedId of evicted) {
                delete terminalHandlesRef.current[evictedId];
                delete terminalReadyRef.current[evictedId];
                delete terminalReadyWaitersRef.current[evictedId];
                delete agentPoolRef.current[evictedId];
            }

            if (evicted.length > 0) {
                setTerminalReadyBySession(prevReady => {
                    let changed = false;
                    const nextReady = { ...prevReady };
                    for (const evictedId of evicted) {
                        if (evictedId in nextReady) {
                            delete nextReady[evictedId];
                            changed = true;
                        }
                    }
                    return changed ? nextReady : prevReady;
                });
            }

            return keep;
        });
    }, []);

    const evictRuntime = useCallback((sessionId: string) => {
        setTerminalPool(prev => prev.filter(id => id !== sessionId));

        delete terminalHandlesRef.current[sessionId];
        delete terminalReadyRef.current[sessionId];
        delete terminalReadyWaitersRef.current[sessionId];
        delete agentPoolRef.current[sessionId];

        setTerminalReadyBySession(prev => {
            if (!(sessionId in prev)) return prev;
            const next = { ...prev };
            delete next[sessionId];
            return next;
        });
    }, []);

    const markTerminalReady = useCallback((sessionId: string) => {
        terminalReadyRef.current[sessionId] = true;
        setTerminalReadyBySession(prev => ({ ...prev, [sessionId]: true }));

        const waiters = terminalReadyWaitersRef.current[sessionId];
        if (waiters && waiters.length > 0) {
            delete terminalReadyWaitersRef.current[sessionId];
            for (const w of waiters) w();
        }
    }, []);

    const waitForTerminalReady = useCallback((sessionId: string, timeoutMs: number = 10000): Promise<boolean> => {
        if (terminalReadyRef.current[sessionId]) return Promise.resolve(true);

        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            (terminalReadyWaitersRef.current[sessionId] ??= []).push(() => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }, []);

    const getOrCreateAgent = useCallback((sessionId: string): { agent: AgentController; created: boolean } => {
        const existing = agentPoolRef.current[sessionId];
        if (existing) return { agent: existing, created: false };

        const next = new AgentController();
        next.updateSettings(settings);
        agentPoolRef.current[sessionId] = next;
        return { agent: next, created: true };
    }, [settings]);

    const getActiveAgent = useCallback((): AgentController | null => {
        if (!activeSessionId) return null;
        return getOrCreateAgent(activeSessionId).agent;
    }, [activeSessionId, getOrCreateAgent]);

    // Keep all per-session agents in sync with current settings.
    useEffect(() => {
        for (const a of Object.values(agentPoolRef.current)) {
            a.updateSettings(settings);
        }
    }, [settings]);

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
                        ensureTerminalMounted(session.id);
                        const { agent, created } = getOrCreateAgent(session.id);
                        if (created) {
                            agent.setConversationHistory(session.messages
                                .filter(m => m.role === 'user' || m.role === 'assistant')
                                .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })));
                        }
                        // Restore messages, converting date strings back to Date objects
                        setMessages(session.messages.map(m => ({
                            ...m,
                            timestamp: new Date(m.timestamp)
                        })));
                    } else {
                        // Session file was corrupted, create new
                        const newSession = createSession();
                        setCurrentSession(newSession);
                        ensureTerminalMounted(newSession.id);
                        getOrCreateAgent(newSession.id);
                    }
                });
            } else {
                // No sessions exist, create a new one
                const newSession = createSession();
                setCurrentSession(newSession);
                ensureTerminalMounted(newSession.id);
                getOrCreateAgent(newSession.id);
            }
        });

        return () => hostnameFile.close();
    }, []);

    // Ensure the active chat always has a mounted terminal + agent (without losing per-session state).
    useEffect(() => {
        if (!activeSessionId) return;
        ensureTerminalMounted(activeSessionId);
        getOrCreateAgent(activeSessionId);
    }, [activeSessionId, ensureTerminalMounted, getOrCreateAgent]);

    // After session switch / layout changes, nudge xterm to refit.
    useEffect(() => {
        if (!activeSessionId) return;
        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
        });
    }, [activeSessionId, terminalVisible, chatPanelWidth]);

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
        // Sync debug logger with settings
        debugLogger.setEnabled(settings.debugMode);

        // Apply theme to document element for PatternFly and CSS variables
        if (settings.theme === 'dark') {
            document.documentElement.classList.add('pf-v6-theme-dark');
        } else {
            document.documentElement.classList.remove('pf-v6-theme-dark');
        }
    }, [settings]);

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
        const sessionId = activeSessionId;
        if (!sessionId) {
            return;
        }

        // Make sure this chat has a live terminal/agent runtime (LRU-capped).
        ensureTerminalMounted(sessionId);
        const { agent: activeAgent } = getOrCreateAgent(sessionId);

        // Add user message
        const userMessage: Message = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            role: 'user',
            content,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        setIsProcessing(true);

        // Track if we've already shown an intermediate response (to avoid duplicates)
        let intermediateResponseShown = false;
        let lastIntermediateResponse = '';
        let streamingMessageId: string | null = null;
        let streamRaf: number | null = null;
        let pendingStreamText = '';

        const upsertStreamingAssistantMessage = (text: string) => {
            setMessages(prev => {
                if (!streamingMessageId) {
                    // If this is just a reset call, don't create an empty bubble.
                    if (!text) return prev;
                    streamingMessageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    return [...prev, {
                        id: streamingMessageId,
                        role: 'assistant',
                        content: text,
                        timestamp: new Date()
                    }];
                }

                const idx = prev.findIndex(m => m.id === streamingMessageId);
                if (idx === -1) {
                    return [...prev, {
                        id: streamingMessageId,
                        role: 'assistant',
                        content: text,
                        timestamp: new Date()
                    }];
                }

                const updated = [...prev];
                updated[idx] = {
                    ...updated[idx],
                    content: text
                };
                return updated;
            });
        };

        try {
            const getActionKey = (action: PendingAction | Message['action'] | null | undefined) => {
                if (!action) return '';
                switch (action.type) {
                    case 'command':
                        return `command:${action.command ?? ''}`;
                    case 'file_read':
                        return `file_read:${action.path ?? ''}`;
                    case 'file_write':
                        return `file_write:${action.path ?? ''}`;
                    case 'service':
                        return `service:${action.operation ?? ''}:${action.service ?? ''}`;
                    default:
                        return `${action.type}`;
                }
            };

            // Get the auto-approve levels for current safety mode
            const safetyConfig = SAFETY_MODES[settings.safetyMode];
            const autoApproveLevels = safetyConfig.autoApprove;

            const response = await activeAgent.processMessage(content, {
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
                onActionStarted: (action) => {
                    // Add an action message immediately so the user sees what is running
                    // (result will be filled in by onActionExecuted)
                    setMessages(prev => {
                        const nextActionMsg: Message = {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                            role: 'action',
                            content: action.description,
                            timestamp: new Date(),
                            action
                        };

                        // If we are currently streaming an assistant response, keep the explanation bubble
                        // above the command(s) in that turn.
                        if (!streamingMessageId) return [...prev, nextActionMsg];

                        const streamIdx = prev.findIndex(m => m.id === streamingMessageId);
                        if (streamIdx === -1) return [...prev, nextActionMsg];

                        const updated = [...prev];
                        let insertAt = streamIdx + 1;
                        // Keep commands in chronological order if multiple actions start while streaming.
                        while (insertAt < updated.length && updated[insertAt].role === 'action' && !updated[insertAt].result) {
                            insertAt++;
                        }
                        updated.splice(insertAt, 0, nextActionMsg);
                        return updated;
                    });
                },
                onActionExecuted: (action, result) => {
                    // If this was an interactive command, transform the interactive message into action message
                    // Otherwise, add a new action message
                    setMessages(prev => {
                        const key = getActionKey(action);

                        // Find if there's an interactive message for this action
                        const interactiveIdx = prev.findIndex(m =>
                            m.role === 'interactive' && getActionKey(m.action) === key
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
                        }

                        // If we already added a "running" action bubble, update it in place
                        const runningActionIdx = prev.findIndex(m =>
                            m.role === 'action' &&
                            !m.result &&
                            getActionKey(m.action) === key
                        );

                        if (runningActionIdx !== -1) {
                            const updated = [...prev];
                            updated[runningActionIdx] = {
                                ...updated[runningActionIdx],
                                content: action.description,
                                result
                            };
                            return updated;
                        }

                        // Fallback: add a new action message
                        return [...prev, {
                            role: 'action',
                            content: action.description,
                            timestamp: new Date(),
                            action,
                            result
                        }];
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
                        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        role: 'assistant',
                        content: intermediateResponse,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, assistantMessage]);
                },
                ...(settings.streamResponses ? {
                    onAssistantStream: (text: string) => {
                        // Treat empty string as a boundary between iterations (don't wipe existing text).
                        if (!text) {
                            streamingMessageId = null;
                            pendingStreamText = '';
                            if (streamRaf !== null) {
                                cancelAnimationFrame(streamRaf);
                                streamRaf = null;
                            }
                            return;
                        }

                        pendingStreamText = text;
                        if (streamRaf !== null) return;
                        streamRaf = requestAnimationFrame(() => {
                            streamRaf = null;
                            intermediateResponseShown = true;
                            lastIntermediateResponse = pendingStreamText;
                            upsertStreamingAssistantMessage(pendingStreamText);
                        });
                    }
                } : {}),
                executeCommand: async (command: string) => {
                    // Execute command via the terminal's persistent shell
                    ensureTerminalMounted(sessionId);

                    const ready = await waitForTerminalReady(sessionId);
                    if (!ready) {
                        return { output: 'Terminal not ready', exitCode: -1, cwd: '' };
                    }

                    const handle = terminalHandlesRef.current[sessionId];
                    if (handle) return handle.executeCommand(command);
                    return { output: 'Terminal not ready', exitCode: -1, cwd: '' };
                }
            });

            // Only add final response if it's different from intermediate response
            // or if no intermediate response was shown
            if (streamingMessageId) {
                upsertStreamingAssistantMessage(response);
                lastIntermediateResponse = response;
                intermediateResponseShown = true;
            } else if (!intermediateResponseShown || response !== lastIntermediateResponse) {
                const assistantMessage: Message = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    role: 'assistant',
                    content: response,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
            }

            // Update detected secrets list
            setDetectedSecrets(activeAgent.getDetectedSecrets());
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
    }, [activeSessionId, ensureTerminalMounted, getOrCreateAgent, hostname, settings.safetyMode, settings.streamResponses, terminalReady, waitForTerminalReady]);

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
        getActiveAgent()?.abort();
        setIsProcessing(false);
    }, [getActiveAgent]);

    const toggleTheme = () => {
        const newTheme = settings.theme === 'light' ? 'dark' : 'light';
        const newSettings: Settings = { ...settings, theme: newTheme };
        setSettings(newSettings);
        saveSettings(newSettings);
    };

    const handleClearSecrets = useCallback(() => {
        // Secrets are managed globally, so clearing on any controller is sufficient; clear all for consistency.
        for (const a of Object.values(agentPoolRef.current)) {
            a.clearSecrets();
        }
        setDetectedSecrets([]);
    }, []);

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
        setPendingAction(null);
        setIsProcessing(false);

        // Ensure this chat gets its own runtime (and is MRU in the terminal pool).
        ensureTerminalMounted(newSession.id);
        getOrCreateAgent(newSession.id);
        setDrawerOpen(false);
    }, [ensureTerminalMounted, getOrCreateAgent]);

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

            ensureTerminalMounted(session.id);
            const { agent, created } = getOrCreateAgent(session.id);
            if (created) {
                agent.setConversationHistory(session.messages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })));
            }
            setPendingAction(null);
            setIsProcessing(false);
        }
        setDrawerOpen(false);
    }, [currentSession?.id, ensureTerminalMounted, getOrCreateAgent]);

    const handleDeleteSession = useCallback(async (id: string) => {
        await deleteSession(id);
        evictRuntime(id);
        const updatedSessions = sessions.filter(s => s.id !== id);
        setSessions(updatedSessions);

        // If we deleted the current session, create a new one
        if (id === currentSession?.id) {
            setPendingAction(null);
            setIsProcessing(false);

            if (updatedSessions.length > 0) {
                const session = await loadSession(updatedSessions[0].id);
                if (session) {
                    setCurrentSession(session);
                    setMessages(session.messages.map(m => ({
                        ...m,
                        timestamp: new Date(m.timestamp)
                    })));

                    ensureTerminalMounted(session.id);
                    const { agent, created } = getOrCreateAgent(session.id);
                    if (created) {
                        agent.setConversationHistory(session.messages
                            .filter(m => m.role === 'user' || m.role === 'assistant')
                            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })));
                    }
                } else {
                    handleNewSession();
                }
            } else {
                handleNewSession();
            }
        }
    }, [sessions, currentSession?.id, handleNewSession, ensureTerminalMounted, getOrCreateAgent, evictRuntime]);

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

                {/* Terminal View - Right Side (per-chat terminal sessions, LRU-capped) */}
                <div
                    className="ai-agent-terminal"
                    style={{
                        flex: `0 0 ${100 - chatPanelWidth}%`,
                        display: terminalVisible ? 'flex' : 'none',
                        position: 'relative',
                    }}
                >
                    {terminalPool.map(id => (
                        <div
                            key={id}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: id === activeSessionId ? 'block' : 'none',
                            }}
                        >
                            <TerminalView
                                ref={(handle) => {
                                    terminalHandlesRef.current[id] = handle;
                                }}
                                onReady={() => markTerminalReady(id)}
                            />
                        </div>
                    ))}
                </div>
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
