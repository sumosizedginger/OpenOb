import {
  AICapabilities,
  AIChunk,
  AIModel,
  AIProvider,
  ChatRequest,
  LocalAIConfig,
} from './types.js';

export function isLoopbackHostname(hostname: string): boolean {
  const cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '::1';
}

/**
 * Validates that an endpoint URL targets a strict local loopback address (SSRF boundary).
 * Rejects metadata endpoints (169.254.169.254), LAN addresses, public internet hosts, and non-http schemes.
 */
export function validateLocalEndpointUrl(urlStr: string): string {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('Local endpoint URL must be a non-empty string');
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(urlStr);
  } catch {
    // If URL parsing failed due to out-of-range port, parse scheme & host via regex
    const match = urlStr.match(/^([a-zA-Z0-9+-.]+):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (match) {
      const scheme = match[1].toLowerCase() + ':';
      const host = match[2];
      if (scheme !== 'http:' && scheme !== 'https:') {
        throw new Error(
          `Invalid protocol "${scheme}" for local endpoint. Only http: and https: are permitted.`
        );
      }
      if (!isLoopbackHostname(host)) {
        throw new Error(
          `SSRF Security Violation: Local AI endpoint "${urlStr}" targets non-loopback host "${host}". Only loopback addresses (localhost, 127.0.0.1, ::1) are permitted.`
        );
      }
      return urlStr.replace(/\/+$/, '');
    }
    throw new Error(`Invalid local endpoint URL: "${urlStr}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol "${parsed.protocol}" for local endpoint. Only http: and https: are permitted.`
    );
  }

  const hostname = parsed.hostname;
  if (!isLoopbackHostname(hostname)) {
    throw new Error(
      `SSRF Security Violation: Local AI endpoint "${urlStr}" targets non-loopback host "${hostname}". Only loopback addresses (localhost, 127.0.0.1, ::1) are permitted.`
    );
  }

  return urlStr.replace(/\/+$/, '');
}

export class OpenAICompatibleProvider implements AIProvider {
  public readonly id = 'openai-compatible';
  public readonly name = 'Local OpenAI-Compatible (Ollama / LM Studio)';

  constructor(
    private readonly config: LocalAIConfig,
    options: { validateLoopback?: boolean } = { validateLoopback: true }
  ) {
    if (options.validateLoopback !== false && config.endpointUrl) {
      validateLocalEndpointUrl(config.endpointUrl);
    }
  }

  private get normalizedBaseUrl(): string {
    return this.config.endpointUrl.replace(/\/+$/, '');
  }

  async listModels(): Promise<AIModel[]> {
    const url = `${this.normalizedBaseUrl}/models`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const detail = errText ? `: ${errText}` : ` ${res.statusText}`;
      throw new Error(`Failed to fetch models: HTTP ${res.status}${detail}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      contextWindow: m.context_length || 8192,
      isDefault: m.id === this.config.defaultModel,
    }));
  }

  async capabilities(_model: string): Promise<AICapabilities> {
    return {
      streaming: true,
      toolCalling: false,
      maxContextTokens: this.config.maxContextTokens || 8192,
    };
  }

  async *chat(request: ChatRequest): AsyncIterable<AIChunk> {
    const url = `${this.normalizedBaseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const payload = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: true,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { content: '', isDone: true, finishReason: 'abort' };
        return;
      }
      throw new Error(`AI Provider network failure at ${url}: ${err.message}`, { cause: err });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `AI Provider error HTTP ${response.status}: ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      yield { content: '', isDone: true };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') {
              yield { content: '', isDone: true, finishReason: 'stop' };
              return;
            }

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              const finishReason = parsed.choices?.[0]?.finish_reason;

              if (delta) {
                yield {
                  content: delta,
                  isDone: false,
                  model: parsed.model,
                };
              }

              if (finishReason) {
                yield {
                  content: '',
                  isDone: true,
                  finishReason,
                  model: parsed.model,
                };
                return;
              }
            } catch {
              // Ignore non-json or fragmented SSE lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', isDone: true };
  }
}
