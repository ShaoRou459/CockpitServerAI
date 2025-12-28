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
    UserIcon,
    TerminalIcon,
    CheckCircleIcon,
    TimesCircleIcon,
    ExclamationTriangleIcon,
    ShieldAltIcon,
    FileIcon,
    FileCodeIcon,
    AngleRightIcon,
    AngleDownIcon,
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
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages,
    isProcessing,
    isConfigured,
    onSendMessage,
    onOpenSettings,
    pendingAction,
    onApprove,
    onDeny
}) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when messages change or pending action appears
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, pendingAction]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (input.trim() && !isProcessing && isConfigured) {
            onSendMessage(input.trim());
            setInput('');
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
                <form onSubmit={handleSubmit}>
                    <Flex>
                        <FlexItem grow={{ default: 'grow' }}>
                            <TextArea
                                value={input}
                                onChange={(_e, value) => setInput(value)}
                                onKeyDown={handleKeyDown}
                                placeholder={_("Ask me to help manage this server...")}
                                aria-label="Message input"
                                rows={2}
                                resizeOrientation="vertical"
                                isDisabled={isProcessing || !!pendingAction}
                            />
                        </FlexItem>
                        <FlexItem alignSelf={{ default: 'alignSelfFlexEnd' }}>
                            <Button
                                type="submit"
                                variant="primary"
                                isDisabled={!input.trim() || isProcessing || !!pendingAction}
                                aria-label="Send message"
                            >
                                <PaperPlaneIcon />
                            </Button>
                        </FlexItem>
                    </Flex>
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

// Inline approval component
const InlineApproval: React.FC<{
    action: PendingAction;
    onApprove: () => void;
    onDeny: () => void;
}> = ({ action, onApprove, onDeny }) => {
    const riskColors: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
        low: { color: 'green', icon: <CheckCircleIcon />, label: 'Low Risk' },
        medium: { color: 'orange', icon: <ExclamationTriangleIcon />, label: 'Medium Risk' },
        high: { color: 'red', icon: <ExclamationTriangleIcon />, label: 'High Risk' },
        critical: { color: 'purple', icon: <ShieldAltIcon />, label: 'Critical' }
    };

    const risk = riskColors[action.risk_level] || riskColors.medium;

    const getActionTypeLabel = () => {
        switch (action.type) {
            case 'command':
                return 'Command';
            case 'file_read':
                return 'Read File';
            case 'file_write':
                return 'Write File';
            case 'service':
                return 'Service';
            default:
                return 'Action';
        }
    };

    return (
        <div className={`approval-card risk-${action.risk_level}`}>
            {/* Header */}
            <div className="approval-header">
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <ShieldAltIcon className="approval-icon" />
                            </FlexItem>
                            <FlexItem>
                                <strong>{_("Action Approval Required")}</strong>
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                    <FlexItem>
                        <Label color={risk.color as any} icon={risk.icon}>
                            {risk.label}
                        </Label>
                    </FlexItem>
                </Flex>
            </div>

            {/* Description */}
            <div className="approval-description">
                {action.description}
            </div>

            {/* Action Type Badge */}
            <div className="approval-action-type">
                <span className="action-type-badge">{getActionTypeLabel()}</span>
            </div>

            {/* Command display for 'command' type */}
            {action.type === 'command' && (
                <div className="approval-command">
                    <div className="approval-command-label">Command:</div>
                    <code>{action.command}</code>
                </div>
            )}

            {/* File path and content for file operations */}
            {(action.type === 'file_read' || action.type === 'file_write') && (
                <div className="approval-file-details">
                    <div className="approval-file-path">
                        <FileIcon className="file-path-icon" />
                        <span className="file-path-label">Path:</span>
                        <code className="file-path-value">{action.path}</code>
                    </div>
                    {action.type === 'file_write' && action.content && (
                        <FileContentCollapsible
                            label="Content to Write"
                            content={action.content}
                        />
                    )}
                </div>
            )}

            {/* Service display */}
            {action.type === 'service' && (
                <div className="approval-command">
                    <div className="approval-command-label">Service Operation:</div>
                    <code>{action.operation} {action.service}</code>
                </div>
            )}

            {/* Action Buttons */}
            <div className="approval-actions">
                <Button
                    variant="primary"
                    onClick={onApprove}
                    className="approval-btn approve"
                >
                    <CheckCircleIcon /> {_("Approve & Execute")}
                </Button>
                <Button
                    variant="secondary"
                    onClick={onDeny}
                    className="approval-btn deny"
                >
                    <TimesCircleIcon /> {_("Deny")}
                </Button>
            </div>

            {action.risk_level === 'critical' && (
                <div className="approval-warning">
                    ⚠️ {_("This is a critical operation. Please review carefully before approving.")}
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
const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const isUser = message.role === 'user';
    const isAction = message.role === 'action';
    const isError = message.isError;

    // Special rendering for action messages
    if (isAction && message.action) {
        const success = message.result?.success;
        const action = message.action;
        const isFileOperation = action.type === 'file_read' || action.type === 'file_write';

        return (
            <div className={`message-bubble action ${success ? 'success' : 'failure'}`}>
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsFlexStart' }}>
                    <FlexItem>
                        <div className={`message-icon action-icon ${success ? 'success' : 'failure'}`}>
                            {getActionIcon(action.type)}
                        </div>
                    </FlexItem>
                    <FlexItem grow={{ default: 'grow' }}>
                        <div className="action-header">
                            <span className="action-type">{action.type.toUpperCase()}</span>
                            <span className={`action-status ${success ? 'success' : 'failure'}`}>
                                {success ? <CheckCircleIcon /> : <TimesCircleIcon />}
                                {success ? 'Success' : 'Failed'}
                            </span>
                        </div>
                        <div className="action-description">
                            {action.description}
                        </div>

                        {/* Command display for command type */}
                        {action.type === 'command' && action.command && (
                            <div className="action-command">
                                <code>$ {action.command}</code>
                            </div>
                        )}

                        {/* File operation details */}
                        {isFileOperation && (
                            <div className="action-file-details">
                                <div className="action-file-path">
                                    <FileIcon className="file-path-icon" />
                                    <span className="file-path-label">Path:</span>
                                    <code className="file-path-value">{action.path}</code>
                                </div>

                                {/* For file_write: show content that was written */}
                                {action.type === 'file_write' && action.content && (
                                    <FileContentCollapsible
                                        label="Content Written"
                                        content={action.content}
                                    />
                                )}

                                {/* For file_read: show content that was read (from result) */}
                                {action.type === 'file_read' && message.result?.stdout && (
                                    <FileContentCollapsible
                                        label="Content Read"
                                        content={message.result.stdout}
                                    />
                                )}
                            </div>
                        )}

                        {/* Service operation display */}
                        {action.type === 'service' && (
                            <div className="action-command">
                                <code>systemctl {action.operation} {action.service}</code>
                            </div>
                        )}

                        <div className="message-time">
                            {message.timestamp.toLocaleTimeString()}
                        </div>
                    </FlexItem>
                </Flex>
            </div>
        );
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
            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsFlexStart' }}>
                <FlexItem>
                    <div className="message-icon">
                        {isUser ? <UserIcon /> : <RobotIcon />}
                    </div>
                </FlexItem>
                <FlexItem grow={{ default: 'grow' }}>
                    <div className="message-content">
                        {renderContent()}
                    </div>
                    <div className="message-time">
                        {message.timestamp.toLocaleTimeString()}
                    </div>
                </FlexItem>
            </Flex>
        </div>
    );
};
