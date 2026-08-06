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

export interface SendMessageOptions {
    signal?: AbortSignal;
    onResponseStream?: (text: string) => void; // Streams the parsed "response" field (not raw JSON)
}

// Removed legacy JSON stream extractors

// Helper function to make HTTP requests via curl
async function httpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    signal?: AbortSignal,
    opts?: { onData?: (chunk: string) => void; noBuffer?: boolean }
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
            ...(opts?.noBuffer ? ['-N'] : []), // Disable buffering (for streaming)
            '-X', method,
            '-w', '\\n%{http_code}',  // Append status code
            ...headerArgs,
            '-d', '@-',     // Read body from STDIN to avoid OS command-line argument length limits (MAX_ARG_STRLEN)
            url
        ];

        const proc = cockpit.spawn(args, {
            superuser: 'try',
            err: 'message'
        });

        // Pass the request body via stdin
        if (body) {
            proc.input(body);
        }

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
            opts?.onData?.(data);
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

    async sendMessage(messages: ChatMessage[], systemPrompt: string, options?: SendMessageOptions): Promise<AIResponse> {
        // Create internal abort controller that can be triggered by both external signal and abort() method
        this.currentAbortController = new AbortController();
        const internalSignal = this.currentAbortController.signal;

        // If external signal is provided, link it to our internal controller
        if (options?.signal) {
            options.signal.addEventListener('abort', () => this.abort(), { once: true });
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
                        result = await this.sendGeminiRequest(messages, systemPrompt, actualBaseUrl, apiKey, model, options?.onResponseStream, internalSignal);
                    } else {
                        result = await this.sendOpenAIRequest(messages, systemPrompt, actualBaseUrl, apiKey, model, providerConfig, options?.onResponseStream, internalSignal);
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
        onResponseStream?: ((text: string) => void) | undefined,
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

        const stream = Boolean(this.settings.streamResponses && onResponseStream);
        const body = JSON.stringify({
            model,
            messages: requestMessages,
            temperature: this.settings.temperature,
            max_tokens: this.settings.maxTokens,
            ...(stream ? { stream: true } : {}),
        });

        // Log the full request
        debugLogger.logRequest('OpenAI', url, {
            model,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
            messages: requestMessages,
        });

        let streamedContent = '';
        let sseLineBuffer = '';
        let isReasoning = false;
        let hadNativeReasoning = false;

        const response = await httpRequest(
            url,
            'POST',
            headers,
            body,
            signal,
            stream ? {
                noBuffer: true,
                onData: (chunk) => {
                    // OpenAI chat.completions streaming is SSE where each line starts with "data: "
                    sseLineBuffer += chunk;
                    let nlIdx = sseLineBuffer.indexOf('\n');
                    while (nlIdx !== -1) {
                        const rawLine = sseLineBuffer.slice(0, nlIdx);
                        sseLineBuffer = sseLineBuffer.slice(nlIdx + 1);
                        const line = rawLine.trimEnd();
                        nlIdx = sseLineBuffer.indexOf('\n');

                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr || dataStr === '[DONE]') continue;

                        try {
                            const evt = JSON.parse(dataStr);
                            const deltaObj = evt.choices?.[0]?.delta;
                            if (!deltaObj) continue;

                            const reasoningContent = deltaObj.reasoning_content;
                            const deltaContent = deltaObj.content;

                            if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
                                if (!isReasoning) {
                                    isReasoning = true;
                                    streamedContent += '<think>\n';
                                }
                                streamedContent += reasoningContent;
                                onResponseStream?.(streamedContent);
                            }

                            if (typeof deltaContent === 'string' && deltaContent.length > 0) {
                                if (isReasoning) {
                                    isReasoning = false;
                                    streamedContent += '\n</think>\n\n';
                                    // The model already sent reasoning via the native reasoning_content
                                    // field. Flag this so we can strip any duplicate <think> tags the
                                    // model may echo in the regular content field.
                                    hadNativeReasoning = true;
                                }
                                streamedContent += deltaContent;
                                onResponseStream?.(streamedContent);
                            }
                        } catch {
                            // Ignore parse errors while streaming
                        }
                    }
                }
            } : undefined
        );
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

        // In streaming mode, the response body will be the raw SSE transcript; we reconstruct the
        // assistant message from deltas instead.
        let content: string | undefined;
        if (stream) {
            content = streamedContent;

            // If the model sent reasoning via the native reasoning_content field AND
            // also echoed <think> tags in the content field, strip the duplicates.
            // This prevents two "Thought Process" sections from appearing in the UI.
            if (content && hadNativeReasoning) {
                content = content.replace(
                    /(<\/think>\s*\n*)\s*<think>[\s\S]*?<\/think>/gi,
                    '$1'
                );
                // Also handle unclosed trailing <think> (streaming edge case)
                content = content.replace(
                    /(<\/think>\s*\n*)\s*<think>[\s\S]*$/gi,
                    '$1'
                );
            }
            if (!content) {
                // Fallback for OpenAI-compatible endpoints that ignore `stream: true`
                try {
                    const data = JSON.parse(response.body);
                    const msg = data.choices?.[0]?.message;
                    if (msg) {
                        content = msg.content || '';
                        if (msg.reasoning_content) {
                            const cleanedContent = (msg.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                            content = `<think>\n${msg.reasoning_content}\n</think>\n\n${cleanedContent}`;
                        }
                    }
                } catch {
                    content = undefined;
                }
            }
        } else {
            const data = JSON.parse(response.body);
            const msg = data.choices?.[0]?.message;
            if (msg) {
                content = msg.content || '';
                if (msg.reasoning_content) {
                    const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                    content = `<think>\n${msg.reasoning_content}\n</think>\n\n${cleanedContent}`;
                }
            }
        }

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
        onResponseStream?: ((text: string) => void) | undefined,
        signal?: AbortSignal
    ): Promise<AIResponse> {
        const stream = Boolean(this.settings.streamResponses && onResponseStream);
        const endpointTemplate = stream
            ? PROVIDERS.gemini.endpoint.replace(':generateContent', ':streamGenerateContent')
            : PROVIDERS.gemini.endpoint;
        const endpoint = endpointTemplate.replace('{model}', model);
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

        let sseLineBuffer = '';
        let lastText = '';

        const response = await httpRequest(
            url,
            'POST',
            headers,
            body,
            signal,
            stream ? {
                noBuffer: true,
                onData: (chunk) => {
                    // Gemini streaming is SSE where each line starts with "data: "
                    sseLineBuffer += chunk;
                    let nlIdx = sseLineBuffer.indexOf('\n');
                    while (nlIdx !== -1) {
                        const rawLine = sseLineBuffer.slice(0, nlIdx);
                        sseLineBuffer = sseLineBuffer.slice(nlIdx + 1);
                        const line = rawLine.trimEnd();
                        nlIdx = sseLineBuffer.indexOf('\n');

                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr) continue;

                        try {
                            const evt = JSON.parse(dataStr);
                            const text = evt.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (typeof text !== 'string') continue;

                            const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
                            lastText = text;

                            if (delta) onResponseStream?.(lastText);
                        } catch {
                            // Ignore parse errors while streaming
                        }
                    }
                }
            } : undefined
        );
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

        let content: string | undefined;
        if (stream) {
            content = lastText;
            if (!content) {
                // Fallback for non-streaming responses (or proxies) even when we hit the streaming endpoint.
                try {
                    const data = JSON.parse(response.body);
                    content = data.candidates?.[0]?.content?.parts?.[0]?.text;
                } catch {
                    content = undefined;
                }
            }
        } else {
            const data = JSON.parse(response.body);
            content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (!content) {
            debugLogger.logError('Gemini Response', 'Empty content in response');
            throw new Error('Empty response from Gemini API');
        }

        return this.parseAIResponse(content);
    }

    private parseAIResponse(content: string): AIResponse {
        // Extract thought
        let thought = '';
        const thoughtMatch = content.match(/<(?:thought|think)>([\s\S]*?)<\/(?:thought|think)>/i);
        if (thoughtMatch) {
            thought = thoughtMatch[1].trim();
        }

        // Helper to validate if an array contains valid action objects
        const isValidActionArray = (parsed: any): boolean => {
            if (!Array.isArray(parsed)) return false;
            if (parsed.length === 0) return true;
            return parsed.every(item =>
                item && typeof item === 'object' && typeof item.type === 'string' &&
                ['command', 'file_read', 'file_write', 'service', 'ask_user', 'done'].includes(item.type)
            );
        };

        // Helper to check if a block content is likely to be an actions block
        const isLikelyActionsBlock = (blockContent: string, isJsonLanguage: boolean, isLastBlock: boolean): boolean => {
            const trimmed = blockContent.trim();
            if (!trimmed.startsWith('[')) return false;
            const hasKeywords = trimmed.includes('"type"') && (
                trimmed.includes('"command"') ||
                trimmed.includes('"path"') ||
                trimmed.includes('"service"') ||
                trimmed.includes('"question"') ||
                trimmed.includes('"done"')
            );
            return hasKeywords && (isJsonLanguage || isLastBlock);
        };

        // Find all markdown code blocks with their start/end indices
        const codeBlockRegex = /```(json|[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/gi;
        const blocks: {
            fullText: string;
            language: string;
            content: string;
            index: number;
            endIndex: number;
        }[] = [];
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            blocks.push({
                fullText: match[0],
                language: match[1] || '',
                content: match[2],
                index: match.index,
                endIndex: match.index + match[0].length
            });
        }

        // Extract actions and identify the actions block to strip
        let actions: any[] = [];
        let actionsBlockIndex = -1;

        for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i];

            // 1. Try to parse as valid actions
            try {
                const parsed = JSON.parse(block.content.trim());
                if (isValidActionArray(parsed)) {
                    actions = parsed;
                    actionsBlockIndex = i;
                    break;
                }
            } catch {
                // Ignore parse errors here, we will fallback to isLikelyActionsBlock
            }

            // 2. If it didn't parse successfully, check if it's a likely actions block that is malformed
            const isLast = i === blocks.length - 1;
            const isJson = block.language.toLowerCase() === 'json';
            if (isLikelyActionsBlock(block.content, isJson, isLast)) {
                actionsBlockIndex = i;
                actions = [];
                // Log the JSON parse warning
                try {
                    JSON.parse(block.content.trim());
                } catch (e) {
                    debugLogger.log('warn', 'ai-parse', 'Failed to parse JSON actions block', e instanceof Error ? e.message : String(e));
                }
                break;
            }
        }

        // Clean response by stripping the identified actions block only
        let responseText = content;
        let actionsBlockStart = -1;
        let actionsBlockEnd = -1;

        if (actionsBlockIndex !== -1) {
            const block = blocks[actionsBlockIndex];
            actionsBlockStart = block.index;
            actionsBlockEnd = block.endIndex;
        }

        // Greedy fallback: if regex-based search didn't find a valid actions block,
        // try a greedy approach. This handles cases where the JSON content itself
        // contains ``` (e.g. markdown in a file_write content field).
        if (actions.length === 0 && actionsBlockIndex === -1) {
            // Find the last ```json opener in the content
            const jsonOpenerRegex = /```json\s*\n/gi;
            let lastOpener: { index: number; end: number } | null = null;
            let openerMatch;
            while ((openerMatch = jsonOpenerRegex.exec(content)) !== null) {
                lastOpener = { index: openerMatch.index, end: openerMatch.index + openerMatch[0].length };
            }

            if (lastOpener) {
                // Find all ``` positions after the opener's content start
                const closingPositions: number[] = [];
                let searchIdx = lastOpener.end;
                while (searchIdx < content.length) {
                    const pos = content.indexOf('```', searchIdx);
                    if (pos === -1) break;
                    closingPositions.push(pos);
                    searchIdx = pos + 3;
                }

                // Try from the furthest closing ``` backwards (greedy to non-greedy)
                for (let k = closingPositions.length - 1; k >= 0; k--) {
                    const blockContent = content.slice(lastOpener.end, closingPositions[k]);
                    try {
                        const parsed = JSON.parse(blockContent.trim());
                        if (isValidActionArray(parsed)) {
                            actions = parsed;
                            actionsBlockStart = lastOpener.index;
                            actionsBlockEnd = closingPositions[k] + 3;
                            debugLogger.log('info', 'ai-parse', 'Greedy fallback',
                                'Found valid JSON actions block using greedy matching (content contained nested backticks)');
                            break;
                        }
                    } catch {
                        continue;
                    }
                }
            }
        }

        if (actionsBlockStart !== -1 && actionsBlockEnd !== -1) {
            responseText = (content.substring(0, actionsBlockStart) + content.substring(actionsBlockEnd)).trim();
        }

        // Extract __FILE_CONTENT__ blocks and attach to file_write actions.
        // This supports a format where file content is kept outside the JSON block
        // to avoid backtick collisions and JSON escaping issues with large files.
        const fileContentRegex = /__FILE_CONTENT__\s*\n([\s\S]*?)\n\s*__END_FILE_CONTENT__/g;
        const fileContentBlocks: string[] = [];
        let fcMatch;
        while ((fcMatch = fileContentRegex.exec(responseText)) !== null) {
            fileContentBlocks.push(fcMatch[1]);
        }

        if (fileContentBlocks.length > 0) {
            // Attach content to file_write actions that don't already have content
            let blockIdx = 0;
            for (const action of actions) {
                if (action.type === 'file_write' && !action.content && blockIdx < fileContentBlocks.length) {
                    action.content = fileContentBlocks[blockIdx];
                    blockIdx++;
                }
            }

            // Strip __FILE_CONTENT__ blocks from the response text
            responseText = responseText.replace(/__FILE_CONTENT__\s*\n[\s\S]*?\n\s*__END_FILE_CONTENT__/g, '').trim();

            if (blockIdx > 0) {
                debugLogger.log('info', 'ai-parse', 'File content blocks',
                    `Attached ${blockIdx} external file content block(s) to file_write actions`);
            }
        }

        const result: AIResponse = {
            thought,
            actions,
            response: responseText || content
        };

        debugLogger.logParsing(content, result, true);

        return result;
    }
}
