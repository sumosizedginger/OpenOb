# Learn OpenOb — Comprehensive Guide

Welcome to OpenOb, the local-first Markdown workspace engineered for privacy, speed, and long-term data permanence.

This guide mirrors the interactive chapters available in the application under **More (···) → Learn OpenOb**.

---

## Table of Contents

1. [Chapter 1: Getting Started & Vault Basics](#chapter-1-getting-started--vault-basics)
2. [Chapter 2: Writing & Markdown Formatting](#chapter-2-writing--markdown-formatting)
3. [Chapter 3: Finding Anything (Instant Search & Quick Open)](#chapter-3-finding-anything-instant-search--quick-open)
4. [Chapter 4: Document Outline, Backlinks & Frontmatter Properties](#chapter-4-document-outline-backlinks--frontmatter-properties)
5. [Chapter 5: Database Views (Tables, Kanban Boards & Lists)](#chapter-5-database-views-tables-kanban-boards--lists)
6. [Chapter 6: Interactive Visual Knowledge Graph](#chapter-6-interactive-visual-knowledge-graph)
7. [Chapter 7: Grounded Assistive AI](#chapter-7-grounded-assistive-ai)
8. [Chapter 8: First-Party Plugins & Tool Ecosystem](#chapter-8-first-party-plugins--tool-ecosystem)
9. [Chapter 9: Keyboard Shortcuts & Power Navigation](#chapter-9-keyboard-shortcuts--power-navigation)
10. [Chapter 10: Agents, CLI & External Process Access](#chapter-10-agents-cli--external-process-access)
11. [Chapter 11: Data Safety, Concurrency & Conflict Prevention](#chapter-11-data-safety-concurrency--conflict-prevention)

---

## Chapter 1: Getting Started & Vault Basics

### The Local-First Philosophy

In OpenOb, your notes are plain CommonMark/GFM Markdown files located directly in a directory on your local filesystem. There are no proprietary database blobs, no forced cloud sync locks, and no vendor lock-in. If you ever stop using OpenOb, all of your files, folders, and attachments remain 100% accessible via any standard text editor or shell tool.

### Vault Directory Structure

When you open or create a vault in OpenOb:

- Notes are `.md` files in your vault folder.
- Subdirectories map 1:1 to folders shown in the left sidebar.
- Internal runtime metadata (such as the disposable SQLite index and cached state) is stored under the `.openob/` directory inside your vault. You can delete `.openob/` at any time and OpenOb will reconstruct it automatically from disk.

### Sidebar Navigation & Tab Management

- **File Explorer (`Ctrl+\`)**: Browse, create (`Ctrl+N`), rename (`F2`), and delete notes.
- **Multi-Tab Workspace**: Open multiple notes simultaneously. Close tabs with `Ctrl+W` or click the tab close icon.
- **Auto-Reconnection**: The desktop shell automatically reconnects to your last opened vault upon launch.

---

## Chapter 2: Writing & Markdown Formatting

### Full CommonMark & GFM Support

OpenOb provides a high-performance CodeMirror 6 editor supporting:

- Headers (`# H1` through `###### H6`)
- Bold (`**bold**`), Italics (`*italic*`), Strikethrough (`~~struck~~`), and Inline Code (`` `code` ``)
- Blockquotes (`> quote`), Ordered & Unordered Lists, and Task Checkboxes (`- [ ] task`)
- Fenced code blocks with syntax highlighting:
  ```ts
  function greet(name: string): string {
    return `Hello, ${name}!`;
  }
  ```

### Wikilinks & Auto-Complete

Type `[[` anywhere in the editor to trigger instant Wikilink auto-complete. You can link directly to note titles:

- `[[My Other Note]]`
- `[[Folder/Deep Note|Custom Display Text]]`

### Document Layout Modes

Cycle layout modes using the header toggle or `Ctrl+E`:

1. **Editor Mode**: Focused, distraction-free writing.
2. **Split Mode**: Live side-by-side editing and sanitized HTML preview.
3. **Preview Mode**: Clean, distraction-free reading experience.

---

## Chapter 3: Finding Anything (Instant Search & Quick Open)

### Quick Open (`Ctrl+P`)

Press `Ctrl+P` to open the search bar. Start typing to filter notes across your entire vault with sub-millisecond responsiveness.

### Full-Text Search

OpenOb indexes note contents into an in-memory SQLite FTS engine. You can search for exact phrases, terms, or partial matches.

### Tag & Property Filtering

- Search by tag: `#project`, `#architecture`
- Search by frontmatter property: `status:active`, `priority:high`

---

## Chapter 4: Document Outline, Backlinks & Frontmatter Properties

The right-hand Contextual Inspector provides deep insight into the active note:

### 1. Document Outline

Displays an interactive table of contents derived from your Markdown `#` headings. Clicking any heading smoothly jumps directly to that section in the editor.

### 2. Backlinks & Outgoing Links

- **Outgoing Links**: Lists all notes referenced by `[[Wikilinks]]` within the current document.
- **Backlinks**: Automatically discovers and displays all other notes across your entire vault that link back to the current note.

### 3. Frontmatter Properties

View and modify YAML frontmatter key-value pairs (e.g. `status`, `tags`, `due_date`, `priority`) through a clean structured table with deterministic type preservation.

---

## Chapter 5: Database Views (Tables, Kanban Boards & Lists)

Transform your Markdown files into dynamic, queryable databases without changing their underlying plain-text format:

### 1. Table View

View vault notes as spreadsheet rows. Columns represent frontmatter properties (`tags`, `status`, `priority`, `created`). Edit properties directly within table cells.

### 2. Kanban Board View

Organize notes into drag-and-drop columns grouped by any frontmatter property (e.g. `status: todo | in-progress | done`). Dragging a card between columns updates the note's YAML frontmatter on disk with optimistic locking.

### 3. Saved Views

Save complex filters, groupings, and sorting preferences as reusable views saved directly under `.openob/views/`.

---

## Chapter 6: Interactive Visual Knowledge Graph

### 2D Force-Directed Graph

Click the **Graph** tab or press `Ctrl+G` to visualize your vault as an interactive network of knowledge:

- **Nodes**: Represent individual Markdown notes.
- **Edges**: Represent `[[Wikilink]]` connections between notes.

### Graph Interaction

- **Hover**: Highlights immediate neighbors and connection pathways.
- **Click**: Opens the selected note in the active editor tab.
- **Filter**: Isolate notes by tag, folder, or orphan status.

---

## Chapter 7: Grounded Assistive AI

### Local-First & Cloud Flexibility

OpenOb supports both private local LLMs and secure cloud providers:

- **Local Models (100% Private)**: Connect to local instances of Ollama or LM Studio. Zero data leaves your machine.
- **Cloud Providers (BYOK)**: Connect your own API keys for OpenAI, Anthropic, or Google Gemini. Keys are encrypted at rest using OS-level DPAPI / Keychain via AES-256-GCM.

### Strict Grounded Retrieval

The AI assistant only reads notes you explicitly provide or search results retrieved from your vault index. AI responses propose diffs and changes for your explicit approval—the AI is never granted direct write authority to silently overwrite your files.

---

## Chapter 8: First-Party Plugins & Tool Ecosystem

### Secure Plugin Sandbox

OpenOb features a capability-based plugin system adhering to Constitution Law 20:

- Plugins run in isolated execution contexts.
- Permissions (e.g., reading notes, modifying properties, registering commands) must be declared in the plugin manifest and explicitly authorized.
- Unrestricted disk access, raw network access, and arbitrary process execution are strictly forbidden.

---

## Chapter 9: Keyboard Shortcuts & Power Navigation

| Shortcut       | Description                                  |
| :------------- | :------------------------------------------- |
| `Ctrl+P`       | Quick Open note finder                       |
| `Ctrl+Shift+P` | Command Palette                              |
| `Ctrl+N`       | Create new note                              |
| `Ctrl+S`       | Save active note immediately                 |
| `Ctrl+E`       | Cycle layout mode (Editor / Split / Preview) |
| `Ctrl+W`       | Close active tab                             |
| `Ctrl+\`       | Toggle left file sidebar                     |
| `Ctrl+G`       | Open Global Graph View                       |
| `F2`           | Rename active or selected note               |
| `Escape`       | Close active modal, dialog, or guided tour   |

---

## Chapter 10: Agents, CLI & External Process Access

### Embedded REST Gateway & CLI

OpenOb runs an embedded loopback gateway (`127.0.0.1`) that exposes a rich REST API and headless CLI tool (`@okw/gateway`). External automation scripts, Python processes, and AI agents can interact with your vault through structured HTTP requests.

### Model Context Protocol (MCP)

OpenOb includes a built-in stdio MCP server (`openob-mcp`) enabling LLM agents (Claude Desktop, Cursor, Goose, Cline) to safely read, search, and propose edits to your vault notes through standard tool contracts.

---

## Chapter 11: Data Safety, Concurrency & Conflict Prevention

### Optimistic Concurrency Control (OCC)

Every write operation in OpenOb requires a version token (`FileVersion`) calculated from the file's hash and modification timestamp:

- If an external tool or concurrent process modifies a file on disk while you are editing, OpenOb detects the version divergence.
- OpenOb will never silently overwrite concurrent external edits. Instead, it flags the conflict and allows you to review differences safely.

### Single-Writer Authority

All file modifications route through the single-writer `NoteWriteCoordinator` and `SafeWriter` subsystem:

- Writes are executed using atomic temporary file swaps (`.okw.tmp` $\rightarrow$ final path).
- Buffer state and in-memory edits are preserved during rapid typing, tab switching, or external disk changes.
