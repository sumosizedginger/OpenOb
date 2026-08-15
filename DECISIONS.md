# Architectural Decisions (ADR)

## D-001 Storage Model
Single authoritative storage interface (`VaultStorage`) with two implementations:
- `NodeFsVaultStorage` (Desktop / Node CLI)
- `BrowserFSAVaultStorage` (Web / Origin Private File System / File System Access API)
- `MemoryVaultStorage` (In-Memory for testing)

## D-002 Disposable SQLite Index
SQLite is strictly a disposable read-cache and index for search, backlinks, and graph queries. Canonical source of truth is always the Markdown files on disk. If SQLite is wiped, it must be 100% rebuildable from disk with zero data loss.

## D-003 Concurrency & Safe Save
Atomic write model using `SafeWriter`. Every write checks expected vs actual content hash. If modified externally, a `ConflictError` is raised.

## D-004 Wikilink Resolution Contract
Strict 4-level resolution priority:
1. Exact relative path
2. Subfolder path
3. Unique basename (shortest path wins)
4. Explicit aliases

## D-005 Plugin Sandbox & Permission Model
Plugins execute in an isolated Web Worker or sandboxed iframe. Zero direct access to Node.js `fs`, raw DOM, or network unless explicitly granted by capability manifest.

## D-006 AI Provider Abstraction
AI features interact with an abstract `AIProvider` contract. No hardcoded OpenAI/Anthropic SDKs in core. Local models (Ollama, LM Studio) and cloud models implement the same interface.

## D-007 Markdown AST & Frontmatter
Markdown parsing uses unified/remark AST pipeline. Frontmatter is parsed to structured metadata.

## D-008 Single-Writer Sync Protocol
Local changes are written to disk first. Remote sync is an external replicator that merges via version vectors / CRDTs, never bypassing `VaultStorage`.

## D-009 Multi-Tab Workspace Concurrency Token
Every open tab must retain its immutable `initialSnapshot` (content + version token). When saving, `SafeWriter` validates that the disk state still matches `initialSnapshot.version.token`. If modified elsewhere or on disk, a concurrency conflict is triggered and resolved without data loss.

## D-010 Atomic Temporary File Renaming
On Node.js environments, writes must write to an isolated temporary file (`.tmp.timestamp.random`) and atomically rename over the target path via `fs.rename` to prevent half-written files on crash.

## D-011 Explicit Version Token / Stat Tracking on Node FS
`NodeFsVaultStorage` returns structured `FileVersion` containing exact content hash, size, and modified timestamp to guarantee atomic optimistic locking.

**Reason:** Prevents `F-001` (silent data overwrite) and `F-002` (partial corrupt write) in multi-tab, external editor, and rapid autosave workflows.

## D-012 Content-Aware Checkbox Mutation & EOL Preservation

**Decision:** In-place Markdown task mutations must locate targets by content match rather than trusting raw line numbers from debounced snapshots, and must preserve the file's dominant CRLF / LF line endings.

**Reason:** Prevents `F-026` (stale preview line offset mutation) and `F-027` (CRLF-to-LF file churn).

## D-013 DocumentIndex Extends SearchEngine Contract Unification & Deterministic Path Sorting

**Decision:** `DocumentIndex` formally extends the `SearchEngine` interface so every index implementation (in-memory, SQLite) provides unified query and backlink capabilities directly with verified behavioral parity. `getAll()` outputs are deterministically sorted by path across all adapters.

**Reason:** Eliminates ad-hoc typecasting between index and search subsystems, keeps derived search and relational lookups coupled to the same rebuild lifecycle, and guarantees seamless interchangeability across adapters.

## D-014 Vault-Wide Safe Note Rename & Wikilink Refactoring

**Decision:** Note renames execute through `renameDocument(storage, index, parser, oldPath, newPath, options)` which atomically rewrites referencing `[[wikilinks]]` across the vault, preserves subpaths (`#Heading`) and aliases (`|Display`), protects code blocks and frontmatter, handles internal self-references, preserves CRLF/LF line endings, and renames canonical storage before updating the derived index, backed by an exception-safe rollback journal.

**Reason:** Eliminates broken incoming backlinks during folder reorganization (`F-010`, `F-011`) while guaranteeing strict data integrity and zero silent overwrites (`F-001`).

## D-015 Pure-Derived Provenance-Aware Graph & Structured Metadata

**Decision:** All graph models, node degrees, and edges (`wikilink`, `embed`, `tag`, `property`) are strictly derived from `DocumentIndex` via `buildGraphData(index, options)` with zero direct storage access (Constitution Law 21). Interactive Canvas graph simulation uses rapid auto-cooling decay to prevent main-thread editor typing stalls.

**Reason:** Guarantees absolute single-writer indexing architecture, ensures graph views scale to thousands of notes without file I/O overhead, and preserves sub-16ms editor responsiveness (Performance Stop Rule).

## D-016 Notion-Like Database Views & Non-Destructive Frontmatter Property Mutation

**Decision:** Database Views (Table, Board/Kanban, List, Saved Views) and Property Queries are strictly derived on-the-fly from open file metadata in `DocumentIndex` with zero proprietary database locks (Constitution Law 21). Property mutations update Markdown YAML frontmatter in-place, preserving `# ...` comments, untouched fields, typed array items, whitespace padding, CRLF/LF line endings, and UTF-8 BOM, strictly conforming to YAML 1.2 specifications.

**Reason:** Eliminates proprietary database lock-in, ensures 100% of notes remain transparent plain-text Markdown files on disk, and allows safe inline spreadsheet/kanban property editing without corrupting document body text or structure.

## D-017 Local AI Provider Abstraction, Scoped Retrieval & Proposal-Based Edits

**Decision:** AI is an optional, replaceable capability layer interacting through the abstract `AIProvider` contract (`OpenAICompatibleProvider` supporting Ollama, LM Studio, and custom local endpoints). Context retrieval is strictly bounded to user-selected scopes (selection, current note, folder, vault) with clickable note citations. All AI file modifications operate in `PROPOSE` mode producing structured diffs (`ProposedEdit`) applied only on explicit user approval via `SafeWriter` optimistic concurrency control.

**Reason:** Enforces Constitution Laws 18 & 19 (AI failure never degrades core workspace functionality, and AI can never silently write to disk or bypass file permissions).

## D-018 Bring-Your-Own-Key (BYOK) Cloud AI, Secret Isolation & Multi-Provider Parity

**Decision:** Cloud AI providers (OpenAI, Anthropic Claude, Google Gemini, OpenRouter) integrate through unified `AIManager` with zero hardcoded API keys in application state. Secrets are isolated in `SecretStore` with masked UI presentation (`sk-...WXYZ`), and all outbound request errors and logs pass through `redactSecrets()` sanitization (Constitution Law 17, `F-005`). Provider 4xx/5xx failures are fully isolated and cannot impede core note storage, search, graph, or database view operations (Constitution Law 18).

**Reason:** Empowers users to use their own cloud AI keys with strict privacy, zero secret leakage, and total workspace operational resilience.

## D-019 Isolated Capability Host, Permission Manifest & Plugin SDK

**Decision:** Plugins execute against an isolated capability host (`PluginHost`) interacting strictly through a sandboxed, permission-gated bridge (`PluginAPI`). All plugin capabilities (`vault.read`, `vault.write`, `search.query`, `workspace.modify`, `ai.use`) must be explicitly declared in `manifest.permissions`; undeclared invocations fail closed with `PermissionDeniedError` (Constitution Law 20, `F-006`). Crashes during plugin load, unload, or command execution are strictly contained, isolating the failing plugin into an `'error'` state with restart capability while leaving core note storage, editor, search, graph, and views 100% operational (Constitution Law 20, `F-007`). First-party plugins (`WordCount`, `DailyNotes`) are authored strictly against public `PluginAPI` interfaces with zero private internal package imports.

**Reason:** Enables rich modular ecosystem expansion while guaranteeing workspace security and crash resilience.

## D-020 First-Party Plugin Pack & Public API Dogfooding

**Decision:** First-party extensions (`Templates`, `CharacterBible`, `ManuscriptTools`, `DailyNotes`, `WordCount`) are built exclusively as modular plugins using the public `PluginAPI` surface (`@okw/plugin`) with zero private internal package imports. Dynamic templating performs variable interpolation (`{{title}}`, `{{date}}`, `{{time}}`), Character Bible structures world-building profiles with standard YAML properties, and Manuscript Tools aggregates multi-file statistics strictly using `api.vault` and `api.workspace` methods.

**Reason:** Enforces Constitution Law 20 (no undocumented private escape hatches for first-party plugins) and guarantees third-party parity.

## D-021 Full-System End-to-End Integration & Public Alpha Consolidation

**Decision:** The entire Open Knowledge Workspace system across storage, parsing, indexing, search, graph visualization, Notion-like views, Local & Cloud AI, and sandboxed Plugin SDK is consolidated into a single unified architecture. All derived states (in-memory indexes, SQLite caches, graph representations, and view filters) remain 100% disposable and reconstructible from canonical Markdown files. All write mutations enforce optimistic concurrency control, and all third-party and first-party capabilities adhere to strict permission gating and exception containment.

**Reason:** Establishes complete architectural stability, verified zero-data-loss durability, and readiness for real-world dogfooding and public alpha release.
