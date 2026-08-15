# Architectural Decisions

## D-001 Modular Monolith Package Structure

**Decision:** The project is organized as a modular TypeScript monorepo with strict dependency direction: `core` -> `vault` / `markdown` -> `index` -> `app`.

**Reason:** Keeps domain logic free of UI/storage details and enables fast test cycles against clean abstractions.

## D-002 Canonical Markdown Files as Single Source of Truth

**Decision:** Notes on disk are the authoritative state. SQLite, in-memory caches, and graph models are strictly disposable and rebuildable derived state.

**Reason:** Prevents database lock-in and guarantees that external file modifications never result in silent data corruption.

## D-003 Atomic Safe-Save Write Pipeline

**Decision:** File writes write to a temp file first, verify contents and hash, then atomically rename onto the target file.

**Reason:** Prevents truncated files and data corruption during process crashes or power loss (`F-002`).

## D-004 Unified Normalized VaultPath Abstraction

**Decision:** All paths within the workspace are represented as normalized, POSIX-style relative paths without leading slashes or Windows backslashes.

**Reason:** Ensures cross-platform link resolution, consistency across OS filesystems, and prevents case/slash path bugs.

## D-005 Deterministic Wikilink Resolution Order

**Decision:** Wikilinks resolve in strict order: (1) exact relative path, (2) exact vault root path, (3) unique basename anywhere in vault, (4) frontmatter alias. Ambiguities return candidate matches.

**Reason:** Guarantees deterministic, predictable link navigation across vaults of any depth (`F-010`).

## D-006 Debounced Incremental Indexing with Immediate Write-Through

**Decision:** File modifications write through to disk immediately via SafeWriter; derived index updates are debounced to maintain sub-16ms editor typing responsiveness.

**Reason:** Satisfies the Performance Stop Rule while ensuring durable data persistence.

## D-007 Multi-Tab Isolation via Component Key Mounting

**Decision:** Editor instances are keyed to the active document path (`key={activeTab.path}`) rather than reusing existing DOM state.

**Reason:** Prevents stale closure capture and cross-document buffer leakage when switching tabs.

## D-008 Defensive CodeMirror Command Isolation

**Decision:** Hotkey handlers registered in CodeMirror explicitly return `true` to halt browser event propagation.

**Reason:** Prevents double execution of commands like Save (Ctrl+S) and Quick Open (Ctrl+P).

## D-009 Dual-Agent Architecture Division of Labor

**Decision:** Gemini 3.7 Flash in Google Antigravity 2.0 is the primary implementation/architecture foreman. DeepSeek V4 Flash in Reasonix is the adversarial reviewer and bounded secondary implementer.

**Reason:** one architectural authority prevents two-model divergence while retaining independent failure discovery.

## D-011 SafeSave ExpectedVersion & Content Hash Concurrency

**Decision:** Storage write operations require `expectedVersion` concurrency verification against file mtime and FNV/SHA content hashes. Unconditional overwrite requires explicit user force flag.

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
