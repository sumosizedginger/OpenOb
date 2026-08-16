import { AICapabilities, AIChunk, AIModel, AIProvider, ChatRequest } from '../types.js';
import { redactSecrets } from '../secrets.js';

export interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiProvider implements AIProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini';
  private readonly baseUrl: string;

  constructor(private readonly options: GeminiProviderOptions) {
    this.baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/+$/,
      ''
    );
  }

  async listModels(): Promise<AIModel[]> {
    return [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash (Next-Gen)',
        contextWindow: 1048576,
        isDefault: true,
      },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2097152 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1048576 },
    ];
  }

  async capabilities(_model: string): Promise<AICapabilities> {
    return {
      streaming: true,
      toolCalling: true,
      maxContextTokens: 1048576,
    };
  }

  async *chat(request: ChatRequest): AsyncIterable<AIChunk> {
    const model = request.model || 'gemini-2.0-flash';
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens,
      },
    };

    if (systemPrompt) {
      payload.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.options.apiKey,
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
        redactSecrets(`Gemini request failed: ${err.message}`, [this.options.apiKey]),
        { cause: err }
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`Gemini error HTTP ${response.status}: ${errBody || response.statusText}`, [
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
              const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              const finishReason = parsed.candidates?.[0]?.finishReason;

              if (textChunk) {
                yield {
                  content: textChunk,
                  isDone: false,
                };
              }

              if (finishReason && finishReason !== 'STOP') {
                yield {
                  content: '',
                  isDone: true,
                  finishReason,
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
