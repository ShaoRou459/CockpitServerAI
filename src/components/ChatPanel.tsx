/*
 * ChatPanel - Chat interface component with inline command approval
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Card,
    CardBody,
    CardFooter,
    TextArea,
    Button,
    Flex,
    FlexItem,
    Spinner,
    EmptyState,
    EmptyStateBody,
    EmptyStateActions,
    EmptyStateFooter,
    Label,
    ExpandableSection,
} from "@patternfly/react-core";
import {
    PaperPlaneIcon,
    CogIcon,
    RobotIcon,
    TerminalIcon,
    CheckCircleIcon,
    TimesCircleIcon,
    ExclamationTriangleIcon,
    ShieldAltIcon,
    FileIcon,
    FileCodeIcon,
    AngleRightIcon,
    AngleDownIcon,
    StopCircleIcon,
} from "@patternfly/react-icons";
import cockpit from 'cockpit';
import { marked } from 'marked';

import type { Message, PendingAction, Action } from '../lib/types';

// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

const _ = cockpit.gettext;

interface ChatPanelProps {
    messages: Message[];
    isProcessing: boolean;
    isConfigured: boolean;
    onSendMessage: (message: string) => void;
    onOpenSettings: () => void;
    pendingAction: PendingAction | null;
    onApprove: () => void;
    onDeny: () => void;
    onStop?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages,
    isProcessing,
    isConfigured,
    onSendMessage,
    onOpenSettings,
    pendingAction,
    onApprove,
    onDeny,
    onStop
}) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when messages change or pending action appears
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, pendingAction]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (input.trim() && isConfigured && !isProcessing) {
            onSendMessage(input.trim());
            setInput('');
        }
    };

    const handleStop = () => {
        if (onStop) {
            onStop();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    // Not configured state
    if (!isConfigured) {
        return (
            <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardBody style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <EmptyState>
                        <RobotIcon />
                        <EmptyStateBody>
                            {_("Configure your AI provider to get started. You'll need an API key from OpenAI, Google Gemini, or a custom provider.")}
                        </EmptyStateBody>
                        <EmptyStateFooter>
                            <EmptyStateActions>
                                <Button
                                    variant="primary"
                                    icon={<CogIcon />}
                                    onClick={onOpenSettings}
                                >
                                    {_("Configure AI Provider")}
                                </Button>
                            </EmptyStateActions>
                        </EmptyStateFooter>
                    </EmptyState>
                </CardBody>
            </Card>
        );
    }

    return (
        <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Messages Area */}
            <CardBody style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                <div className="chat-messages">
                    {messages.map((message, index) => (
                        <MessageBubble key={index} message={message} />
                    ))}

                    {/* Inline Approval Card */}
                    {pendingAction && (
                        <InlineApproval
                            action={pendingAction}
                            onApprove={onApprove}
                            onDeny={onDeny}
                        />
                    )}

                    {isProcessing && !pendingAction && (
                        <div className="message-bubble assistant processing">
                            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                <FlexItem>
                                    <Spinner size="sm" />
                                </FlexItem>
                                <FlexItem>
                                    {_("Thinking...")}
                                </FlexItem>
                            </Flex>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </CardBody>

            {/* Input Area */}
            <CardFooter>
                <form onSubmit={handleSubmit} className="chat-input-form">
                    <div className="chat-input-container">
                        <TextArea
                            value={input}
                            onChange={(_e, value) => setInput(value)}
                            onKeyDown={handleKeyDown}
                            placeholder={_("Ask me to help manage this server...")}
                            aria-label="Message input"
                            rows={2}
                            resizeOrientation="vertical"
                            isDisabled={!!pendingAction}
                        />
                        {isProcessing ? (
                            <Button
                                type="button"
                                variant="danger"
                                onClick={handleStop}
                                aria-label="Stop response"
                                className="chat-action-button"
                            >
                                <StopCircleIcon />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                variant="primary"
                                isDisabled={!input.trim() || !!pendingAction}
                                aria-label="Send message"
                                className="chat-action-button"
                            >
                                <PaperPlaneIcon />
                            </Button>
                        )}
                    </div>
                </form>
            </CardFooter>
        </Card>
    );
};

// Collapsible file content component
const FileContentCollapsible: React.FC<{
    label: string;
    content: string;
    isExpanded?: boolean;
}> = ({ label, content, isExpanded = false }) => {
    const [expanded, setExpanded] = useState(isExpanded);
    const lineCount = content.split('\n').length;
    const charCount = content.length;

    return (
        <div className="file-content-collapsible">
            <button
                className="file-content-toggle"
                onClick={() => setExpanded(!expanded)}
                type="button"
            >
                <span className="file-content-toggle-icon">
                    {expanded ? <AngleDownIcon /> : <AngleRightIcon />}
                </span>
                <span className="file-content-toggle-label">{label}</span>
                <span className="file-content-toggle-meta">
                    {lineCount} {lineCount === 1 ? 'line' : 'lines'} • {charCount} chars
                </span>
            </button>
            {expanded && (
                <div className="file-content-body">
                    <pre>{content}</pre>
                </div>
            )}
        </div>
    );
};

// Compact inline approval component
const InlineApproval: React.FC<{
    action: PendingAction;
    onApprove: () => void;
    onDeny: () => void;
}> = ({ action, onApprove, onDeny }) => {
    const [expanded, setExpanded] = useState(false);

    // Get the primary display text
    const getPrimaryText = () => {
        switch (action.type) {
            case 'command':
                return `$ ${action.command}`;
            case 'file_read':
                return `read ${action.path}`;
            case 'file_write':
                return `write ${action.path}`;
            case 'service':
                return `systemctl ${action.operation} ${action.service}`;
            default:
                return action.description;
        }
    };

    const getRiskColor = () => {
        switch (action.risk_level) {
            case 'low': return '#3e8635';
            case 'medium': return '#f0ab00';
            case 'high': return '#c9190b';
            case 'critical': return '#6753ac';
            default: return '#f0ab00';
        }
    };

    return (
        <div className={`approval-compact risk-${action.risk_level}`} style={{ borderLeftColor: getRiskColor() }}>
            <div className="approval-compact-header">
                <button
                    className="approval-compact-toggle"
                    onClick={() => setExpanded(!expanded)}
                    type="button"
                >
                    <span className="action-compact-icon">
                        {expanded ? <AngleDownIcon /> : <AngleRightIcon />}
                    </span>
                    <span className="approval-compact-risk" style={{ color: getRiskColor() }}>
                        <ExclamationTriangleIcon />
                    </span>
                    <code className="action-compact-command">{getPrimaryText()}</code>
                </button>
                <div className="approval-compact-buttons">
                    <button
                        className="approval-compact-btn approve"
                        onClick={onApprove}
                        title="Approve"
                    >
                        <CheckCircleIcon />
                    </button>
                    <button
                        className="approval-compact-btn deny"
                        onClick={onDeny}
                        title="Deny"
                    >
                        <TimesCircleIcon />
                    </button>
                </div>
            </div>
            {expanded && (
                <div className="action-compact-details">
                    <div className="action-compact-description">
                        {action.description}
                    </div>
                    {action.type === 'file_write' && action.content && (
                        <FileContentCollapsible
                            label="Content to Write"
                            content={action.content}
                        />
                    )}
                    {action.risk_level === 'critical' && (
                        <div className="approval-compact-warning">
                            Critical operation - review carefully
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Get the appropriate icon for action type
const getActionIcon = (type: Action['type']) => {
    switch (type) {
        case 'file_read':
        case 'file_write':
            return <FileCodeIcon />;
        case 'command':
        case 'service':
        default:
            return <TerminalIcon />;
    }
};

// Message bubble component
// Compact action message component
const ActionBubble: React.FC<{ message: Message }> = ({ message }) => {
    const [expanded, setExpanded] = useState(false);
    const success = message.result?.success;
    const action = message.action!;

    // Get the primary display text (command, path, or service operation)
    const getPrimaryText = () => {
        switch (action.type) {
            case 'command':
                return `$ ${action.command}`;
            case 'file_read':
                return `read ${action.path}`;
            case 'file_write':
                return `write ${action.path}`;
            case 'service':
                return `systemctl ${action.operation} ${action.service}`;
            default:
                return action.description;
        }
    };

    const hasOutput = message.result?.stdout || message.result?.stderr ||
        (action.type === 'file_write' && action.content) ||
        (action.type === 'file_read' && message.result?.stdout);

    return (
        <div className={`action-compact ${success ? 'success' : 'failure'}`}>
            <button
                className="action-compact-header"
                onClick={() => setExpanded(!expanded)}
                type="button"
            >
                <span className="action-compact-icon">
                    {expanded ? <AngleDownIcon /> : <AngleRightIcon />}
                </span>
                <span className={`action-compact-status ${success ? 'success' : 'failure'}`}>
                    {success ? <CheckCircleIcon /> : <TimesCircleIcon />}
                </span>
                <code className="action-compact-command">{getPrimaryText()}</code>
            </button>
            {expanded && (
                <div className="action-compact-details">
                    <div className="action-compact-description">
                        {action.description}
                    </div>
                    {/* Command output */}
                    {action.type === 'command' && message.result?.stdout && (
                        <div className="action-compact-output">
                            <pre>{message.result.stdout}</pre>
                        </div>
                    )}
                    {/* Error output */}
                    {message.result?.stderr && (
                        <div className="action-compact-output error">
                            <pre>{message.result.stderr}</pre>
                        </div>
                    )}
                    {/* File write content */}
                    {action.type === 'file_write' && action.content && (
                        <FileContentCollapsible
                            label="Content Written"
                            content={action.content}
                        />
                    )}
                    {/* File read content */}
                    {action.type === 'file_read' && message.result?.stdout && (
                        <FileContentCollapsible
                            label="Content Read"
                            content={message.result.stdout}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

// Interactive command notification
const InteractiveBubble: React.FC<{ message: Message }> = ({ message }) => {
    const action = message.action;

    // Get the command text to display
    const getCommandText = () => {
        if (!action) return null;
        switch (action.type) {
            case 'command':
                return `$ ${action.command}`;
            case 'file_read':
                return `read ${action.path}`;
            case 'file_write':
                return `write ${action.path}`;
            case 'service':
                return `systemctl ${action.operation} ${action.service}`;
            default:
                return action.description;
        }
    };

    const commandText = getCommandText();

    return (
        <div className="interactive-notice">
            <div className="interactive-notice-header">
                <TerminalIcon className="interactive-notice-icon" />
                <span className="interactive-notice-title">Interactive Command</span>
            </div>
            {commandText && (
                <div className="interactive-notice-command">
                    <code>{commandText}</code>
                </div>
            )}
            <div className="interactive-notice-hint">
                {message.content}
            </div>
        </div>
    );
};

const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const isUser = message.role === 'user';
    const isAction = message.role === 'action';
    const isInteractive = message.role === 'interactive';
    const isError = message.isError;

    // Special rendering for action messages - use compact view
    if (isAction && message.action) {
        return <ActionBubble message={message} />;
    }

    // Special rendering for interactive command notices
    if (isInteractive) {
        return <InteractiveBubble message={message} />;
    }

    // Parse markdown for assistant messages
    const renderContent = () => {
        if (isUser) {
            // User messages: plain text with line breaks
            return message.content.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                    {line}
                    {i < message.content.split('\n').length - 1 && <br />}
                </React.Fragment>
            ));
        } else {
            // Assistant messages: parse markdown
            const html = marked.parse(message.content) as string;
            return (
                <div
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        }
    };

    return (
        <div className={`message-bubble ${message.role} ${isError ? 'error' : ''}`}>
            <div className="message-content">
                {renderContent()}
            </div>
            <div className="message-time">
                {message.timestamp.toLocaleTimeString()}
            </div>
        </div>
    );
};
