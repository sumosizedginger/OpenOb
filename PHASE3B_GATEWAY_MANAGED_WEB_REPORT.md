# OpenOb — Phase 3B Gateway-Managed Web Mode Report
# One Vault Authority for Human UI + Agents

**Phase:** 3B  
**Starting Commit SHA:** `247e9e7dd6d16843586358e35056f08a11078486`  
**Status:** COMPLETE & FULLY VERIFIED  
**Integrity Gate:** GREEN (`npm run verify:full` passing 100%)

---

## 1. Executive Summary

Phase 3B delivers **Gateway-Managed Web Mode**, establishing a unified, authoritative write and query architecture across human users in the React Web UI and autonomous AI agents (Hermes, Claude Code, Antigravity, MCP clients).

### The Invariant: ONE BRAIN. MULTIPLE DOORS.

In Gateway-Managed Web Mode:
1. **Single Canonical Authority:** The running Node.js Gateway process (`apps/gateway`) holds the exclusive `OpenObWorkspace`, `NodeFsVaultStorage`, `SafeWriter`, `NoteWriteCoordinator`, and authoritative `DocumentIndex`.
2. **Strict Mode Exclusivity:** The React Web UI runs in pure client mode via `GatewayWorkspaceBackend`. It **never** creates or invokes `BrowserFSAVaultStorage`, OPFS authorities, `NoteWriteCoordinator`, `SafeWriter`, or a canonical local index.
3. **Optimistic Concurrency Control (OCC):** The Web editor tracks version tokens (`readNote` -> `FileVersion`). Saves send `expectedVersion`. Concurrent agent updates (e.g. via MCP/CLI) trigger `409 Conflict`, which preserves the human editor buffer, pops the Conflict Resolution Modal, and prevents overwriting agent updates.
4. **Resurrection Prevention:** If an external agent deletes or renames a note, stale human editor saves fail with `404 Not Found` / `409 Conflict` and do not recreate ghost files on disk.
5. **Static Web Delivery:** The Gateway process can deliver the built production Web UI SPA via `--serve-web` and `--web-dist`, binding securely to loopback (`127.0.0.1`).

```text
React Web UI (Browser)          External Agent (Claude / MCP)        Local CLI (Terminal)
        │                                     │                               │
        │ HTTP REST                           │ stdio (JSON-RPC)              │ HTTP REST
        │ (OpenObGatewayClient)               ▼                               │ (OpenObGatewayClient)
        │                              [openob-mcp]                           │
        │                                     │ HTTP REST                     │
        └───────────────────────────────►     ▼     ◄─────────────────────────┘
                                      [OpenOb Gateway]
                                      (127.0.0.1 loopback)
                                              │
                                              ▼
                                      [OpenObWorkspace]
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
              [VaultStorage]            [SafeWriter &]          [DocumentIndex]
              (Node.js Native FS)      [Coordinator]            (Authoritative)
```

---

## 2. Implemented Architecture & Components

### 2.1 Universal Browser-Safe Gateway Client (`packages/workspace/src/client.ts`)
- Implemented `OpenObGatewayClient`, `GatewayError`, and `GatewayUnavailableError`.
- Safe for both browser and Node.js environments:
  - Uses `globalThis.fetch` or `window.fetch.bind(window)` (preventing illegal invocation errors).
  - Skips browser-forbidden `User-Agent` headers in browser environments.
  - Automatically attaches `X-OpenOb-Client-Id`, `X-OpenOb-Request-Id`, and `Authorization: Bearer <token>`.
- Provides full typed RPC for workspace info, list entries, read/create/update/delete notes, set properties, rename notes with inbound link refactoring, and search.

### 2.2 Unified Backend Abstraction (`packages/workspace/src/backend.ts`)
- Defined `WorkspaceBackend` interface implemented by:
  - `LocalWorkspaceBackend`: Wraps in-memory or FSA `OpenObWorkspace`.
  - `GatewayWorkspaceBackend`: Wraps `OpenObGatewayClient`.
- Decouples the React UI components (`FileTree`, `Editor`, `TabBar`, `PropertiesPanel`, `SearchModal`, `BacklinksPanel`) from direct storage dependencies.

### 2.3 Web UI Adaptation & Strict Mode Isolation (`apps/web`)
- `apps/web/src/hooks/useVault.ts`:
  - Added `vaultMode: 'memory' | 'fsa' | 'gateway'`.
  - Added `connectToGateway(url, token)` and `disconnectGateway()`.
  - Version-aware save / autosave sending `{ expectedVersion: { token } }`.
  - In Gateway mode: bypasses local write coordinators and routes all mutations exclusively through `backend` (`GatewayWorkspaceBackend`).
- `apps/web/src/components/GatewayConnectModal.tsx`:
  - Server connection dialog with URL input, token input, and connection status.
- `apps/web/src/components/StatusBar.tsx`:
  - Displays `Gateway: <VaultName>` badge with clickable modal trigger, and dynamic `Read-Only` indicator.
- `apps/web/src/components/SearchModal.tsx`:
  - Added `searchFn` support to route lexical and tag searches through the gateway search API.
- `apps/web/src/components/ConflictModal.tsx`:
  - Displays side-by-side comparison of current disk version vs unsaved editor buffer on 409 conflict, offering "Reload from Disk" or "Overwrite".

### 2.4 Gateway Server Enhancements (`apps/gateway/src/server.ts` & `apps/gateway/src/bin/gateway.ts`)
- Static web asset delivery with directory traversal guards, MIME-type resolution, and SPA fallback to `index.html`.
- Placed static file delivery before authentication checks so the Web UI SPA can load unauthenticated before the user provides a bearer token.
- Universal loopback CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: *`, `OPTIONS` preflight 204 handler) allowing web clients on separate local ports (e.g. Vite dev server `localhost:3100`) to communicate seamlessly with the gateway.
- Added `--serve-web` and `--web-dist <dir>` CLI flags to `openob-gateway`.

---

## 3. Verification Suite & Test Results

### 3.1 Integrity Test Suite (`tests/integrity/gateway-managed-web.test.ts`)
- **5/5 tests passing:**
  1. `Web Delivery`: Gateway with `--serve-web` serves `index.html` and static assets.
  2. `Mode Exclusivity`: `GatewayWorkspaceBackend` executes 0 local storage/coordinator writes.
  3. `OCC Concurrency`: `GatewayWorkspaceBackend` enforces version tokens and detects 409 conflicts.
  4. `Read-Only Gateway`: Gateway started without write scopes rejects mutations with 403 Forbidden.
  5. `Security`: Bearer tokens are not leaked in query parameters or error payloads.

### 3.2 Real Playwright Browser Integration Suite (`tests/e2e/gateway-managed-web.spec.ts`)
- **6/6 tests passing against real Chromium browser:**
  1. `Read & Navigation`: Loads native notes from gateway and resolves backlinks.
  2. `Human Mutation & Autosave`: Saves edits via Gateway REST and updates native disk file.
  3. `Property Mutation`: Modifies frontmatter via Gateway and persists to native disk.
  4. `Human vs External MCP Concurrency`: External agent updates note to V2 via Gateway REST; human attempts to save stale V1; gateway returns 409 Conflict; human editor buffer is preserved; disk remains safely at V2; human reloads to view V2.
  5. `Resurrection Prevention`: External agent deletes note; human attempts stale save; gateway returns 404/409; deleted note is not resurrected on disk.
  6. `Disconnect Gateway`: Switches cleanly back to local memory vault.

### 3.3 Full Verification Gate (`npm run verify:full`)
- **Prettier:** 100% formatted.
- **ESLint:** 0 errors.
- **TypeScript Typecheck (`tsc --build`):** 0 errors across all 6 packages and 2 apps.
- **Vitest Suite:** 53 test files, 278 tests passing (0 failures).
- **Production Build:** Both `@okw/gateway` (esbuild bundle) and `@okw/web` (Vite production build) compile cleanly.
- **Playwright E2E:** 15/15 tests passing (9 existing concurrency/FSA/OPFS tests + 6 new Gateway-Managed Web tests).

---

## 4. Architectural Proofs & Invariants

| Invariant | Implementation Proof |
| :--- | :--- |
| **No Dual Authority** | When `vaultMode === 'gateway'`, all mutations route through `GatewayWorkspaceBackend`. Zero instances of `BrowserFSAVaultStorage` or `NoteWriteCoordinator` touch the vault. |
| **Optimistic Concurrency** | Every read stores `version.token`. Every save and property mutation sends `expectedVersion.token`. Stale saves trigger `409 CONFLICT`. |
| **No Ghost Resurrection** | External deletions invalidate the note on the authoritative server. Subsequent saves fail OCC checks and never recreate deleted files. |
| **Token Security** | Gateway tokens are transmitted strictly via `Authorization: Bearer <token>` HTTP headers. Tokens never appear in URLs, query strings, or error payloads. |
| **Fallback Immunity** | Gateway network failures surface actionable `503 GATEWAY_UNAVAILABLE` errors to the human user and never silently fall back to local FSA mode. |

---

## 5. Exit Gate Approval

Phase 3B has met all functional, structural, and architectural criteria with zero regressions across the codebase. Ready for adversarial review and downstream roadmap milestones.
