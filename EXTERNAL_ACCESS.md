# OpenOb — External Programmatic Access & Gateway Architecture

## 1. Overview & Motivation

Open Knowledge Workspace (OpenOb) is designed to serve both interactive human workflows (via the React Web UI and Desktop shell) and automated agents (Hermes, Claude Code, Antigravity, Grok Build, Codex, Reasonix, and local scripts).

To ensure deterministic data integrity and avoid competing or incompatible state machines, **all external access occurs exclusively through a single authoritative application-service layer: `OpenObWorkspace` (`@okw/workspace`)**.

```text
                  +--------------------------------+
                  |         External Agents        |
                  | (Claude Code, Hermes, Reasonix)|
                  +---------------+----------------+
                                  | HTTP / Bearer Auth
                                  v
+------------------+   +----------------------+   +-------------------+
|  React Web UI    |   |     apps/gateway     |   |    Local CLI      |
| (Browser Direct) |   |  (127.0.0.1 loopback)|   |  (Local/Terminal) |
+--------+---------+   +----------+-----------+   +---------+---------+
         |                        |                         |
         +------------------------+-------------------------+
                                  |
                                  v
                  +--------------------------------+
                  |     OpenObWorkspace Service    |
                  |     (@okw/workspace)           |
                  +---------------+----------------+
                                  |
        +-------------------------+-------------------------+
        |                         |                         |
        v                         v                         v
+---------------+         +---------------+         +---------------+
| VaultStorage  |         | SafeWriter &  |         | DocumentIndex |
| (NodeFs/Mem)  |         | Coordinator   |         | & SearchEngine|
+---------------+         +---------------+         +---------------+
```

---

## 2. Single-Authority Vault Modes

A vault operating with OpenOb has **strictly one authoritative writer** at any time. Direct filesystem access outside the service layer is strictly forbidden.

### Mode A: Browser-Direct Mode

- The React Web UI directly accesses the vault directory via the browser's File System Access API (`BrowserFSAVaultStorage`).
- State, safe writing, and write coordination execute directly within the browser runtime.
- The external gateway is inactive for that specific vault directory to avoid multi-writer conflicts.

### Mode B: Gateway-Managed Mode

- A local Node.js gateway process (`apps/gateway`) owns access to the vault filesystem via `NodeFsVaultStorage`.
- External agents, CLI commands, and remote/local web interfaces communicate through the gateway's REST or tool interfaces.
- The gateway coordinates all canonical file access and derived index synchronization through `OpenObWorkspace`.

---

## 3. Why Direct Filesystem Bypass is Forbidden

No adapter, tool, or external agent may directly call `fs.writeFile`, `storage.write`, `storage.remove`, `safeWriter.safeSave`, `index.upsert`, or mutate YAML frontmatter independently.

**Bypassing `OpenObWorkspace` violates core system invariants:**

1. **Concurrency Tokens & Optimistic Locking:** Safe saving relies on `FileVersion` tokens to prevent silent overwrites of user edits (`F-001`).
2. **Deterministic Write Serialization:** In-flight saves and mutations are sequenced per-path via `withPathLock` and `NoteWriteCoordinator` to prevent races and ghost resurrection (`F-002`, `F-039`).
3. **Atomic Commit & EOL Preservation:** File mutations must preserve line endings (CRLF vs LF) and UTF-8 BOM byte fidelity (`F-027`, `F-034`).
4. **Disposable Index Parity:** Document indexing must remain 100% synchronized and derived from canonical Markdown (`F-003`, `F-004`).
5. **Truthful Index Degradation:** Canonical Markdown is the single source of truth. A derived index error after a durable disk write marks index health as degraded without rolling back durable Markdown or claiming the write failed.

---

## 4. Capability Scopes & Authorization Model

External operations are gated by explicit capability scopes. **The gateway server configuration—not client request headers—grants capability scopes.**

### Supported Scopes

| Scope              | Description                                                                             | Phase    |
| :----------------- | :-------------------------------------------------------------------------------------- | :------- |
| `workspace.read`   | Read note contents, metadata, backlinks, outgoing links, properties, directory listings | Phase 1  |
| `workspace.search` | Execute lexical query and tag search across the vault index                             | Phase 1  |
| `workspace.write`  | Create new notes and update body content of existing notes                              | Phase 2A |
| `properties.write` | Set or remove frontmatter properties on existing notes                                  | Phase 2A |
| `workspace.rename` | Rename notes and update inbound wikilinks (Deferred)                                    | Phase 2B |
| `workspace.delete` | Delete notes from vault (Deferred)                                                      | Phase 2B |

### Default Safe Configuration

When started normally without explicit flags, the gateway defaults to **read-only**:

```bash
npx openob-gateway /path/to/vault
# Scopes: [workspace.read, workspace.search]
```

To enable mutation capabilities, explicit `--scopes` must be supplied:

```bash
npx openob-gateway /path/to/vault --scopes workspace.read,workspace.search,workspace.write,properties.write
# Or via environment variable:
# OPENOB_SCOPES=workspace.read,workspace.search,workspace.write,properties.write
```

---

## 5. REST API Reference

All endpoints bind strictly to loopback (`127.0.0.1`).

### Base URL

`http://127.0.0.1:<PORT>` (default: `4200`)

### Endpoints

| Method  | Route                                                | Description                                                      | Required Scope     | Auth Required |
| :------ | :--------------------------------------------------- | :--------------------------------------------------------------- | :----------------- | :------------ |
| `GET`   | `/health`                                            | Server status, vault name, readOnly status                       | None               | No            |
| `GET`   | `/api/v1/workspace`                                  | Workspace metadata, capabilities, and index health               | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/entries?path=`                              | List files and directories at subpath                            | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/notes/:path`                                | Read note metadata, headings, wikilinks, properties, raw body    | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/search?q=&tags=&pathPrefix=&limit=&offset=` | Search notes with lexical query and optional filters             | `workspace.search` | Yes           |
| `GET`   | `/api/v1/notes/:path/backlinks`                      | Retrieve incoming backlinks referencing the note                 | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/notes/:path/links`                          | Retrieve outgoing wikilinks and resolution targets               | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/notes/:path/properties`                     | Retrieve YAML frontmatter properties                             | `workspace.read`   | Yes           |
| `GET`   | `/api/v1/notes/:path/graph-neighbors`                | Retrieve local 1-hop graph structure                             | `workspace.read`   | Yes           |
| `POST`  | `/api/v1/notes`                                      | Create a new note (fails if note exists; expectedVersion=null)   | `workspace.write`  | Yes           |
| `PUT`   | `/api/v1/notes/:path`                                | Update note body content with optimistic concurrency control     | `workspace.write`  | Yes           |
| `PATCH` | `/api/v1/notes/:path/properties`                     | Set or remove a frontmatter property with optimistic concurrency | `properties.write` | Yes           |

---

## 6. CLI Usage

The `openob` CLI binary operates strictly as a REST client over HTTP loopback.

```bash
# Read operations
openob info --json
openob list Notes --json
openob read Notes/Welcome.md --json
openob search "Architecture" --json
openob backlinks Notes/Welcome.md --json

# Mutation operations (requires running gateway with write scopes)
openob create Notes/NewNote.md --content "Hello World" --json
cat content.md | openob update Notes/NewNote.md --expected-version <token> --stdin --json
openob set-property Notes/NewNote.md status "published" --expected-version <token> --json
```

---

## 7. Protocol-Neutral MCP Tools

| Tool Name               | Description                                 | Required Scope     |
| :---------------------- | :------------------------------------------ | :----------------- |
| `openob_workspace_info` | Retrieve vault summary and capabilities     | `workspace.read`   |
| `openob_list_entries`   | List entries in a directory                 | `workspace.read`   |
| `openob_read_note`      | Read full note content and metadata         | `workspace.read`   |
| `openob_search`         | Search vault notes                          | `workspace.search` |
| `openob_get_backlinks`  | Retrieve backlinks pointing to note         | `workspace.read`   |
| `openob_get_properties` | Retrieve YAML frontmatter properties        | `workspace.read`   |
| `openob_create_note`    | Create a new note                           | `workspace.write`  |
| `openob_update_note`    | Update note content with expectedVersion    | `workspace.write`  |
| `openob_set_property`   | Set or remove property with expectedVersion | `properties.write` |
