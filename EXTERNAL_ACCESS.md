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

No adapter, tool, or external agent may directly call `fs.writeFile`, `storage.write`, `storage.remove`, `index.upsert`, or mutate YAML frontmatter independently.

**Bypassing `OpenObWorkspace` violates core system invariants:**

1. **Concurrency Tokens & Optimistic Locking:** Safe saving relies on `FileVersion` tokens to prevent silent overwrites of user edits (`F-001`).
2. **Deterministic Write Serialization:** In-flight saves and renames are sequenced via `NoteWriteCoordinator` to prevent ghost resurrection (`F-002`, `F-039`).
3. **Atomic Commit & EOL Preservation:** File mutations must preserve line endings (CRLF vs LF) and UTF-8 BOM byte fidelity (`F-027`, `F-034`).
4. **Disposable Index Parity:** Document indexing must remain 100% synchronized and derived from canonical Markdown (`F-003`, `F-004`).

---

## 4. REST API Reference (Phase 1 — Read-Only)

All endpoints bind strictly to loopback (`127.0.0.1`) by default. In Phase 1, the API is **strictly read-only**; all mutating HTTP verbs (`POST`, `PUT`, `DELETE`, `PATCH`) return `405 UNSUPPORTED`.

### Base URL

`http://127.0.0.1:<PORT>` (default: `4200`)

### Endpoints

| Method | Route                                                | Description                                           | Auth Required |
| :----- | :--------------------------------------------------- | :---------------------------------------------------- | :------------ |
| `GET`  | `/health`                                            | Server status and vault identity                      | No            |
| `GET`  | `/api/v1/workspace`                                  | Workspace metadata, note counts, and capabilities     | Yes           |
| `GET`  | `/api/v1/entries?path=`                              | List files and directories at path                    | Yes           |
| `GET`  | `/api/v1/notes/:path`                                | Read note metadata, headings, wikilinks, and raw body | Yes           |
| `GET`  | `/api/v1/search?q=&tags=&pathPrefix=&limit=&offset=` | Search notes with lexical query and optional filters  | Yes           |
| `GET`  | `/api/v1/notes/:path/backlinks`                      | Retrieve incoming backlinks referencing the note      | Yes           |
| `GET`  | `/api/v1/notes/:path/links`                          | Retrieve outgoing wikilinks and resolution targets    | Yes           |
| `GET`  | `/api/v1/notes/:path/properties`                     | Retrieve YAML frontmatter properties                  | Yes           |
| `GET`  | `/api/v1/notes/:path/graph-neighbors`                | Retrieve local 1-hop graph structure                  | Yes           |

---

## 5. Authentication & Capability Model

### Bearer Token Authentication

When a token is configured or generated on startup, all `/api/v1/*` endpoints require authentication via:

- `Authorization: Bearer <TOKEN>`
- or `X-OpenOb-Token: <TOKEN>`

Requests without valid credentials receive `401 UNAUTHORIZED`.

### Capability Scopes (Phase 1 vs Future)

- **Phase 1 Active Scopes:**
  - `workspace.read` — View workspace metadata, list entries, read notes, inspect links & properties.
  - `workspace.search` — Execute full-text and tag queries across the index.
- **Phase 2 Reserved Scopes:**
  - `workspace.write` — Create and update notes via SafeWriter OCC.
  - `workspace.rename` — Safely rename notes with vault-wide link refactoring.
  - `workspace.delete` — Safely delete notes with coordinator sequencing.
  - `properties.write` — Mutate frontmatter properties.
  - `admin` — Rebuild derived indexes and manage capabilities.

### Client Identity Context

Callers can supply an optional client identifier:

- `X-OpenOb-Client-Id: <client-id>` (e.g. `claude-code`, `reasonix-agent`, `hermes`)
- `X-Request-Id: <uuid>`

---

## 6. Model Context Protocol (MCP) Adapter

`@okw/workspace` provides protocol-neutral tool definitions and dispatchers for the Model Context Protocol:

- `openob_workspace_info`: Retrieve workspace status and note count.
- `openob_list_entries`: List files and subfolders.
- `openob_read_note`: Read full note with metadata.
- `openob_search`: Query documents by keyword or tag.
- `openob_get_backlinks`: Retrieve incoming backlinks.
- `openob_get_properties`: Retrieve structured YAML properties.

The MCP layer is a thin adapter over `OpenObWorkspace` and contains zero independent storage or index logic.

---

## 7. Local CLI Tool

The `@okw/gateway` package includes a minimal read-only CLI:

```bash
openob info [--json]
openob list [subpath] [--json]
openob read <path> [--json]
openob search <query> [--json]
openob backlinks <path> [--json]
```

---

## 8. Separation from `sumo-sized-api`

> [!IMPORTANT]
> `sumo-sized-api` is a separate external FastAPI telemetry service repository.
> **`sumo-sized-api` is NOT the OpenOb gateway.**
> The OpenOb gateway is a pure TypeScript/Node.js local-first application within the OpenOb repository providing direct application-service access to OpenOb vaults.
