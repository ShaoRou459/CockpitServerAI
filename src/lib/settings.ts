/*
 * Settings management for Cockpit AI Agent
 */

// Safety mode determines which risk levels can be auto-executed
export type SafetyMode = 'paranoid' | 'cautious' | 'moderate' | 'yolo' | 'full_yolo';

// Risk level type
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// Safety mode configuration
export interface SafetyModeConfig {
    name: string;
    description: string;
    icon: string;
    autoApprove: RiskLevel[];
    variant: 'success' | 'info' | 'warning' | 'danger';
}

export const SAFETY_MODES: Record<SafetyMode, SafetyModeConfig> = {
    paranoid: {
        name: 'Paranoid',
        description: 'All commands require approval',
        icon: 'lock',
        autoApprove: [],
        variant: 'success'
    },
    cautious: {
        name: 'Cautious',
        description: 'Auto-run read-only commands',
        icon: 'shield',
        autoApprove: ['low'],
        variant: 'info'
    },
    moderate: {
        name: 'Moderate',
        description: 'Auto-run low & medium risk',
        icon: 'bolt',
        autoApprove: ['low', 'medium'],
        variant: 'warning'
    },
    yolo: {
        name: 'YOLO',
        description: 'Auto-run most, confirm critical',
        icon: 'rocket',
        autoApprove: ['low', 'medium', 'high'],
        variant: 'warning'
    },
    full_yolo: {
        name: 'Full YOLO',
        description: 'Auto-run everything (dangerous!)',
        icon: 'skull',
        autoApprove: ['low', 'medium', 'high', 'critical'],
        variant: 'danger'
    }
};

export interface Settings {
    // Provider settings
    provider: 'openai' | 'gemini';
    apiKey: string;
    model: string;
    baseUrl: string;  // Optional: if empty, uses provider default

    // Behavior settings
    safetyMode: SafetyMode;
    maxTokens: number;
    temperature: number;
    outputTruncateLength: number;  // Max chars of command output to send to AI
    maxExecutionSteps: number;    // Max AI action-loop iterations before stopping
    streamResponses: boolean;  // Stream AI responses into the UI as they arrive
    restoreLastSessionOnStartup: boolean;

    // Safety settings
    commandBlocklist: string[];
    secretRedaction: boolean;  // Enable/disable automatic secret detection and redaction

    // Audit
    logCommands: boolean;

    // Developer settings
    debugMode: boolean;

    // UI settings
    theme: 'light' | 'dark';

    // Onboarding
    onboardingComplete: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    baseUrl: '',

    safetyMode: 'cautious',
    maxTokens: 4096,
    temperature: 0.7,
    outputTruncateLength: 8000,
    maxExecutionSteps: 10,
    streamResponses: true,
    restoreLastSessionOnStartup: false,

    commandBlocklist: [
        'rm -rf /',
        'rm -rf /*',
        ':(){ :|:& };:',
        'mkfs',
        'dd if=/dev/zero',
        '> /dev/sda',
    ],
    secretRedaction: true,  // Enabled by default for security

    logCommands: true,
    debugMode: false,
    theme: 'light',
    onboardingComplete: false
};

// Provider presets
export const PROVIDERS = {
    openai: {
        name: 'OpenAI',
        description: 'OpenAI API or compatible endpoints (Ollama, Azure, etc.)',
        defaultBaseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        endpoint: '/chat/completions',
        requestFormat: 'openai' as const
    },
    gemini: {
        name: 'Google Gemini',
        description: 'Google AI Studio Gemini models',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com',
        models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
        authHeader: null as string | null,
        authPrefix: '',
        endpoint: '/v1beta/models/{model}:generateContent',
        requestFormat: 'gemini' as const
    }
};

import cockpit from 'cockpit';
import { encryptValue, ensureDecrypted, isEncrypted } from './crypto';

const SETTINGS_PATH = '.config/cockpit-ai-agent/settings.json';

// Internal type for stored settings (API key is encrypted)
interface StoredSettings extends Omit<Settings, 'apiKey'> {
    apiKey: string;  // Encrypted
    _encrypted?: boolean;  // Flag to indicate if apiKey is encrypted
}

// Load settings from server-side config file
export async function loadSettings(): Promise<Settings> {
    try {
        // First try to load from server-side config (persists across all clients)
        const homeDir = await getHomeDir();
        const configPath = `${homeDir}/${SETTINGS_PATH}`;

        const file = cockpit.file(configPath);
        const content = await file.read();
        file.close();

        if (content && typeof content === 'string') {
            const parsed = JSON.parse(content) as Partial<StoredSettings>;

            // Decrypt API key if it's encrypted
            let decryptedApiKey = parsed.apiKey || '';
            if (decryptedApiKey && (parsed._encrypted || isEncrypted(decryptedApiKey))) {
                try {
                    decryptedApiKey = await ensureDecrypted(decryptedApiKey);
                    console.log('API key decrypted successfully');
                } catch (e) {
                    console.error('Failed to decrypt API key:', e);
                    // Key might have been encrypted by different user, clear it
                    decryptedApiKey = '';
                }
            } else if (decryptedApiKey && !parsed._encrypted) {
                // Legacy plaintext key - will be encrypted on next save
                console.log('Found legacy plaintext API key, will encrypt on next save');
            }

            // If settings file exists but doesn't have onboardingComplete field,
            // assume it's a legacy config and onboarding was implicitly done
            const settings: Settings = {
                ...DEFAULT_SETTINGS,
                ...parsed,
                apiKey: decryptedApiKey,
                // Preserve onboardingComplete if set, otherwise assume complete for existing configs
                onboardingComplete: parsed.onboardingComplete ?? true
            };

            // If we loaded a legacy plaintext key, re-save to encrypt it
            if (parsed.apiKey && !parsed._encrypted && decryptedApiKey) {
                console.log('Migrating plaintext API key to encrypted storage');
                await saveSettings(settings);
            }

            return settings;
        }
    } catch (e) {
        // Config file doesn't exist yet, that's fine
        console.log('No server-side settings found, using defaults');
    }

    // Fall back to localStorage for migration (one-time)
    try {
        const stored = localStorage.getItem('cockpit-ai-agent-settings');
        if (stored) {
            const parsed = JSON.parse(stored) as Partial<Settings>;
            // Migrated settings mean user already configured, so onboarding done
            const settings: Settings = {
                ...DEFAULT_SETTINGS,
                ...parsed,
                onboardingComplete: true
            };
            // Migrate to server-side storage (will encrypt the API key)
            await saveSettings(settings);
            // Clear localStorage after migration
            localStorage.removeItem('cockpit-ai-agent-settings');
            console.log('Migrated settings from localStorage to server (with encryption)');
            return settings;
        }
    } catch (e) {
        console.error('Failed to migrate localStorage settings:', e);
    }

    // No settings file exists - this is a truly new user, show onboarding
    return DEFAULT_SETTINGS;
}

// Save settings to server-side config file
export async function saveSettings(settings: Settings): Promise<void> {
    try {
        const homeDir = await getHomeDir();
        const configDir = `${homeDir}/.config/cockpit-ai-agent`;
        const configPath = `${configDir}/settings.json`;

        // Ensure the config directory exists
        await cockpit.spawn(['mkdir', '-p', configDir], { err: 'ignore' });

        // Encrypt the API key before saving
        let encryptedApiKey = '';
        if (settings.apiKey) {
            try {
                encryptedApiKey = await encryptValue(settings.apiKey);
                console.log('API key encrypted for storage');
            } catch (e) {
                console.error('Failed to encrypt API key:', e);
                throw new Error('Failed to encrypt API key for storage');
            }
        }

        // Create stored settings with encrypted API key
        const storedSettings: StoredSettings = {
            ...settings,
            apiKey: encryptedApiKey,
            _encrypted: true
        };

        // Write settings to file as JSON string
        const file = cockpit.file(configPath);
        await file.replace(JSON.stringify(storedSettings, null, 2));
        file.close();
    } catch (e) {
        console.error('Failed to save settings to server:', e);
        throw e;
    }
}

// Clear all settings
export async function clearSettings(): Promise<void> {
    try {
        const homeDir = await getHomeDir();
        const configPath = `${homeDir}/${SETTINGS_PATH}`;
        await cockpit.spawn(['rm', '-f', configPath], { err: 'ignore' });
    } catch (e) {
        console.error('Failed to clear settings:', e);
    }
    // Also clear localStorage just in case
    localStorage.removeItem('cockpit-ai-agent-settings');
}

// Get the current user's home directory
async function getHomeDir(): Promise<string> {
    try {
        const user = await cockpit.user();
        return user.home;
    } catch (e) {
        // Fallback: try spawning echo $HOME
        try {
            const result = await cockpit.spawn(['sh', '-c', 'echo $HOME'], { err: 'message' });
            return (result as string).trim();
        } catch {
            // Last resort fallback
            return '/root';
        }
    }
}
