/*
 * Secret Control - Detect, redact, and manage secrets
 * 
 * This module provides:
 * 1. Detection of sensitive data in command output
 * 2. Redaction with placeholders the AI can reference
 * 3. Secure storage and substitution when executing commands
 */

// Secret patterns to detect
interface SecretPattern {
    name: string;
    pattern: RegExp;
    description: string;
}

// Stored secret
interface StoredSecret {
    id: string;
    value: string;
    type: string;
    detectedAt: Date;
    context: string | undefined;  // Where it was found (file path, command, etc.)
}

// Common patterns for secrets
const SECRET_PATTERNS: SecretPattern[] = [
    // API Keys & Tokens
    {
        name: 'api_key',
        pattern: /(?:api[_-]?key|apikey|api[_-]?token)['\":\s=]*['"]?([a-zA-Z0-9_\-]{20,})['";,\s]?/gi,
        description: 'API Key'
    },
    {
        name: 'sk_api_key',
        pattern: /\bsk-[a-zA-Z0-9]{20,}/g,
        description: 'SK API Key (OpenAI/Anthropic)'
    },
    {
        name: 'bearer_token',
        pattern: /[Bb]earer\s+([a-zA-Z0-9_\-\.]{8,})/g,
        description: 'Bearer Token'
    },
    {
        name: 'jwt_token',
        pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
        description: 'JWT Token'
    },

    // AWS Credentials
    {
        name: 'aws_access_key',
        pattern: /(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}/g,
        description: 'AWS Access Key ID'
    },
    {
        name: 'aws_secret_key',
        pattern: /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key)['":\s=]*['"]?([a-zA-Z0-9\/+=]{40})['";\s]?/gi,
        description: 'AWS Secret Key'
    },

    // Private Keys
    {
        name: 'private_key',
        pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
        description: 'Private Key'
    },

    // Database URLs with passwords
    {
        name: 'db_connection',
        pattern: /(?:mysql|postgres|postgresql|mongodb|redis|amqp):\/\/[^:]+:([^@]+)@[^\s'"]+/gi,
        description: 'Database Password'
    },

    // Generic Password patterns
    {
        name: 'password_field',
        pattern: /(?:password|passwd|pwd|secret)['":\s=]*['"]?([^\s'"]{8,})['";\s]?/gi,
        description: 'Password'
    },

    // GitHub/GitLab tokens
    {
        name: 'github_token',
        pattern: /ghp_[a-zA-Z0-9]{36}/g,
        description: 'GitHub Personal Access Token'
    },
    {
        name: 'github_oauth',
        pattern: /gho_[a-zA-Z0-9]{36}/g,
        description: 'GitHub OAuth Token'
    },
    {
        name: 'gitlab_token',
        pattern: /glpat-[a-zA-Z0-9\-]{20}/g,
        description: 'GitLab Personal Access Token'
    },

    // Slack tokens
    {
        name: 'slack_token',
        pattern: /xox[baprs]-[a-zA-Z0-9\-]{10,}/g,
        description: 'Slack Token'
    },

    // Generic high-entropy strings (likely secrets)
    {
        name: 'high_entropy_hex',
        pattern: /['":\s=]([a-f0-9]{32,})['";\s]/gi,
        description: 'Hex Secret'
    },
    {
        name: 'high_entropy_base64',
        pattern: /['":\s=]([A-Za-z0-9+/]{40,}={0,2})['";\s]/gi,
        description: 'Base64 Secret'
    },

    // SSH/sudo passwords in command context
    {
        name: 'ssh_pass',
        pattern: /sshpass\s+-p\s*['"]?([^\s'"]+)/gi,
        description: 'SSH Password'
    },
    {
        name: 'sudo_pass',
        pattern: /echo\s+['"]?([^\s'"]+)['"]?\s*\|\s*sudo/gi,
        description: 'Sudo Password'
    }
];

/**
 * SecretManager - Singleton class to manage secrets
 */
export class SecretManager {
    private secrets: Map<string, StoredSecret> = new Map();
    private counter: number = 0;
    private enabled: boolean = true;

    constructor() {
        // Initialize from any stored state if needed
    }

    /**
     * Enable or disable secret detection
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Check if secret management is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Scan text for secrets and return redacted version
     * Returns the redacted text and list of detected secrets
     */
    scanAndRedact(text: string, context?: string): { redactedText: string; detectedSecrets: string[] } {
        if (!this.enabled || !text) {
            return { redactedText: text, detectedSecrets: [] };
        }

        let redactedText = text;
        const detectedSecrets: string[] = [];

        for (const pattern of SECRET_PATTERNS) {
            // Use matchAll to get all matches with their groups
            const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
            let match;

            while ((match = regex.exec(text)) !== null) {
                // Get the secret value - either from capture group or full match
                const secretValue = match[1] || match[0];

                // Skip if too short or looks like a placeholder
                if (secretValue.length < 8 || secretValue.startsWith('$__SECRET_')) {
                    continue;
                }

                // Check if we already have this secret
                let existingId: string | null = null;
                for (const [id, stored] of this.secrets) {
                    if (stored.value === secretValue) {
                        existingId = id;
                        break;
                    }
                }

                const secretId = existingId || this.generateSecretId();

                if (!existingId) {
                    // Store the new secret
                    this.secrets.set(secretId, {
                        id: secretId,
                        value: secretValue,
                        type: pattern.name,
                        detectedAt: new Date(),
                        context
                    });
                }

                // Replace in text
                redactedText = redactedText.replace(secretValue, secretId);

                if (!detectedSecrets.includes(secretId)) {
                    detectedSecrets.push(secretId);
                }
            }
        }

        return { redactedText, detectedSecrets };
    }

    /**
     * Substitute secret placeholders in a command with actual values
     * Called before executing a command from the AI
     */
    substituteSecrets(command: string): string {
        if (!this.enabled || !command) {
            return command;
        }

        let substituted = command;

        for (const [id, secret] of this.secrets) {
            // Replace both $__SECRET_N__ and __SECRET_N__ formats
            substituted = substituted.replace(new RegExp(`\\$?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), secret.value);
        }

        return substituted;
    }

    /**
     * Generate a new unique secret ID
     */
    private generateSecretId(): string {
        this.counter++;
        return `__SECRET_${this.counter}__`;
    }

    /**
     * Get count of stored secrets
     */
    getSecretCount(): number {
        return this.secrets.size;
    }

    /**
     * Get list of secret IDs and their types (not values!)
     */
    listSecrets(): { id: string; type: string; detectedAt: Date }[] {
        return Array.from(this.secrets.values()).map(s => ({
            id: s.id,
            type: s.type,
            detectedAt: s.detectedAt
        }));
    }

    /**
     * Clear all stored secrets
     */
    clear(): void {
        this.secrets.clear();
        this.counter = 0;
    }

    /**
     * Add a user-defined secret
     * Useful for pre-registering secrets the user knows about
     */
    addSecret(value: string, type: string = 'user_defined'): string {
        // Check if already exists
        for (const [id, stored] of this.secrets) {
            if (stored.value === value) {
                return id;
            }
        }

        const id = this.generateSecretId();
        this.secrets.set(id, {
            id,
            value,
            type,
            detectedAt: new Date(),
            context: undefined
        });

        return id;
    }

    /**
     * Remove a specific secret
     */
    removeSecret(id: string): boolean {
        return this.secrets.delete(id);
    }
}

// Singleton instance
export const secretManager = new SecretManager();

/**
 * Utility function to redact sensitive data from text
 */
export function redactSecrets(text: string, context?: string): string {
    const { redactedText } = secretManager.scanAndRedact(text, context);
    return redactedText;
}

/**
 * Utility function to substitute secrets before command execution
 */
export function substituteSecrets(command: string): string {
    return secretManager.substituteSecrets(command);
}
