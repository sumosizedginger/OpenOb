import { AICapabilities, AIChunk, AIModel, AIProvider, ChatRequest } from '../types.js';
import { redactSecrets } from '../secrets.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class AnthropicProvider implements AIProvider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic Claude';
  private readonly baseUrl: string;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  }

  async listModels(): Promise<AIModel[]> {
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet (Latest)',
        contextWindow: 200000,
        isDefault: true,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        contextWindow: 200000,
      },
    ];
  }

  async capabilities(_model: string): Promise<AICapabilities> {
    return {
      streaming: true,
      toolCalling: true,
      maxContextTokens: 200000,
    };
  }

  async *chat(request: ChatRequest): AsyncIterable<AIChunk> {
    const url = `${this.baseUrl}/messages`;

    // Separate system message from conversation messages
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    const conversationMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'user', content: 'Hello' });
    }

    const payload: any = {
      model: request.model,
      messages: conversationMessages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream: true,
    };

    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { content: '', isDone: true, finishReason: 'abort' };
        return;
      }
      throw new Error(redactSecrets(`Anthropic request failed: ${err.message}`, [this.options.apiKey]));
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`Anthropic error HTTP ${response.status}: ${errBody || response.statusText}`, [
          this.options.apiKey,
        ])
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
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                yield {
                  content: parsed.delta.text,
                  isDone: false,
                };
              } else if (parsed.type === 'message_stop') {
                yield {
                  content: '',
                  isDone: true,
                  finishReason: 'stop',
                };
                return;
              }
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', isDone: true };
  }
}
