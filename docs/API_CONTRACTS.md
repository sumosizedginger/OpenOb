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

## Workspace Capability Scopes

All operations through `OpenObWorkspace` and Gateway REST endpoints are governed by capability scopes:

| Scope                   | Authorization & Actions                                                                             |
| :---------------------- | :-------------------------------------------------------------------------------------------------- |
| `workspace.read`        | Read note contents, metadata, links, backlinks, event stream, and list/get/run queries/saved views. |
| `workspace.search`      | Execute keyword and tag searches across vault documents.                                            |
| `workspace.write`       | Create new notes and update markdown note contents with OCC version protection.                     |
| `properties.write`      | Modify note frontmatter properties with OCC version protection.                                     |
| `workspace.rename`      | Move and rename notes and folders with atomic link reference migration.                             |
| `workspace.delete`      | Delete notes and folders with OCC protection.                                                       |
| `workspace.views.write` | Create, update, and delete persisted saved views in `.openob/views/` with OCC protection.           |

### Reserved Metadata Namespace (`.openob/`)

- **Strict Namespace Isolation**: `.openob/` is reserved exclusively for internal OpenOb application metadata (e.g. `.openob/views/<id>.json`).
- **Capability Separation**:
  - `workspace.write`, `properties.write`, `workspace.rename`, and `workspace.delete` authorize operations on **user notes only**. They do **NOT** confer access to `.openob/`.
  - `workspace.views.write` authorizes dedicated Saved View operations (`createSavedView`, `updateSavedView`, `deleteSavedView`) through the Saved View service. It does **NOT** grant note-level CRUD access to arbitrary files inside `.openob/`.
  - All public note APIs (`readNote`, `createNote`, `updateNote`, `deleteNote`, `renameNote`, `setProperty`, `getNoteMetadata`, `getBacklinks`, `getOutgoingLinks`, `getProperties`, `getGraphNeighbors`, and `listEntries`) strictly reject any path in `.openob/` with `InvalidPathError` (HTTP 400).
  - Direct manual metadata mutation through note APIs is not supported.

### Gateway Defaults & Operations

- **Default Posture (Read-Only)**: When started without explicit write scopes, `openob-gateway` runs in read-only mode with `[workspace.read, workspace.search]`.
- **Writable Invocations**: An operator must explicitly specify write capability scopes when launching a writable gateway:
  ```bash
  openob-gateway --vault ./notes --serve-web \
    --scopes workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete,workspace.views.write
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
