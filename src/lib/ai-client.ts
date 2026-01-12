/*
 * AI Client - Multi-provider AI API client
 * 
 * Supports OpenAI, Google Gemini, and custom OpenAI-compatible endpoints
 * Uses cockpit.spawn() with a shell command to make HTTP requests via curl,
 * bypassing Cockpit's CSP restrictions.
 * 
 * Implements exponential backoff retry logic for transient failures.
 */

import cockpit from 'cockpit';
import { Settings, PROVIDERS } from './settings';
import type { AIResponse } from './types';
import { debugLogger } from './debug-logger';

// Retry configuration for exponential backoff
const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MULTIPLIER = 2;
const MAX_DELAY_MS = 32000; // 32 seconds cap

// Error class for API failures with retry information
export class ApiRetryError extends Error {
    public readonly provider: string;
    public readonly endpoint: string;
    public readonly statusCode: number | undefined;
    public readonly attemptsMade: number;
    public readonly maxRetries: number;
    public readonly lastAttemptTime: Date;

    constructor(
        message: string,
        provider: string,
        endpoint: string,
        attemptsMade: number,
        statusCode?: number
    ) {
        super(message);
        this.name = 'ApiRetryError';
        this.provider = provider;
        this.endpoint = endpoint;
        this.statusCode = statusCode ?? undefined;
        this.attemptsMade = attemptsMade;
        this.maxRetries = MAX_RETRIES;
        this.lastAttemptTime = new Date();
    }
}

// Helper function to delay execution
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate delay for exponential backoff
function calculateBackoffDelay(attempt: number): number {
    const delayMs = INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt);
    return Math.min(delayMs, MAX_DELAY_MS);
}

// Determine if an error should trigger a retry
function isRetryableError(statusCode: number | undefined, errorMessage: string): boolean {
    // Network/connection errors are retryable
    if (!statusCode || statusCode === 0) {
        return true;
    }
    // Rate limiting - retryable with backoff
    if (statusCode === 429) {
        return true;
    }
    // Server errors (5xx) are retryable
    if (statusCode >= 500 && statusCode < 600) {
        return true;
    }
    // Timeout errors are retryable
    if (errorMessage.toLowerCase().includes('timeout')) {
        return true;
    }
    // Connection errors are retryable
    if (errorMessage.toLowerCase().includes('connection') ||
        errorMessage.toLowerCase().includes('network')) {
        return true;
    }
    // Other errors (4xx like 401, 403, 400) are not retryable
    return false;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// Helper function to make HTTP requests via curl
async function httpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    signal?: AbortSignal
): Promise<{ status: number; body: string; error?: string }> {

    return new Promise((resolve, reject) => {
        // Check if already aborted
        if (signal?.aborted) {
            reject(new Error('Request aborted'));
            return;
        }
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
        let aborted = false;

        // Handle abort signal
        const abortHandler = () => {
            aborted = true;
            proc.close('terminated');
            reject(new Error('Request aborted'));
        };

        if (signal) {
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        proc.stream((data: string) => {
            output += data;
        });

        proc.then(() => {
            // Clean up abort listener
            if (signal) {
                signal.removeEventListener('abort', abortHandler);
            }

            if (aborted) return;

            // Parse output - last line is the status code
            const lines = output.trim().split('\n');
            const statusCode = parseInt(lines.pop() || '0', 10);
            const responseBody = lines.join('\n');

            resolve({
                status: statusCode,
                body: responseBody
            });
        }).catch((error: any) => {
            // Clean up abort listener
            if (signal) {
                signal.removeEventListener('abort', abortHandler);
            }

            if (aborted) return;

            reject(new Error(error.message || 'HTTP request failed'));
        });
    });
}

export class AIClient {
    private settings: Settings;
    private currentAbortController: AbortController | null = null;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    updateSettings(settings: Settings) {
        this.settings = settings;
    }

    /**
     * Abort the current request if one is in progress
     */
    abort(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
    }

    /**
     * Check if a request is currently in progress
     */
    isRequestInProgress(): boolean {
        return this.currentAbortController !== null;
    }

    async sendMessage(messages: ChatMessage[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
        // Create internal abort controller that can be triggered by both external signal and abort() method
        this.currentAbortController = new AbortController();
        const internalSignal = this.currentAbortController.signal;

        // If external signal is provided, link it to our internal controller
        if (signal) {
            signal.addEventListener('abort', () => this.abort(), { once: true });
        }
        const { provider, apiKey, model, baseUrl } = this.settings;

        if (!apiKey) {
            throw new Error('API key not configured');
        }

        const providerConfig = PROVIDERS[provider];
        const actualBaseUrl = baseUrl || providerConfig.defaultBaseUrl;
        const endpoint = providerConfig.requestFormat === 'gemini'
            ? `${actualBaseUrl}${PROVIDERS.gemini.endpoint.replace('{model}', model)}`
            : `${actualBaseUrl}${providerConfig.endpoint}`;

        let lastError: Error | null = null;
        let lastStatusCode: number | undefined;

        // Retry loop with exponential backoff
        try {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                // Check if aborted before each attempt
                if (internalSignal.aborted) {
                    throw new Error('Request aborted');
                }

                try {
                    if (attempt > 0) {
                        const backoffDelay = calculateBackoffDelay(attempt - 1);
                        debugLogger.log('info', 'api-request', 'Retry Attempt',
                            `Attempt ${attempt + 1}/${MAX_RETRIES + 1} after ${backoffDelay}ms delay`,
                            { provider, attempt, backoffDelay }
                        );
                        await delay(backoffDelay);
                    }

                    let result: AIResponse;
                    if (providerConfig.requestFormat === 'gemini') {
                        result = await this.sendGeminiRequest(messages, systemPrompt, actualBaseUrl, apiKey, model, internalSignal);
                    } else {
                        result = await this.sendOpenAIRequest(messages, systemPrompt, actualBaseUrl, apiKey, model, providerConfig, internalSignal);
                    }
                    return result;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    // If aborted, throw immediately without retry
                    if (lastError.message === 'Request aborted') {
                        throw lastError;
                    }

                    // Try to extract status code from error message
                    const statusMatch = lastError.message.match(/(\d{3})\s*-/);
                    lastStatusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

                    debugLogger.log('warn', 'api-request', 'Request Failed',
                        `Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError.message}`,
                        { provider, attempt, statusCode: lastStatusCode }
                    );

                    // Check if error is retryable
                    if (!isRetryableError(lastStatusCode, lastError.message)) {
                        debugLogger.log('error', 'api-request', 'Non-Retryable Error',
                            'Error is not retryable, aborting retry loop',
                            { statusCode: lastStatusCode }
                        );
                        break; // Don't retry for non-retryable errors like 401, 403
                    }

                    // If this was the last attempt, we'll fall through and throw
                    if (attempt === MAX_RETRIES) {
                        debugLogger.log('error', 'api-request', 'Retries Exhausted',
                            `All ${MAX_RETRIES + 1} attempts failed`,
                            { provider, lastError: lastError.message }
                        );
                    }
                }
            }

            // All retries exhausted - throw ApiRetryError for the error modal
            throw new ApiRetryError(
                lastError?.message || 'Request failed after retries',
                provider,
                endpoint,
                MAX_RETRIES + 1,
                lastStatusCode
            );
        } finally {
            // Clean up abort controller
            this.currentAbortController = null;
        }
    }

    private async sendOpenAIRequest(
        messages: ChatMessage[],
        systemPrompt: string,
        baseUrl: string,
        apiKey: string,
        model: string,
        providerConfig: typeof PROVIDERS.openai,
        signal?: AbortSignal
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

        // Log the full request
        debugLogger.logRequest('OpenAI', url, {
            model,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
            messages: requestMessages,
        });

        const response = await httpRequest(url, 'POST', headers, body, signal);
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
        model: string,
        signal?: AbortSignal
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

        // Log the full request
        debugLogger.logRequest('Gemini', url.replace(/key=[^&]+/, 'key=***'), {
            model,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
            systemInstruction: systemPrompt,
            contents: contents,
        });

        const response = await httpRequest(url, 'POST', headers, body, signal);
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
