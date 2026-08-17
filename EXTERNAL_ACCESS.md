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
| `workspace.rename` | Rename notes and update inbound wikilinks across vault                                  | Phase 2B |
| `workspace.delete` | Delete notes from vault                                                                 | Phase 2B |

### Default Safe Configuration

When started normally without explicit flags, the gateway defaults to **read-only**:

```bash
npx openob-gateway /path/to/vault
# Scopes: [workspace.read, workspace.search]
```

To enable mutation capabilities, explicit `--scopes` must be supplied:

```bash
npx openob-gateway /path/to/vault --scopes workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete
# Or via environment variable:
# OPENOB_SCOPES=workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete
```

---

## 5. REST API Reference

All endpoints bind strictly to loopback (`127.0.0.1`).

### Base URL

`http://127.0.0.1:<PORT>` (default: `4200`)

### Endpoints

| Method   | Route                                                | Description                                                      | Required Scope     | Auth Required |
| :------- | :--------------------------------------------------- | :--------------------------------------------------------------- | :----------------- | :------------ |
| `GET`    | `/health`                                            | Server status, vault name, readOnly status                       | None               | No            |
| `GET`    | `/api/v1/workspace`                                  | Workspace metadata, capabilities, and index health               | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/entries?path=`                              | List files and directories at subpath                            | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/notes/:path`                                | Read note metadata, headings, wikilinks, properties, raw body    | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/search?q=&tags=&pathPrefix=&limit=&offset=` | Search notes with lexical query and optional filters             | `workspace.search` | Yes           |
| `GET`    | `/api/v1/notes/:path/backlinks`                      | Retrieve incoming backlinks referencing the note                 | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/notes/:path/links`                          | Retrieve outgoing wikilinks and resolution targets               | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/notes/:path/properties`                     | Retrieve YAML frontmatter properties                             | `workspace.read`   | Yes           |
| `GET`    | `/api/v1/notes/:path/graph-neighbors`                | Retrieve local 1-hop graph structure                             | `workspace.read`   | Yes           |
| `POST`   | `/api/v1/notes`                                      | Create a new note (fails if note exists; expectedVersion=null)   | `workspace.write`  | Yes           |
| `PUT`    | `/api/v1/notes/:path`                                | Update note body content with optimistic concurrency control     | `workspace.write`  | Yes           |
| `PATCH`  | `/api/v1/notes/:path/properties`                     | Set or remove a frontmatter property with optimistic concurrency | `properties.write` | Yes           |
| `POST`   | `/api/v1/notes/:path/rename`                         | Rename note and refactor inbound wikilinks with expectedVersion  | `workspace.rename` | Yes           |
| `DELETE` | `/api/v1/notes/:path`                                | Delete note with optimistic concurrency expectedVersion          | `workspace.delete` | Yes           |

### Error Status Codes & Limits

- **Body Size Limit (`maxBodyBytes`):** 10 MB default limit. Payloads exceeding this limit receive HTTP `413 PAYLOAD_TOO_LARGE` without TCP connection reset.
- **Path Normalization:** Vault paths with leading slashes (e.g. `/Notes/Doc.md`) are normalized to vault-relative paths (`Notes/Doc.md`). Traversal sequences (`../`), drive letters, and UNC paths are strictly rejected with `400 INVALID_PATH`.

| Status Code | Error Code                         | Description                                                   |
| :---------- | :--------------------------------- | :------------------------------------------------------------ |
| `400`       | `INVALID_REQUEST` / `INVALID_PATH` | Malformed JSON, missing fields, or invalid/traversal path     |
| `401`       | `UNAUTHORIZED`                     | Missing or invalid bearer authorization token                 |
| `403`       | `FORBIDDEN`                        | Gateway started without required capability scope             |
| `404`       | `NOT_FOUND`                        | Target note file does not exist                               |
| `405`       | `UNSUPPORTED`                      | HTTP method not supported in gateway mode                     |
| `409`       | `CONFLICT` / `INDEX_DEGRADED`      | Optimistic concurrency mismatch, target exists, or index down |
| `413`       | `PAYLOAD_TOO_LARGE`                | Request payload exceeds maximum body size limit               |
| `500`       | `INTERNAL_ERROR`                   | Unexpected internal runtime exception                         |

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

# Mutation operations (requires running gateway with write/rename/delete scopes)
openob create Notes/NewNote.md --content "Hello World" --json
cat content.md | openob update Notes/NewNote.md --expected-version <token> --stdin --json
openob set-property Notes/NewNote.md status "published" --expected-version <token> --json
openob rename Notes/NewNote.md Notes/RenamedNote.md --expected-version <token> --json
openob delete Notes/RenamedNote.md --expected-version <token> --json
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
| `openob_rename_note`    | Rename note and refactor wikilinks with OCC | `workspace.rename` |
| `openob_delete_note`    | Delete note with expectedVersion OCC        | `workspace.delete` |

---

## 8. Live MCP Stdio Server (`openob-mcp`)

The `openob-mcp` binary is a production Model Context Protocol (MCP) server that communicates over standard input/output (`stdio`) using the official TypeScript MCP SDK (`@modelcontextprotocol/server`).

### Single Authority Invariant

`openob-mcp` holds **no direct storage or index access**. It communicates strictly over HTTP loopback to the running OpenOb Gateway REST API:

```text
[External AI Agent / IDE]
          │ (stdio JSON-RPC)
          ▼
    [openob-mcp]
          │ (REST HTTP loopback /api/v1)
          ▼
   [OpenOb Gateway]
          │
          ▼
  [OpenObWorkspace]
```

### Usage & Configuration

```bash
# Start MCP server targeting running gateway
npx openob-mcp --url http://127.0.0.1:4512 --token <token>

# Or configure via environment variables:
export OPENOB_URL=http://127.0.0.1:4512
export OPENOB_TOKEN=<token>
export OPENOB_CLIENT_ID=claude-desktop
npx openob-mcp
```

### Example Claude Desktop Configuration (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "openob": {
      "command": "node",
      "args": [
        "/path/to/OpenOb/apps/gateway/dist/bin/mcp.js",
        "--url",
        "http://127.0.0.1:4512",
        "--token",
        "your-gateway-token"
      ]
    }
  }
}
```

---

## 9. Gateway-Managed Web Mode (Phase 3B)

OpenOb supports two distinct web operating modes with strict mutual exclusivity:

### 1. Standalone Local Web Mode

- Browser owns the vault through the File System Access API (`BrowserFSAVaultStorage`) or in-memory vault.
- `NoteWriteCoordinator`, `SafeWriter`, and local `DocumentIndex` run in the browser tab.

### 2. Gateway-Managed Web Mode

- The browser **never owns or directly touches the vault filesystem**.
- The React Web UI connects over HTTP loopback exclusively to the running OpenOb Gateway REST API via `OpenObGatewayClient` wrapped in `GatewayWorkspaceBackend`.
- **One Brain, Multiple Doors:** External AI agents (MCP), CLI commands, and the human Web UI all mutate through the exact same running `OpenObWorkspace`.
- **Strict Mode Exclusivity:** In Gateway-Managed Mode, `BrowserFSAVaultStorage`, OPFS vault authority, `NoteWriteCoordinator`, `SafeWriter`, and local `DocumentIndex` are **not** instantiated or used for canonical access.
- **OCC Human-Agent Protection:** When an external MCP agent updates a note (e.g. V1 -> V2) while a human has unsaved edits in the browser, the human's subsequent save attempt returns `409 Conflict`. The UI preserves the human's buffer, displays the conflict modal with disk vs local content, and prevents overwriting the agent's V2 update.
- **Static Web Delivery:** The Gateway binary supports `--serve-web` and `--web-dist <dir>` to serve the production Web UI SPA directly from the local gateway process with single-page app fallback.

---

## 10. Live Gateway Change Stream (Phase 3C)

To allow the human Web UI to reflect agent and CLI mutations immediately without manual polling or refresh, OpenOb provides a real-time server-sent change stream.

### Architecture

```text
Web / CLI / MCP
       ↓
    Gateway
       ↓
 OpenObWorkspace
       ↓
Canonical Mutation
       ↓
WorkspaceChangeEvent
       ↓
SSE: GET /api/v1/events (Bearer auth)
       ↓
Gateway-Managed Web UI (streaming fetch)
```

### Protocol & Guarantees

1. **Application-Level Event Authority:** Emitted exclusively by `OpenObWorkspace` after durable canonical write and index synchronization have succeeded.
2. **Instance-Aware Replay Cursor (`<serverInstanceId>:<sequence>`):**
   - The SSE stream `id:` header emits a deterministic, instance-aware cursor formatted as `<serverInstanceId>:<sequence>` (e.g. `550e8400-e29b-41d4-a716-446655440000:17`).
   - The semantic `eventId` (e.g. `evt_17_abc12345`) remains inside the event payload for audit/deduplication.
   - Clients send the cursor on reconnection via the standard `Last-Event-ID` header (or `?lastEventId=` query param).
3. **Reconnection & Safe Resynchronization:**
   - **Same Server Instance + Retained Sequence:** Missed events are replayed strictly in order (`{ reset: false, events: [...] }`).
   - **Same Server Instance + Expired Sequence:** When requested sequence has fallen outside the bounded ring buffer (1024 events), returns `event: stream.reset` with `reason: replay_window_expired`.
   - **Different Server Instance (Gateway Restart):** When client reconnects to a restarted gateway process with a different `serverInstanceId`, returns `event: stream.reset` with `reason: server_restarted`. The web client triggers a clean full vault refresh.
   - **Legacy Cursor Compatibility (`evt_<seq>_<rand>`):** Parsed safely. If unverified across process restarts, fails safe by emitting `event: stream.reset` (`server_restarted`).
4. **Bearer Token Safety:** The browser client uses streaming `fetch()` with the `Authorization: Bearer <token>` header, avoiding exposing credentials in URL query strings or browser access logs.
5. **Human Buffer Protection:**
   - **Clean Open Note:** Auto-updates immediately to authoritative latest V2 content.
   - **Dirty Open Note:** 100% preserves human buffer in editor, never auto-saves or auto-overwrites, surfaces conflict status, and preserves OCC 409 protection.
   - **External Delete / Rename:** Clean tabs are closed/migrated; dirty tabs preserve user content without ghost creation or resurrection.
   - **Index Degradation & Recovery:** Truthful `index.degraded` event is emitted if derived index upsert fails after canonical write commits, and `index.recovered` is emitted upon successful rebuild.
