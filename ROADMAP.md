# ROADMAP

## Phase 0 — Foundation

Deliver:

- repository structure
- docs
- CI
- lint/typecheck/test harness
- architecture boundaries

Exit gate:

- agents can identify canonical state, derived state, and core interfaces
- no production feature code required

## Phase 1 — Trustworthy Vault

Deliver:

- folder/vault selection
- file tree
- Markdown open
- edit
- safe save
- autosave
- external-change detection
- create/rename/move/delete
- integration tests

Exit gate:

- destructive/conflict tests pass
- app restart preserves exact content
- known silent data-loss bugs: zero

## Phase 2 — Workspace

Deliver:

- CodeMirror editor
- tabs
- split panes
- command palette
- keyboard shortcuts
- outline
- preview

Exit gate:

- daily editing feels responsive
- no expensive work blocks typing

## Phase 3 — Index

Deliver:

- Markdown parser
- normalized document model
- SQLite derived index
- incremental updates
- full rebuild

Exit gate:

- deleting index and rebuilding yields equivalent state
- 10k-note benchmark acceptable

## Phase 4 — Links / Search

Deliver:

- wikilinks
- aliases
- backlinks
- FTS
- unresolved links
- rename/move behavior

Exit gate:

- adversarial rename/link fixtures pass
- search remains responsive

## Phase 5 — Graph / Metadata

Deliver:

- tags
- frontmatter/properties
- graph
- provenance-aware edges

Exit gate:

- graph consumes index only
- graph does not block ordinary editing

## Phase 6 — Notion-Like Views

Deliver:

- property queries
- table view
- list view
- board view
- saved views

Exit gate:

- views remain derived from open file metadata

## Phase 7 — Local AI

Deliver:

- provider abstraction
- Ollama/LM Studio/custom local endpoint
- scoped retrieval
- note citations
- proposal-based edits

Exit gate:

- disabling AI leaves app fully functional
- no AI operation can bypass file permissions

## Phase 8 — BYOK Cloud AI

Deliver:

- local Node/TypeScript gateway
- secure secrets
- cloud provider adapters
- model picker
- streaming

Exit gate:

- cloud secret cannot be read back by UI
- provider failure cannot affect note operations

## Phase 9 — Plugin SDK

Deliver:

- manifest
- permissions
- plugin host
- commands
- views
- settings
- vault/search/AI APIs
- developer template

Exit gate:

- crashing plugin does not crash workspace
- unauthorized capability calls fail
- first-party plugin can be built with no private imports

## Phase 10 — First-Party Plugin Pack

Potential:

- Daily Notes
- Templates
- Calendar
- Kanban
- Character Bible
- Manuscript Tools
- Git
- Advanced Graph
- AI providers

Exit gate:

- API pain points resolved publicly, not with secret backdoors

## Phase 11 — Dogfood / Public Alpha

Deliver:

- real-world daily use
- bug triage
- performance profiling
- documentation

Exit gate:

- core workflows feel better than returning to another notes app for target users
- no severity-critical integrity bugs

## Phase 12 — Desktop Wrapper

Deliver later:

- Electron shell
- filesystem watcher
- native integration
- secure key storage
- update flow

## Phase 13 — Sync

Separate project-level architecture.

Do not begin until canonical local behavior is mature.

## Phase 14 — Mobile

Preserve storage/provider/plugin contracts where practical.

## Phase 15 — Collaboration

CRDT/collaboration only after sync and local data semantics are proven.

## Phase 16 — Plugin Registry

Only after API stability has survived real plugins.
