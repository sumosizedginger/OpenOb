# OpenOb — External Mutations Phase 2A Engineering & Closure Report

**Execution Context:**

- **Repository:** `https://github.com/sumosizedginger/OpenOb`
- **Starting SHA:** `116c52d8c5e51b160060203d606148aa99ee32db`
- **Role:** Foreman / Lead Engineer (Gemini)
- **Status:** COMPLETED & VERIFIED

---

## 1. Executive Summary

Phase 2A introduces safe, authenticated external note mutations (`create`, `update`, `set-property`) into Open Knowledge Workspace through the single authoritative application service boundary: `OpenObWorkspace` (`@okw/workspace`).

All external adapters—including the REST Gateway (`apps/gateway`), local CLI (`openob`), and protocol-neutral MCP tool dispatchers—route strictly through `OpenObWorkspace`, preventing any direct filesystem or index bypass.

### Key Architectural Invariants Enforced:

1. **Single Application Boundary:** `VaultStorage`, `SafeWriter`, `NoteWriteCoordinator`, and `DocumentIndex` remain strictly private implementation details.
2. **Per-Path Mutex Serialization (`withPathLock`):** Competing concurrent mutation requests for the same note path are serialized before optimistic concurrency validation, guaranteeing that two simultaneous writers with the same stale version token cannot both succeed.
3. **Strict Optimistic Locking:** Update and property mutations require a valid `expectedVersion` token matching the on-disk state. Stale tokens immediately return `409 CONFLICT`.
4. **Canonical Truth & Truthful Degradation:** Canonical Markdown on disk is the source of truth. If index insertion fails after a durable disk write, the operation returns durable success with index status marked `degraded`.
5. **Real Capability Enforcement:** Scopes (`workspace.read`, `workspace.search`, `workspace.write`, `properties.write`) are granted exclusively by gateway server configuration / admin flags (`--scopes`, `OPENOB_SCOPES`). Default gateway startup remains strictly read-only.
6. **Structured Audit Trail:** Every mutation attempt records structured audit metadata (`timestamp`, `requestId`, `clientId`, `operation`, `path`, `success`, `versions`, `grantedScope`, `indexStatus`) without logging note bodies, tokens, or secrets.

---

## 2. Implemented Components & Public Contracts

### A. Workspace Mutation Methods (`@okw/workspace`)

```typescript
export class OpenObWorkspace {
  createNote(request: CreateNoteRequest, context?: ClientContext): Promise<MutationResultDTO>;
  updateNote(request: UpdateNoteRequest, context?: ClientContext): Promise<MutationResultDTO>;
  setProperty(request: SetPropertyRequest, context?: ClientContext): Promise<MutationResultDTO>;
}
```

- `createNote`: Rejects traversal and existing notes (`expectedVersion=null` semantics). Persists via `SafeWriter`, parses markdown, updates index, and emits audit event.
- `updateNote`: Requires `expectedVersion`. Checks on-disk version inside per-path lock. Disallows force overwriting. Returns `409 Conflict` on stale version.
- `setProperty`: Modifies frontmatter properties using `@okw/markdown` `updateDocumentFrontmatter`, preserving comments, untouched keys, EOLs, and BOM.

### B. REST Gateway Endpoints (`apps/gateway`)

| Method  | Route                            | Description         | Required Scope     | Status Code   |
| :------ | :------------------------------- | :------------------ | :----------------- | :------------ |
| `POST`  | `/api/v1/notes`                  | Create a new note   | `workspace.write`  | `201 Created` |
| `PUT`   | `/api/v1/notes/:path`            | Update note body    | `workspace.write`  | `200 OK`      |
| `PATCH` | `/api/v1/notes/:path/properties` | Set/remove property | `properties.write` | `200 OK`      |

- Enforces `10MB` default request body limit (`maxBodyBytes`).
- Returns structured JSON errors: `400 INVALID_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `405 UNSUPPORTED`.

### C. REST-Only CLI Commands (`openob`)

```bash
# Create
openob create Notes/Meeting.md --content "Agenda items" --json

# Update with expected version
openob update Notes/Meeting.md --expected-version <token> --content "Updated agenda" --json
cat update.md | openob update Notes/Meeting.md --expected-version <token> --stdin --json

# Set property
openob set-property Notes/Meeting.md status "completed" --expected-version <token> --json
```

### D. Protocol-Neutral MCP Tools

- `openob_create_note`: Creates note with content and frontmatter properties.
- `openob_update_note`: Updates note content with `expectedVersion.token`.
- `openob_set_property`: Sets or deletes (`value=null`) property with `expectedVersion.token`.

---

## 3. Concurrency & Integrity Test Matrix

All required concurrency races and security properties are verified by permanent automated test suites:

| Suite / Test                      | Description                                                                                | Result   |
| :-------------------------------- | :----------------------------------------------------------------------------------------- | :------- |
| **Race A (Create Race)**          | 2 concurrent creates for same path -> exactly 1 succeeds, 1 receives ConflictError         | **PASS** |
| **Race B (Stale Update)**         | Read V1 -> Update V2 -> Second update with V1 receives 409 Conflict; V2 survives           | **PASS** |
| **Race C (Same-Version Update)**  | Agents A & B both start with V1 -> exactly 1 succeeds, 1 receives ConflictError            | **PASS** |
| **Race D (Independent Paths)**    | Concurrent writes to `PathA.md` and `PathB.md` both succeed concurrently                   | **PASS** |
| **Race E (Property / Body Race)** | Agent A updates property with V1, Agent B updates body with V1 -> 1 wins, 1 conflicts      | **PASS** |
| **Degradation F (Index Failure)** | Simulated index crash after durable disk write -> reports durable success + degraded index | **PASS** |
| **Security / Scopes**             | Default read-only token receives 403; forged scope headers ignored; client IDs validated   | **PASS** |
| **Security / Traversal**          | `../`, absolute, and Windows drive paths rejected on all mutation routes                   | **PASS** |
| **Process-Level Suite**           | Real compiled `gateway.js` and `cli.js` executed under plain Node.js across full lifecycle | **PASS** |

---

## 4. Verification & Quality Gates

| Quality Gate           | Status   | Output / Details                                          |
| :--------------------- | :------- | :-------------------------------------------------------- |
| `npm run format:check` | **PASS** | All matched files use Prettier code style                 |
| `npm run lint`         | **PASS** | 0 errors across monorepo                                  |
| `npm run typecheck`    | **PASS** | Clean build across all packages and apps                  |
| `npm test` (vitest)    | **PASS** | **50 test files / 243 unit & integration tests PASS**     |
| `npm run build`        | **PASS** | Gateway executables (`dist/bin`) and web app bundle built |
| `npm run test:e2e`     | **PASS** | **9/9 Playwright E2E browser tests PASS**                 |
| `npm run verify:full`  | **PASS** | Full verify + Playwright E2E suite                        |

---

## 5. Scope & Deferred Work (Phase 2B)

### Strictly Out of Scope in Phase 2A (Deferred to Phase 2B):

- Note rename endpoint (`POST /api/v1/notes/:path/rename`)
- Note delete endpoint (`DELETE /api/v1/notes/:path`)
- Live MCP WebSocket / stdio transport server
- React UI migration to `OpenObWorkspace`
- Multi-device synchronization / collaboration
