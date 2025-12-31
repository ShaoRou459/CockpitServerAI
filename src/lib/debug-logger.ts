/*
 * Debug Logger - Centralized logging system for the AI Agent
 * 
 * Collects all debug information including:
 * - API requests/responses
 * - Parsed AI responses
 * - Actions taken
 * - Errors and warnings
 * - State changes
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
    | 'api-request'
    | 'api-response'
    | 'ai-parse'
    | 'action'
    | 'command'
    | 'settings'
    | 'state'
    | 'secret'
    | 'error'
    | 'system';

export interface LogEntry {
    id: string;
    timestamp: Date;
    level: LogLevel;
    category: LogCategory;
    title: string;
    message: string;
    data?: any;
    duration?: number | undefined; // in ms, for timing operations
}

type LogListener = (entry: LogEntry) => void;

class DebugLogger {
    private entries: LogEntry[] = [];
    private listeners: Set<LogListener> = new Set();
    private enabled: boolean = false;
    private maxEntries: number = 500;
    private entryCounter: number = 0;

    /**
     * Enable or disable debug logging
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) {
            this.log('info', 'system', 'Debug Mode', 'Debug logging enabled');
        }
    }

    /**
     * Check if debug mode is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Add a log entry
     */
    log(
        level: LogLevel,
        category: LogCategory,
        title: string,
        message: string,
        data?: any,
        duration?: number
    ): void {
        // Always log errors to console regardless of debug mode
        if (level === 'error') {
            console.error(`[${category}] ${title}:`, message, data);
        }

        if (!this.enabled && level !== 'error') {
            return;
        }

        const entry: LogEntry = {
            id: `log-${++this.entryCounter}-${Date.now()}`,
            timestamp: new Date(),
            level,
            category,
            title,
            message,
            data,
            duration
        };

        this.entries.push(entry);

        // Trim old entries
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }

        // Notify listeners
        this.listeners.forEach(listener => {
            try {
                listener(entry);
            } catch (e) {
                console.error('Debug listener error:', e);
            }
        });

        // Also log to console in debug mode
        if (this.enabled) {
            const consoleMethod = level === 'error' ? console.error :
                level === 'warn' ? console.warn :
                    level === 'debug' ? console.debug : console.log;
            consoleMethod(`[${category}] ${title}:`, message, data !== undefined ? data : '');
        }
    }

    /**
     * Log an API request
     */
    logRequest(provider: string, url: string, body: any): void {
        this.log('info', 'api-request', `API Request → ${provider}`, url, {
            url,
            body: this.sanitizeForLog(body)
        });
    }

    /**
     * Log an API response
     */
    logResponse(provider: string, status: number, body: string, duration: number): void {
        const level: LogLevel = status >= 400 ? 'error' : 'info';
        this.log(level, 'api-response', `API Response ← ${provider}`, `Status: ${status}`, {
            status,
            body: this.truncateString(body, 50000),
            duration: `${duration}ms`
        }, duration);
    }

    /**
     * Log AI response parsing
     */
    logParsing(rawContent: string, parsed: any, success: boolean): void {
        this.log(
            success ? 'info' : 'warn',
            'ai-parse',
            success ? 'AI Response Parsed' : 'AI Parse Failed (Fallback)',
            success ? 'Successfully parsed JSON response' : 'Failed to parse as JSON, using raw text',
            {
                raw: this.truncateString(rawContent, 50000),
                parsed
            }
        );
    }

    /**
     * Log action execution
     */
    logAction(action: any, phase: 'requested' | 'approved' | 'denied' | 'executed' | 'blocked', result?: any): void {
        const levelMap: Record<string, LogLevel> = {
            requested: 'info',
            approved: 'info',
            denied: 'warn',
            executed: 'info',
            blocked: 'warn'
        };

        this.log(
            levelMap[phase] || 'info',
            'action',
            `Action ${phase.charAt(0).toUpperCase() + phase.slice(1)}`,
            action.description || action.command || action.type,
            { action, result }
        );
    }

    /**
     * Log command execution
     */
    logCommand(command: string, phase: 'start' | 'complete', result?: { output?: string; exitCode?: number; cwd?: string }, duration?: number): void {
        if (phase === 'start') {
            this.log('debug', 'command', 'Command Started', command);
        } else {
            const success = result?.exitCode === 0;
            this.log(
                success ? 'info' : 'warn',
                'command',
                `Command ${success ? 'Succeeded' : 'Failed'}`,
                `Exit: ${result?.exitCode}`,
                {
                    command,
                    output: this.truncateString(result?.output || '', 500),
                    exitCode: result?.exitCode,
                    cwd: result?.cwd
                },
                duration
            );
        }
    }

    /**
     * Log secret detection
     */
    logSecretDetection(secretId: string, type: string, source: string): void {
        this.log('info', 'secret', 'Secret Detected', `${type} detected in ${source}`, {
            secretId,
            type,
            source
        });
    }

    /**
     * Log settings changes
     */
    logSettingsChange(setting: string, oldValue: any, newValue: any): void {
        this.log('info', 'settings', 'Settings Changed', setting, {
            setting,
            oldValue,
            newValue
        });
    }

    /**
     * Log state changes
     */
    logStateChange(component: string, state: string, data?: any): void {
        this.log('debug', 'state', `${component} State`, state, data);
    }

    /**
     * Log errors
     */
    logError(context: string, error: Error | string, data?: any): void {
        const message = error instanceof Error ? error.message : error;
        const stack = error instanceof Error ? error.stack : undefined;
        this.log('error', 'error', context, message, { ...data, stack });
    }

    /**
     * Get all log entries
     */
    getEntries(): LogEntry[] {
        return [...this.entries];
    }

    /**
     * Get entries filtered by category
     */
    getEntriesByCategory(category: LogCategory): LogEntry[] {
        return this.entries.filter(e => e.category === category);
    }

    /**
     * Get entries filtered by level
     */
    getEntriesByLevel(level: LogLevel): LogEntry[] {
        return this.entries.filter(e => e.level === level);
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.entries = [];
        this.log('info', 'system', 'Debug Log', 'Log cleared');
    }

    /**
     * Subscribe to new log entries
     */
    subscribe(listener: LogListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Export logs as JSON
     */
    exportLogs(): string {
        return JSON.stringify(this.entries, null, 2);
    }

    /**
     * Truncate long strings for display
     */
    private truncateString(str: string, maxLength: number): string {
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength) + `\n...(truncated ${str.length - maxLength} chars)`;
    }

    /**
     * Sanitize sensitive data from logs
     */
    private sanitizeForLog(data: any): any {
        if (!data) return data;

        const clone = JSON.parse(JSON.stringify(data));

        // Remove or mask sensitive fields
        const sensitiveFields = ['apiKey', 'api_key', 'password', 'secret', 'token', 'authorization'];

        const sanitize = (obj: any): any => {
            if (typeof obj !== 'object' || obj === null) return obj;

            for (const key of Object.keys(obj)) {
                if (sensitiveFields.some(f => key.toLowerCase().includes(f))) {
                    obj[key] = '[REDACTED]';
                } else if (typeof obj[key] === 'object') {
                    sanitize(obj[key]);
                }
            }
            return obj;
        };

        return sanitize(clone);
    }
}

// Export singleton instance
export const debugLogger = new DebugLogger();
