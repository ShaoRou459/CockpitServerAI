/*
 * AI Client - Multi-provider AI API client
 * 
 * Supports OpenAI, Google Gemini, and custom OpenAI-compatible endpoints
 * Uses cockpit.spawn() with a shell command to make HTTP requests via curl,
 * bypassing Cockpit's CSP restrictions.
 */

import cockpit from 'cockpit';
import { Settings, PROVIDERS } from './settings';
import type { AIResponse } from './types';
import { debugLogger } from './debug-logger';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// Helper function to make HTTP requests via curl
async function httpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string
): Promise<{ status: number; body: string; error?: string }> {

    return new Promise((resolve, reject) => {
        // Build curl command with headers
        const headerArgs: string[] = [];
        for (const [key, value] of Object.entries(headers)) {
            headerArgs.push('-H', `${key}: ${value}`);
        }

        const args = [
            'curl',
            '-s',           // Silent
            '-S',           // Show errors
            '-X', method,
            '-w', '\\n%{http_code}',  // Append status code
            ...headerArgs,
            '-d', body,
            url
        ];

        const proc = cockpit.spawn(args, {
            superuser: 'try',
            err: 'message'
        });

        let output = '';

        proc.stream((data: string) => {
            output += data;
        });

        proc.then(() => {
            // Parse output - last line is the status code
            const lines = output.trim().split('\n');
            const statusCode = parseInt(lines.pop() || '0', 10);
            const responseBody = lines.join('\n');

            resolve({
                status: statusCode,
                body: responseBody
            });
        }).catch((error: any) => {
            reject(new Error(error.message || 'HTTP request failed'));
        });
    });
}

export class AIClient {
    private settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    updateSettings(settings: Settings) {
        this.settings = settings;
    }

    async sendMessage(messages: ChatMessage[], systemPrompt: string): Promise<AIResponse> {
        const { provider, apiKey, model, baseUrl } = this.settings;

        if (!apiKey) {
            throw new Error('API key not configured');
        }

        const providerConfig = PROVIDERS[provider];
        const actualBaseUrl = baseUrl || providerConfig.defaultBaseUrl;

        if (providerConfig.requestFormat === 'gemini') {
            return this.sendGeminiRequest(messages, systemPrompt, actualBaseUrl, apiKey, model);
        } else {
            return this.sendOpenAIRequest(messages, systemPrompt, actualBaseUrl, apiKey, model, providerConfig);
        }
    }

    private async sendOpenAIRequest(
        messages: ChatMessage[],
        systemPrompt: string,
        baseUrl: string,
        apiKey: string,
        model: string,
        providerConfig: typeof PROVIDERS.openai
    ): Promise<AIResponse> {
        const url = `${baseUrl}${providerConfig.endpoint}`;
        const startTime = Date.now();

        const requestMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content }))
        ];

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (providerConfig.authHeader) {
            headers[providerConfig.authHeader] = `${providerConfig.authPrefix}${apiKey}`;
        }

        const body = JSON.stringify({
            model,
            messages: requestMessages,
            temperature: this.settings.temperature,
            max_tokens: this.settings.maxTokens,
        });

        // Log the request
        debugLogger.logRequest('OpenAI', url, {
            model,
            messageCount: requestMessages.length,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
        });

        const response = await httpRequest(url, 'POST', headers, body);
        const duration = Date.now() - startTime;

        // Log the response
        debugLogger.logResponse('OpenAI', response.status, response.body, duration);

        if (response.error) {
            debugLogger.logError('OpenAI Request', response.error);
            throw new Error(response.error);
        }

        if (response.status !== 200) {
            debugLogger.logError('OpenAI API', `Status ${response.status}`, { body: response.body });
            throw new Error(`API request failed: ${response.status} - ${response.body}`);
        }

        const data = JSON.parse(response.body);
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            debugLogger.logError('OpenAI Response', 'Empty content in response');
            throw new Error('Empty response from API');
        }

        return this.parseAIResponse(content);
    }

    private async sendGeminiRequest(
        messages: ChatMessage[],
        systemPrompt: string,
        baseUrl: string,
        apiKey: string,
        model: string
    ): Promise<AIResponse> {
        const endpoint = PROVIDERS.gemini.endpoint.replace('{model}', model);
        const url = `${baseUrl}${endpoint}?key=${apiKey}`;
        const startTime = Date.now();

        // Convert to Gemini format
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const body = JSON.stringify({
            contents,
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: this.settings.temperature,
                maxOutputTokens: this.settings.maxTokens,
            }
        });

        const headers = {
            'Content-Type': 'application/json',
        };

        // Log the request
        debugLogger.logRequest('Gemini', url.replace(/key=[^&]+/, 'key=***'), {
            model,
            messageCount: contents.length,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
        });

        const response = await httpRequest(url, 'POST', headers, body);
        const duration = Date.now() - startTime;

        // Log the response
        debugLogger.logResponse('Gemini', response.status, response.body, duration);

        if (response.error) {
            debugLogger.logError('Gemini Request', response.error);
            throw new Error(response.error);
        }

        if (response.status !== 200) {
            debugLogger.logError('Gemini API', `Status ${response.status}`, { body: response.body });
            throw new Error(`Gemini API request failed: ${response.status} - ${response.body}`);
        }

        const data = JSON.parse(response.body);
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) {
            debugLogger.logError('Gemini Response', 'Empty content in response');
            throw new Error('Empty response from Gemini API');
        }

        return this.parseAIResponse(content);
    }

    private parseAIResponse(content: string): AIResponse {
        // Try to extract JSON from the response
        // The AI might wrap JSON in markdown code blocks
        let jsonStr = content;

        // Check for markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
            debugLogger.log('debug', 'ai-parse', 'Extracted JSON', 'Found JSON in markdown code block');
        }

        try {
            const parsed = JSON.parse(jsonStr);

            // Validate the response structure
            if (!parsed.response) {
                debugLogger.log('warn', 'ai-parse', 'Parse Warning', 'Response missing "response" field', { parsed });
                throw new Error('Response missing required "response" field');
            }

            const result: AIResponse = {
                thought: parsed.thought || '',
                actions: Array.isArray(parsed.actions) ? parsed.actions : [],
                response: parsed.response
            };

            // Log successful parse with details
            debugLogger.logParsing(content, result, true);

            return result;
        } catch (parseError) {
            // If we can't parse JSON, treat the whole thing as a text response
            // This is a fallback for when the AI doesn't follow the format
            debugLogger.logParsing(content, null, false);
            debugLogger.log('warn', 'ai-parse', 'JSON Parse Failed',
                parseError instanceof Error ? parseError.message : 'Unknown error',
                { rawContent: content.substring(0, 500) }
            );

            return {
                thought: '',
                actions: [],
                response: content
            };
        }
    }
}
