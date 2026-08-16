import { AICapabilities, AIChunk, AIModel, AIProvider, ChatRequest } from '../types.js';
import { redactSecrets } from '../secrets.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIProvider implements AIProvider {
  public readonly id = 'openai';
  public readonly name = 'OpenAI';
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async listModels(): Promise<AIModel[]> {
    return [
      { id: 'gpt-4o', name: 'GPT-4o (Omni)', contextWindow: 128000, isDefault: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
      { id: 'o1-mini', name: 'o1 Mini (Reasoning)', contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
    ];
  }

  async capabilities(_model: string): Promise<AICapabilities> {
    return {
      streaming: true,
      toolCalling: true,
      maxContextTokens: 128000,
    };
  }

  async *chat(request: ChatRequest): AsyncIterable<AIChunk> {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: true,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { content: '', isDone: true, finishReason: 'abort' };
        return;
      }
      throw new Error(
        redactSecrets(`OpenAI request failed: ${err.message}`, [this.options.apiKey]),
        { cause: err }
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`OpenAI error HTTP ${response.status}: ${errBody || response.statusText}`, [
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
