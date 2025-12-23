/*
 * Settings management for Cockpit AI Agent
 */

export interface Settings {
    // Provider settings
    provider: 'openai' | 'gemini' | 'custom';
    apiKey: string;
    model: string;
    baseUrl: string;

    // Behavior settings
    yoloMode: boolean;
    autoApproveReadOnly: boolean;
    maxTokens: number;
    temperature: number;

    // Safety settings
    alwaysConfirmCritical: boolean;
    commandBlocklist: string[];

    // Audit
    logCommands: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    baseUrl: '',

    yoloMode: false,
    autoApproveReadOnly: true,
    maxTokens: 4096,
    temperature: 0.7,

    alwaysConfirmCritical: true,
    commandBlocklist: [
        'rm -rf /',
        'rm -rf /*',
        ':(){ :|:& };:',
        'mkfs',
        'dd if=/dev/zero',
        '> /dev/sda',
    ],

    logCommands: true
};

// Provider presets
export const PROVIDERS = {
    openai: {
        name: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        endpoint: '/chat/completions',
        requestFormat: 'openai' as const
    },
    gemini: {
        name: 'Google Gemini',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com',
        models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
        authHeader: null as string | null,
        authPrefix: '',
        endpoint: '/v1beta/models/{model}:generateContent',
        requestFormat: 'gemini' as const
    },
    custom: {
        name: 'Custom (OpenAI-Compatible)',
        defaultBaseUrl: '',
        models: [] as string[],
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        endpoint: '/chat/completions',
        requestFormat: 'openai' as const
    }
};

const STORAGE_KEY = 'cockpit-ai-agent-settings';

// Load settings from localStorage
export async function loadSettings(): Promise<Settings> {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return DEFAULT_SETTINGS;
}

// Save settings to localStorage
export async function saveSettings(settings: Settings): Promise<void> {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
        throw e;
    }
}

// Clear all settings
export async function clearSettings(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
}
