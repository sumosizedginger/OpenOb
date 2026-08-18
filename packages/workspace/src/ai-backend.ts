import {
  AIChunk,
  AIKnowledgeSource,
  AIManager,
  AIModel,
  AIProviderId,
  AIProviderInfo,
  AIResponseMetadata,
  ChatMessage,
  Citation,
  extractCitations,
  formatContextPrompt,
  parseProposedEditFromResponse,
  ProposedEdit,
  RetrievalScope,
  retrieveContext,
} from '@okw/ai';
import { VaultPath } from '@okw/core';
import { WorkspaceBackend } from './backend.js';
import { ExpectedVersionDTO } from './types.js';

export interface AIChatRequest {
  readonly provider: AIProviderId;
  readonly model: string;
  readonly messages: ChatMessage[];
  readonly retrievalScope?: RetrievalScope;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  readonly activeNoteContext?: {
    readonly path: VaultPath;
    readonly content: string;
    readonly expectedVersion?: ExpectedVersionDTO;
  };
}

export interface AIChatChunkResponse {
  readonly chunk: AIChunk;
  readonly metadata?: AIResponseMetadata;
  readonly citations?: Citation[];
  readonly proposal?: ProposedEdit;
}

export interface AIBackend {
  readonly isGatewayMode: boolean;
  listProviders(): Promise<AIProviderInfo[]>;
  listModels(providerId: AIProviderId): Promise<AIModel[]>;
  getSecretStatus(providerId: AIProviderId): Promise<{ configured: boolean; masked?: string }>;
  setSecret(providerId: AIProviderId, secret: string): Promise<void>;
  clearSecret(providerId: AIProviderId): Promise<void>;
  chat(request: AIChatRequest): AsyncIterable<AIChatChunkResponse>;
}

/**
 * Adapts a WorkspaceBackend into an AIKnowledgeSource for standalone client-side retrieval.
 */
export function createBackendKnowledgeSource(backend: WorkspaceBackend): AIKnowledgeSource {
  return {
    async readNote(path: VaultPath) {
      const snap = await backend.readNote(path);
      return {
        text: snap.textContent,
        version: snap.version
          ? {
              token: snap.version.token,
              hash: snap.version.hash,
              modifiedAt: snap.version.modifiedAt,
              size: snap.version.size,
            }
          : undefined,
      };
    },
    async search(_query: string, scope?: { folders?: string[] }, limit?: number) {
      const results = await backend.queryNotes({
        folderScope: scope?.folders?.[0],
        limit: limit || 10,
      });
      return results.rows.map((r) => ({
        path: r.path,
        title: r.title || r.path.replace(/\.md$/, ''),
      }));
    },
  };
}

/**
 * Local AI Backend for Standalone Web Mode (Ollama & LM Studio only).
 * Cloud BYOK is prohibited in pure browser state to protect API keys.
 */
export class LocalAIBackend implements AIBackend {
  public readonly isGatewayMode = false;
  private readonly aiManager: AIManager;

  constructor(
    private readonly workspaceBackend: WorkspaceBackend,
    config?: { ollamaEndpoint?: string; lmStudioEndpoint?: string }
  ) {
    this.aiManager = new AIManager({
      ollamaEndpoint: config?.ollamaEndpoint || 'http://localhost:11434/v1',
      lmStudioEndpoint: config?.lmStudioEndpoint || 'http://localhost:1234/v1',
    });
  }

  async listProviders(): Promise<AIProviderInfo[]> {
    return [
      {
        id: 'ollama',
        name: 'Ollama (Local)',
        type: 'local',
        configured: true,
        defaultModel: 'llama3',
      },
      {
        id: 'lmstudio',
        name: 'LM Studio (Local)',
        type: 'local',
        configured: true,
        defaultModel: 'local-model',
      },
      {
        id: 'openai',
        name: 'OpenAI (Gateway Required)',
        type: 'cloud',
        configured: false,
      },
      {
        id: 'anthropic',
        name: 'Anthropic Claude (Gateway Required)',
        type: 'cloud',
        configured: false,
      },
      {
        id: 'gemini',
        name: 'Google Gemini (Gateway Required)',
        type: 'cloud',
        configured: false,
      },
      {
        id: 'openrouter',
        name: 'OpenRouter (Gateway Required)',
        type: 'cloud',
        configured: false,
      },
    ];
  }

  async listModels(providerId: AIProviderId): Promise<AIModel[]> {
    if (providerId !== 'ollama' && providerId !== 'lmstudio') {
      throw new Error(
        'Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application state.'
      );
    }
    const provider = await this.aiManager.getProvider(providerId);
    return provider.listModels();
  }

  async getSecretStatus(
    providerId: AIProviderId
  ): Promise<{ configured: boolean; masked?: string }> {
    if (providerId === 'ollama' || providerId === 'lmstudio') {
      return { configured: true };
    }
    return { configured: false };
  }

  async setSecret(_providerId: AIProviderId, _secret: string): Promise<void> {
    throw new Error(
      'Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application state.'
    );
  }

  async clearSecret(_providerId: AIProviderId): Promise<void> {
    // No-op for local
  }

  async *chat(request: AIChatRequest): AsyncIterable<AIChatChunkResponse> {
    if (request.provider !== 'ollama' && request.provider !== 'lmstudio') {
      throw new Error(
        'Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application state.'
      );
    }

    const provider = await this.aiManager.getProvider(request.provider);

    // 1. Retrieval
    let retrievedContextPrompt = '';
    let retrievedMetadata: AIResponseMetadata | undefined;
    let retrievedSources: { path: VaultPath; title: string }[] = [];

    if (request.retrievalScope) {
      const knowledgeSource = createBackendKnowledgeSource(this.workspaceBackend);
      const userPrompt = request.messages[request.messages.length - 1]?.content || '';
      const retrieved = await retrieveContext(knowledgeSource, userPrompt, request.retrievalScope, {
        maxChunks: 5,
        maxTokens: 4096,
      });
      retrievedContextPrompt = formatContextPrompt(retrieved);
      retrievedSources = retrieved.chunks.map((c) => ({
        path: c.notePath,
        title: c.noteTitle,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
      }));
      retrievedMetadata = {
        retrievalScope: request.retrievalScope,
        retrievedSources,
        provider: request.provider,
        model: request.model,
      };
    }

    // 2. Prepare messages
    const finalMessages: ChatMessage[] = [];
    if (retrievedContextPrompt) {
      finalMessages.push({
        role: 'system',
        content: `You are an intelligent AI assistant in Open Knowledge Workspace. Ground your responses strictly in the provided Vault Context.\n\n${retrievedContextPrompt}`,
      });
    }
    finalMessages.push(...request.messages);

    const stream = provider.chat({
      model: request.model,
      messages: finalMessages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      signal: request.signal,
    });

    let accumulatedContent = '';

    for await (const chunk of stream) {
      accumulatedContent += chunk.content;

      let citations: Citation[] | undefined;
      let proposal: ProposedEdit | undefined;

      if (chunk.isDone) {
        citations = extractCitations(accumulatedContent, retrievedSources);
        if (request.activeNoteContext) {
          const parsed = parseProposedEditFromResponse(
            accumulatedContent,
            request.activeNoteContext.path,
            request.activeNoteContext.content,
            request.activeNoteContext.expectedVersion
          );
          if (parsed) {
            proposal = parsed;
          }
        }
      }

      yield {
        chunk,
        metadata: chunk.isDone ? retrievedMetadata : undefined,
        citations,
        proposal,
      };
    }
  }
}

/**
 * Gateway AI Backend for Gateway-Managed Web Mode.
 * Communicates with the authenticated OpenOb Gateway AI REST / Streaming API.
 * Cloud secrets remain securely inside the Gateway process and are never returned to Web UI.
 */
export class GatewayAIBackend implements AIBackend {
  public readonly isGatewayMode = true;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: { url: string; token: string }) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.token = options.token;
  }

  private get authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async listProviders(): Promise<AIProviderInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/ai/providers`, {
      headers: this.authHeaders,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to list providers: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.providers || [];
  }

  async listModels(providerId: AIProviderId): Promise<AIModel[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/ai/models?provider=${encodeURIComponent(providerId)}`,
      {
        headers: this.authHeaders,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to list models: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.models || [];
  }

  async getSecretStatus(
    providerId: AIProviderId
  ): Promise<{ configured: boolean; masked?: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/ai/secrets/${encodeURIComponent(providerId)}/status`,
      {
        headers: this.authHeaders,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to get secret status: HTTP ${res.status}`);
    }
    return await res.json();
  }

  async setSecret(providerId: AIProviderId, secret: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/ai/secrets/${encodeURIComponent(providerId)}`, {
      method: 'PUT',
      headers: this.authHeaders,
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to set secret: HTTP ${res.status}`);
    }
  }

  async clearSecret(providerId: AIProviderId): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/ai/secrets/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
      headers: this.authHeaders,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to clear secret: HTTP ${res.status}`);
    }
  }

  async *chat(request: AIChatRequest): AsyncIterable<AIChatChunkResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify({
        provider: request.provider,
        model: request.model,
        messages: request.messages,
        retrievalScope: request.retrievalScope,
        activeNoteContext: request.activeNoteContext,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: true,
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `AI chat request failed: HTTP ${res.status}`);
    }

    if (!res.body) {
      yield { chunk: { content: '', isDone: true } };
      return;
    }

    const reader = res.body.getReader();
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

          let jsonStr = trimmed;
          if (trimmed.startsWith('data: ')) {
            jsonStr = trimmed.slice(6).trim();
          }

          if (jsonStr === '[DONE]') {
            yield { chunk: { content: '', isDone: true, finishReason: 'stop' } };
            return;
          }

          try {
            const parsed = JSON.parse(jsonStr) as AIChatChunkResponse;
            yield parsed;
            if (parsed.chunk?.isDone) {
              return;
            }
          } catch {
            // Ignore malformed or fragmented chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { chunk: { content: '', isDone: true } };
  }
}
