# ARCHITECTURE

## 1. System Shape

```text
User Markdown / Attachments
          |
          v
     VaultStorage
          |
          v
        Parser
          |
          v
   Derived Local Index
     /     |      \
 Search   Links   Graph
     \      |      /
      Retrieval Layer
             |
             v
        AI Provider API
             |
   +---------+----------+
   |         |          |
 Local      BYOK      Custom
 Models     Cloud      Endpoint
```

Plugins interact with stable public APIs around these subsystems.

## 2. Canonical vs Derived State

### Canonical

- Markdown
- attachments
- user settings that cannot be reconstructed
- user-created plugin configuration
- explicitly saved AI output

### Derived

- full-text index
- parsed links
- backlinks
- graph layout
- embeddings
- semantic index
- thumbnails
- cached AI responses
- inferred relationships

Every derived subsystem must have a rebuild path.

## 3. Core Interfaces

### VaultStorage

```ts
export interface VaultStorage {
  list(path: string): Promise<VaultEntry[]>;
  read(path: string): Promise<FileSnapshot>;
  write(
    path: string,
    expectedVersion: FileVersion,
    data: Uint8Array | string
  ): Promise<WriteResult>;
  stat(path: string): Promise<FileStat>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  watch?(listener: VaultChangeListener): Promise<Unsubscribe>;
}
```

The `expectedVersion` concept exists to prevent silent overwrites.

### DocumentParser

```ts
export interface DocumentParser {
  parse(snapshot: FileSnapshot): Promise<ParsedDocument>;
}
```

### LinkResolver

```ts
export interface LinkResolver {
  resolve(source: DocumentId, rawTarget: string): LinkResolution;
}
```

There must be one authoritative link resolver.

### SearchEngine

```ts
export interface SearchEngine {
  query(request: SearchRequest): Promise<SearchResponse>;
}
```

### AIProvider

```ts
export interface AIProvider {
  id: string;
  listModels(): Promise<AIModel[]>;
  capabilities(model: string): Promise<AICapabilities>;
  chat(request: ChatRequest): AsyncIterable<AIChunk>;
}
```

### EmbeddingProvider

```ts
export interface EmbeddingProvider {
  embed(input: string[]): Promise<number[][]>;
}
```

### Plugin API

Plugins receive a narrowed facade, never direct application internals.

## 4. Recommended Repository Layout

```text
/
  apps/
    web/              # React browser UI
    gateway/          # Local HTTP/MCP agent gateway (127.0.0.1 loopback)
    desktop/          # future wrapper only

  packages/
    core/             # Core interfaces, types, errors, path utilities
    vault/            # VaultStorage, SafeWriter, NoteWriteCoordinator
    markdown/         # AST parsing, frontmatter, tasks, wikilinks
    index/            # DocumentIndex, SQLite index, search engine, graph
    workspace/        # OpenObWorkspace application-service layer & MCP tools
    ai/               # Local & cloud AI provider abstractions
    plugin/           # First-party plugin SDK and host
    desktop/          # Native Node runtime library (watcher, secret store)

  tests/
    fixtures/
    integrity/
    e2e/
```

Do not split into independent deployable services.

This is a modular monolith unless a future requirement proves otherwise.

## 5. Indexing

### Startup flow

```text
enumerate files
-> compare path/size/mtime metadata
-> hash files that appear changed
-> parse only changed files
-> write one consistent index transaction
-> publish index change event
```

### Worker model

Parsing, hashing, FTS maintenance, embeddings, and expensive graph computation belong in workers when practical.

The main thread coordinates UI only.

## 6. Safe Save Algorithm

Recommended conceptual flow:

```text
editor buffer
-> debounce/autosave trigger
-> read/compare current file version
-> if external change: stop and surface conflict
-> write safely through storage adapter
-> verify resulting version
-> update editor snapshot
-> enqueue reindex
```

Never implement "last writer wins" silently.

## 7. Search

Three layers may eventually coexist:

1. navigation search
2. lexical/full-text search
3. semantic search

They must share a normalized result format.

AI retrieval consumes search results. Search does not consume generative AI.

## 8. Graph

The graph consumes indexed edges.

It must not independently parse Markdown.

Possible edge sources:

- wikilinks
- embeds
- tags
- properties
- citations
- AI-inferred relationships

Each edge carries provenance.

## 9. Properties / Views

Properties live in open Markdown metadata such as YAML frontmatter.

Database-like views are query/render layers over those properties.

Do not create an opaque canonical block database.

## 10. Workspace Service & External Gateway (`@okw/workspace` & `apps/gateway`)

The `OpenObWorkspace` application service layer unifies all interaction with the vault across UI adapters, external agents (Hermes, Claude Code, Antigravity, Reasonix), local CLI tools, and MCP adapters.

### Single-Authority Model:

- **Browser-Direct Mode:** Web UI owns direct filesystem access via `BrowserFSAVaultStorage`.
- **Gateway-Managed Mode:** Gateway process owns Node filesystem access and coordinates state via `OpenObWorkspace`.
- External interfaces are strictly forbidden from directly writing to disk, bypassing `SafeWriter`, or manipulating derived SQLite indexes independently.

### Gateway Responsibilities:

- Local loopback binding (`127.0.0.1` strictly; never `0.0.0.0`)
- Bearer token authentication and client identity tracking
- Read-only REST API (`/health`, `/api/v1/workspace`, `/api/v1/entries`, `/api/v1/notes/:path`, `/api/v1/search`, backlinks, links, properties, graph-neighbors)
- Protocol-neutral MCP tool dispatching (`openob_*`)
- Hold cloud secrets outside hosted browser JavaScript
- Redact secrets from stdout and logs

### Non-responsibilities:

- User accounts / cloud multi-tenancy
- Remote cloud storage
- Bypass of SafeWriter or NoteWriteCoordinator
- Telemetry service (`sumo-sized-api` is explicitly separate)

## 11. Desktop Wrapper

Electron or another wrapper may later provide:

- filesystem watching
- deeper OS integration
- secure local secret storage
- native menus
- protocol handlers
- auto-update

The wrapper must remain an adapter around the web application.

## 12. Architecture Smells

Stop for review if any of these appear:

- `VaultService`, `VaultManager`, and `VaultRepository` all contain business logic
- graph parses Markdown directly
- AI provider writes files directly
- plugin imports from `src/internal`
- search logic exists in multiple packages
- runtime-specific APIs leak through all layers
- application DB becomes necessary to recover user notes
- a feature requires changing unrelated subsystems
- an abstraction has one implementation and no demonstrated boundary need
