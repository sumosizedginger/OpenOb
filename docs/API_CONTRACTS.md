# API CONTRACTS

This file is an early contract sketch, not a frozen implementation.

The objective is to prevent subsystems from reaching through each other.

## Vault

```ts
export type VaultPath = string;

export interface FileVersion {
  token: string;
}

export interface FileSnapshot {
  path: VaultPath;
  version: FileVersion;
  content: Uint8Array;
  modifiedAt?: number;
  size: number;
}

export interface VaultStorage {
  list(path: VaultPath): Promise<VaultEntry[]>;
  read(path: VaultPath): Promise<FileSnapshot>;
  write(
    path: VaultPath,
    expectedVersion: FileVersion | null,
    content: Uint8Array
  ): Promise<FileSnapshot>;
  stat(path: VaultPath): Promise<FileStat>;
  move(from: VaultPath, to: VaultPath): Promise<void>;
  remove(path: VaultPath): Promise<void>;
}
```

## Parsed Document

```ts
export interface ParsedDocument {
  id: string;
  path: VaultPath;
  title: string;
  aliases: string[];
  headings: ParsedHeading[];
  links: ParsedLink[];
  tags: string[];
  properties: Record<string, unknown>;
  textContent: string;
  sourceHash: string;
}
```

## Index

```ts
export interface DocumentIndex {
  upsert(doc: ParsedDocument): Promise<void>;
  remove(documentId: string): Promise<void>;
  rebuild(source: AsyncIterable<ParsedDocument>): Promise<void>;
  backlinks(documentId: string): Promise<Backlink[]>;
}
```

## Search

```ts
export interface SearchRequest {
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface SearchResult {
  documentId: string;
  path: string;
  title: string;
  excerpt?: string;
  score: number;
  source: 'navigation' | 'fts' | 'semantic' | 'property' | 'link';
}

export interface SearchEngine {
  query(request: SearchRequest): Promise<SearchResult[]>;
}
```

## AI

```ts
export interface AIProvider {
  id: string;
  listModels(): Promise<AIModel[]>;
  chat(request: ChatRequest): AsyncIterable<AIChunk>;
}

export interface EmbeddingProvider {
  id: string;
  embed(input: string[]): Promise<number[][]>;
}
```

## Plugin Host

```ts
export interface PluginContext {
  commands: PluginCommandsApi;
  workspace: PluginWorkspaceApi;
  vault: PluginVaultApi;
  search: PluginSearchApi;
  graph: PluginGraphApi;
  ai: PluginAiApi;
  settings: PluginSettingsApi;
  ui: PluginUiApi;
}
```

Each concrete API object must enforce permissions at the host boundary.
