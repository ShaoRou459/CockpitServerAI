/*
 * Cockpit AI Agent - Main Application
 * 
 * An AI-powered terminal assistant for server administration
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
    Flex,
    FlexItem,
    Button,
} from "@patternfly/react-core";
import { CogIcon, RocketIcon } from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { ChatPanel } from './components/ChatPanel';
import { TerminalView } from './components/TerminalView';
import { SettingsModal } from './components/SettingsModal';
import { AgentController } from './lib/agent';
import { loadSettings, saveSettings, Settings, DEFAULT_SETTINGS } from './lib/settings';

import type { Message, PendingAction } from './lib/types';

const _ = cockpit.gettext;

export const Application = () => {
    // State
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [terminalOutput, setTerminalOutput] = useState<string>('');
    const [hostname, setHostname] = useState<string>('');

    // Initialize agent controller
    const [agent] = useState(() => new AgentController());

    // Load settings and hostname on mount
    useEffect(() => {
        loadSettings().then(setSettings);

        const hostnameFile = cockpit.file('/etc/hostname');
        hostnameFile.watch(content => setHostname(content?.trim() ?? 'unknown'));
        return () => hostnameFile.close();
    }, []);

    // Update agent when settings change
    useEffect(() => {
        agent.updateSettings(settings);
    }, [settings, agent]);

    // Add welcome message on first load
    useEffect(() => {
        if (messages.length === 0) {
            setMessages([{
                role: 'assistant',
                content: `Hello! I'm your AI assistant for managing this server (${hostname || 'loading...'}). I can help you with:\n\n• Running shell commands\n• Managing services\n• Checking system status\n• Troubleshooting issues\n\nWhat would you like to do?`,
                timestamp: new Date()
            }]);
        }
    }, [hostname, messages.length]);

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

        try {
            const response = await agent.processMessage(content, {
                hostname,
                onAction: (action) => {
                    // If YOLO mode and low risk, auto-execute
                    if (settings.yoloMode && action.risk_level === 'low') {
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
                onOutput: (output) => {
                    setTerminalOutput(prev => prev + output);
                },
                onActionExecuted: (action, result) => {
                    // Add action to chat
                    const actionMessage: Message = {
                        role: 'action',
                        content: action.description,
                        timestamp: new Date(),
                        action,
                        result
                    };
                    setMessages(prev => [...prev, actionMessage]);
                }
            });

            // Add assistant response
            const assistantMessage: Message = {
                role: 'assistant',
                content: response,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, assistantMessage]);
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
    }, [agent, hostname, settings.yoloMode]);

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
                            {settings.yoloMode && (
                                <FlexItem>
                                    <span className="yolo-badge">⚡ YOLO</span>
                                </FlexItem>
                            )}
                        </Flex>
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
                        output={terminalOutput}
                        onClear={() => setTerminalOutput('')}
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
        </div>
    );
};
