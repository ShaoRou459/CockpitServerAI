/*
 * Type definitions for Cockpit AI Agent
 */

import type { RiskLevel } from './settings';

// Message in chat history
export interface Message {
    id?: string; // Stable identifier (used for streaming updates)
    role: 'user' | 'assistant' | 'system' | 'action' | 'interactive';
    content: string;
    timestamp: Date;
    isError?: boolean;
    action?: Action; // For action messages
    result?: CommandResult; // For action messages
}

// Action that AI wants to perform
export interface Action {
    type: 'command' | 'file_read' | 'file_write' | 'service' | 'ask_user';
    command?: string;
    path?: string;
    content?: string;
    service?: string;
    operation?: 'start' | 'stop' | 'restart' | 'status';
    question?: string; // Used for ask_user action
    description: string;
    risk_level: RiskLevel;
    interactive?: boolean;  // True if command may require user input (sudo, ssh, etc.)
    interactive_hint?: string;  // Message to show user about what input is needed
}

// Pending action awaiting user approval
export interface PendingAction extends Action {
    onApprove: () => void;
    onDeny: () => void;
}

// AI response structure
export interface AIResponse {
    thought?: string;
    actions: Action[];
    response: string;
}

// Command execution result
export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
}

// Provider configuration
export interface ProviderConfig {
    name: string;
    defaultBaseUrl: string;
    models: string[];
    authHeader: string | null;
    authPrefix: string;
    endpoint: string;
    requestFormat: 'openai' | 'gemini';
}

// System context for AI
export interface SystemContext {
    hostname: string;
    os?: string;
    user?: string;
    cwd?: string;
    uptime?: string;
    terminalContext?: string;
}

// Chat session for history
export interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: string;  // ISO string for JSON serialization
    updatedAt: string;  // ISO string for JSON serialization
}

// Session metadata for list view (without full messages)
export interface SessionMetadata {
    id: string;
    title: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
}
