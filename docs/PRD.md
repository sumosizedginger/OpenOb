# PRODUCT REQUIREMENTS DOCUMENT

## 1. Product Summary

Create an open-source, local-first knowledge workspace built primarily with web technologies.

The product should provide:

- Markdown editing
- file/folder vaults
- wikilinks
- backlinks
- tags
- headings and outlines
- fast lexical search
- properties/frontmatter
- Notion-like database views over Markdown metadata
- knowledge graph visualization
- AI-assisted retrieval and editing
- BYOK cloud providers
- local model support
- a permissioned plugin ecosystem
- optional desktop/mobile wrappers later
- optional sync/collaboration much later

## 2. Product Principles

### Local ownership

User-authored files live where the user chooses.

### Open formats

Markdown and normal attachments remain readable outside the application.

### AI optionality

The app remains useful with every AI feature disabled.

### Provider independence

AI functionality must not be tied to one provider.

### Extensibility

Third parties must eventually be able to add capabilities without forking core.

### Trust

Silent data loss is an existential product failure.

## 3. Personas

### Writer / researcher

Needs fast editing, linking, retrieval, long-form organization, search, backlinks, and optional AI over selected material.

### Technical user

Needs plain files, Git compatibility, external editing, robust search, keyboard commands, plugin APIs, and inspectable architecture.

### Privacy-first user

Needs offline use, local models, no account requirement, and no mandatory telemetry.

### Plugin developer

Needs stable APIs, templates, hot reload, documented permissions, examples, and predictable versioning.

## 4. Core Functional Requirements

### Vault

The user can:

- select/create a vault
- browse folders
- create notes
- rename notes
- move notes
- delete notes
- restore/recover where supported
- open external changes safely
- use another editor against the same Markdown files

### Editor

The editor supports:

- Markdown syntax
- autosave
- undo/redo
- tabs
- split panes
- keyboard shortcuts
- command palette
- rendered preview
- outline
- link completion
- tag completion

### Links

Support at minimum:

- `[[Note]]`
- `[[Note|Alias]]`
- `[[Note#Heading]]`
- embeds later
- unresolved/broken links
- backlink discovery
- safe rename/move behavior

### Search

Support:

- file/title navigation
- full-text search
- filters
- property search
- link/backlink search

Semantic search is additive, not a replacement.

### Properties and Views

Markdown frontmatter/properties may drive:

- tables
- lists
- boards
- galleries
- calendar-like views later

Views are derived representations of Markdown metadata.

### Graph

The graph must visualize indexed relationships.

Human-authored relationships and AI-inferred relationships must be visually distinct.

### AI

Users can:

- choose provider
- choose model
- choose context scope
- ask questions over notes
- summarize selected content
- propose edits
- perform retrieval-grounded conversations
- use local models
- use BYOK cloud models through secure local execution

### Plugins

Plugins can eventually:

- add commands
- add panels
- add settings
- extend editors
- query vault data
- query search
- extend graph overlays
- register AI providers
- contribute views

All access is permissioned.

## 5. Non-Functional Requirements

### Reliability

- No silent overwrites of externally modified files.
- Derived state can be rebuilt from canonical files.
- A crash during indexing cannot damage Markdown.
- Plugin or AI failure cannot destroy the workspace.

### Performance

Targets, not guarantees:

- normal typing should remain within one animation frame budget
- command palette should feel immediate
- normal note open should feel immediate
- search should produce early results quickly
- indexing must run off the UI thread
- large vault performance must be benchmarked continuously

### Security

- no cloud API secrets in hosted browser code
- plugin permission model
- content sanitization for rendered Markdown
- explicit tool execution layer for AI
- no unrestricted plugin filesystem access

### Accessibility

- keyboard operability
- semantic controls
- focus visibility
- screen-reader friendly structure where practical
- scalable typography
- reduced-motion support

## 6. Initial Release Scope

### 0.1

Trustworthy vault + editor:

- choose vault
- browse files
- open note
- edit
- safe save
- autosave
- external-change detection
- tabs
- command palette
- tests

### 0.2

Index/search/backlinks:

- parser
- SQLite index
- incremental indexing
- FTS
- wikilinks
- backlinks
- rename/move tests

### 0.3

Workspace/graph:

- split panes
- outline
- graph
- tags
- aliases

### 0.4

Properties/views

### 0.5

Local AI

### 0.6

BYOK cloud AI

### 0.7

Plugin SDK

### 0.8

First-party plugins

### 0.9

Public alpha / extensive dogfooding

### 1.0

The team is willing to tell a user:

> Yes, trust this with real notes, while still keeping backups as normal good practice.

## 7. Explicit Early Non-Goals

- real-time collaboration
- cross-device sync
- mandatory hosted backend
- enterprise identity
- team permissions
- plugin marketplace
- full mobile parity
- autonomous AI with unrestricted file access

## 8. Success Metrics

Early success is not downloads.

Early success means:

- zero known silent data-loss bugs
- reliable index rebuilds
- fast real-world editing
- deterministic link resolution
- passing large-vault benchmarks
- actual daily use
- architecture remaining understandable
- plugin boundaries surviving first-party use

## 9. Current Engineering Execution Model

The current build process assumes:

- Google Antigravity 2.0 + Gemini 3.7 Flash as primary foreman/implementer.
- Reasonix + `deepseek-v4-flash` as adversarial reviewer, test engineer, and bounded secondary implementer.

The product architecture itself must remain model-independent. These are development tools, not runtime dependencies.
