import { VaultPath } from '@okw/core';

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Citation {
  readonly notePath: VaultPath;
  readonly noteTitle: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly excerpt?: string;
}

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly name?: string;
  readonly citations?: Citation[];
}

export interface AIModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly isDefault?: boolean;
}

export interface AICapabilities {
  readonly streaming: boolean;
  readonly toolCalling?: boolean;
  readonly maxContextTokens?: number;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export interface AIChunk {
  readonly content: string;
  readonly isDone: boolean;
  readonly model?: string;
  readonly finishReason?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  listModels(): Promise<AIModel[]>;
  capabilities(model: string): Promise<AICapabilities>;
  chat(request: ChatRequest): AsyncIterable<AIChunk>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(input: string[]): Promise<number[][]>;
}

export type RetrievalScopeType =
  'selection' | 'current_note' | 'selected_notes' | 'folder' | 'vault';

export interface RetrievalScope {
  readonly type: RetrievalScopeType;
  readonly notePath?: VaultPath;
  readonly selectedText?: string;
  readonly selectedPaths?: VaultPath[];
  readonly folderPrefix?: string;
}

export interface RetrievedContextChunk {
  readonly notePath: VaultPath;
  readonly noteTitle: string;
  readonly content: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly score: number;
}

export interface RetrievedContext {
  readonly scope: RetrievalScope;
  readonly chunks: RetrievedContextChunk[];
  readonly totalTokensEstimate: number;
}

export interface ProposedEdit {
  readonly id: string;
  readonly path: VaultPath;
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly explanation: string;
  readonly expectedVersion?: {
    readonly token: string;
    readonly hash?: string;
    readonly modifiedAt?: number;
    readonly size?: number;
  };
  readonly createdAt: number;
}

export interface AIResponseMetadata {
  readonly retrievalScope: RetrievalScope;
  readonly retrievedSources: {
    readonly path: VaultPath;
    readonly title: string;
    readonly lineStart?: number;
    readonly lineEnd?: number;
  }[];
  readonly provider: string;
  readonly model: string;
}

export interface AIProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly type: 'local' | 'cloud';
  readonly configured: boolean;
  readonly maskedSecret?: string;
  readonly defaultModel?: string;
}

export interface AIKnowledgeSource {
  readNote(path: VaultPath): Promise<{
    text: string;
    version?: { token: string; hash?: string; modifiedAt?: number; size?: number };
  }>;
  search(
    query: string,
    scope?: { folders?: string[] },
    limit?: number
  ): Promise<{ path: VaultPath; title: string }[]>;
}

export interface LocalAIConfig {
  readonly endpointUrl: string; // e.g. "http://localhost:11434/v1" or "http://localhost:1234/v1"
  readonly apiKey?: string;
  readonly defaultModel?: string;
  readonly maxContextTokens?: number;
  readonly temperature?: number;
}
