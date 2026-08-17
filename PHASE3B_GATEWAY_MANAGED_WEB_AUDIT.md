# PHASE3B_GATEWAY_MANAGED_WEB_AUDIT.md

Adversarial audit of Gateway-Managed Web Mode at HEAD `43b74873bcc02a9bbf1c48078729c462cf942e00` (`feat(web,gateway): implement Phase 3B gateway-managed web mode with unified authority`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean (deliverables + pre-existing `reasonix.toml`).

## 1. Baseline

| Step                                                                                | Result                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact SHA                                                                           | `43b74873bcc02a9bbf1c48078729c462cf942e00` (on origin/main, no commits after)                                                                                                                                                                                                                                 |
| Clean (`rm -rf apps/gateway/dist packages/*/dist` + `npm ci` + `npm run typecheck`) | **PASS**                                                                                                                                                                                                                                                                                                      |
| `npm test`                                                                          | **PASS** — 53 files / **278 tests**                                                                                                                                                                                                                                                                           |
| `npm run verify:full`                                                               | **FAILS at format:check** — `prettier --check` flags **2 committed markdown docs** (`EXTERNAL_ACCESS.md`, `PHASE3B_GATEWAY_MANAGED_WEB_REPORT.md`). Lint (0 errors), typecheck, unit tests (278), build, and e2e (**15/15**) all pass. The repo's own gate is red at HEAD until the two docs are reformatted. |
| Remote CI                                                                           | **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` 404 for the SHA (private repo); reported as unverified, not non-existent                                                                                                                                                                      |

## 2. Dual authority (the crux) — **PASS**

**Static**: `packages/workspace/src/backend.ts` — `GatewayWorkspaceBackend` (119-186) delegates 1:1 to `OpenObGatewayClient`; the client (client.ts) is a pure `fetch` REST client (`Authorization: Bearer`, `/api/v1/*`). The gateway backend imports nothing but `@okw/core` types, DTO types, and the client — **no** `BrowserFSAVaultStorage`/`NodeFsVaultStorage`/`MemoryVaultStorage`/`NoteWriteCoordinator`/`SafeWriter`/`DocumentIndex`/OPFS. In `apps/web/src/hooks/useVault.ts`, every one of the 15 `vaultMode === 'gateway'` branches (save/create/rename/delete/setProperty/refresh/open/search/backlinks/properties) calls only `backendRef.current.*` (REST); the coordinator listener is hard-gated off (line 302); the browser `MemoryDocumentIndex` is never queried in gateway mode. The shared bundle also contains the local machinery (co-located `LocalWorkspaceBackend`), but no gateway-mode path references it.

**Runtime** (real production `openob-gateway --serve-web` + real Chromium, instrumented page with `navigator.storage.getDirectory`/`showDirectoryPicker`/`localStorage.setItem` guards): full UI mutation surface (open → edit → save → search → properties → rename → delete) recorded **zero** OPFS/FSA/picker invocations, **zero** unexpected storage keys, and every API request was same-origin `/api/v1/*`. The UI edit landed on native disk **through the gateway only**.

## 3. Mode fallback attack — **PASS** (no FSA fallback; one P2 label issue, see §14 P2-1)

Real gateway process **killed (SIGKILL, confirmed dead)** while the editor held unsaved content:

- Editor content **preserved**.
- Save attempt → status **not** "Saved" (shows "External Conflict!" — a truthful _error_ state, never a save lie; see P2-1 for the label).
- Mode badge remains "Gateway:" — **no fallback to FSA/OPFS, no new local vault authority created**; no local write hit disk.
- **Restart on the same port → controlled recovery**: save succeeds, unsaved content lands on disk.

Manual Disconnect (user action) switches to an ephemeral in-memory vault after **discarding all buffers** — see P2-2.

## 4. Human vs agent OCC — **PASS (20/20)**

Real Chromium + real gateway + **real `openob-mcp`** (official SDK client): 20 iterations of browser-opens-V1 → MCP updates to V2 → browser stale-saves → **409 conflict modal**, **agent V2 byte-exact on disk**, **human buffer preserved**, no hidden retry, no forced overwrite; "Reload from Disk" loads V2.

## 5. Delete resurrection — **PASS**

Browser opens note V1 → real MCP deletes it → browser stale-save → conflict status → **file remains absent** (no create-fallback, no auto-retry-as-create, no resurrection).

## 6. Rename ghost — **PASS**

Browser opens B.md V1 → real MCP renames B→C → browser stale-save at B.md → conflict; **B.md absent, C.md canonical** with content, no ghost/duplicate.

## 7. Property OCC — **PASS (both directions)**

Stale property mutation vs agent body update → **409**; stale body update vs agent property update → **409**; no body/property loss either way (agent content intact on disk, no partial write).

## 8. Web rename/delete — **PASS**

Through the real file-tree UI: rename (inline input) and delete (button) execute **via REST only**, expectedVersion comes from the tab snapshot (mandatory at API level — invalid/missing → 409, verified), filesystem verified (old gone / new present / deleted gone), and **backlink rewriting is server-owned** (Linker.md `[[GNote]]` → `[[GNoteRenamed]]` after UI rename).

## 9. Read-only mode — **PASS**

Default (read-only) gateway: UI save fails (no "Saved", no disk change); **forged direct browser fetches** — create/rename/property → **403**, read → 200; nothing written.

## 10. Auth / token safety — **PASS**

Runtime scan after connect + mutations: token **absent from** DOM text, `location.href/search/hash`, console messages, and all network request URLs; sent exclusively as the `Authorization: Bearer` header. Token persists in `sessionStorage` (session mechanism — survives tab refresh, cleared on Disconnect and browser-session end); never in `localStorage`. The gateway **always has a token** (random 64-hex generated and logged to stderr if none provided) — so the loopback API is never unauthenticated.

## 11. Same-origin serving — **PASS**

Real `openob-gateway <vault> --serve-web --web-dist apps/web/dist`: page + all app assets + all API calls served from the same loopback origin (`http://127.0.0.1:<port>`); zero cross-origin (non-font) requests; `index.html` has no absolute/CORS-host asset URLs. No wildcard-CORS _requirement_ (API works same-origin; the server's origin-echoing CORS is only needed for the vite-dev cross-origin case — harmless, see P3). **API-only mode** (no `--serve-web`) still serves REST correctly; `GET /` on API-only mode is token-gated (401) rather than serving the SPA.

## 12. Index authority — **PASS**

In gateway mode, search / backlinks / properties / graph all derive from the **gateway API** (`backend.search`, `backend.getBacklinks`, `getProperties`); the browser-owned `MemoryDocumentIndex` is instantiated only in local mode and is never queried in gateway branches. No separate browser-owned canonical search index exists in gateway mode.

## 13. Agent changes visible — **PASS**

CLI/MCP-created/renamed/deleted notes appear in the browser after refresh/re-query (verified in §5/§6/§16 flows: MCP create → browser reload → tree shows the note). No stale browser-owned index overrides results.

## 14. Error semantics — **PARTIAL (P2-1)**

- Truthful at the API: 401 (bad token → connect-modal error alert), 403 (read-only mutations), 404 (missing note), 409 (stale writes), 413 (oversized body → no file), network failure (no write).
- **P2-1 — UI collapses all gateway errors to "External Conflict!"** (`useVault.ts:717`: `if (err instanceof GatewayError || err.status === 409 || ...)` matches every gateway HTTP error, so the dedicated `403` (read-only alert) and `404` branches are unreachable for gateway errors). Runtime-verified: a **403** read-only save and a **dead-gateway network failure** both render "External Conflict!" + the conflict modal instead of a read-only/disconnected message. No data loss, but item 14's "UI preserves truthful distinction" is not met.
- Degraded-index errors from the gateway also surface via the same collapsed path.

## 15. Backend isolation — **PASS**

`GatewayWorkspaceBackend` depends only on `OpenObGatewayClient` + DTO/`@okw/core` types; the client is pure `fetch`. The gateway backend does **not** import local storage implementations (`@okv/vault` storage classes, coordinator, safe writer, index). Local machinery exists only behind `LocalWorkspaceBackend` (local mode) — verified by exhaustive import listing.

## 16. Real full flow — **PASS**

Real production artifacts (esbuild-isolated `openob-gateway` + `openob-mcp` + `apps/web/dist` served by the gateway) + real Chromium: web create → MCP read → web update → MCP property update → web conflict (409) → web rename (backlinks rewritten server-side) → MCP read of renamed note → MCP delete → web refresh; **native filesystem verified after every step**.

## 17. Standalone regression — **PASS**

All old local-mode browser tests remain green (9 standalone e2e among the 15 total): FSA/OPFS, autosave, discard, conflict, local rename/delete, AI, search/backlinks. Unit suite 278 green.

## 18. Security edge cases — **PASS**

From the browser client: path traversal (`../../Outside.md`) → **400/404**, no file outside vault; invalid/garbage expectedVersion → **409**, no clobber; forged `scopes` in request bodies → ignored (OCC still gates); malformed REST JSON → **400**; oversized body → **413**, no file. The browser gains no power beyond the gateway API.

## 19. Severity

**P0: none. P1: none.**

**P2-1 — Gateway error semantics collapse in the web save path.** Every gateway HTTP error (401/403/413/503/network) is rendered as "External Conflict!" because `err instanceof GatewayError` short-circuits before the 403/404 branches (useVault.ts:717+). Runtime-confirmed for 403 and dead-gateway cases. Fix: inspect `err.status`/`err.code` first and map 401→auth error, 403→read-only alert, 404→missing note, 413→too large, network/5xx→"Disconnected", 409→conflict modal.

**P2-2 — Manual Disconnect silently discards unsaved buffers.** `disconnectGateway` (useVault.ts:464-500) calls `setOpenTabs([])` unconditionally; dirty tabs are dropped with no confirmation. User-initiated and no durable corruption (buffers are ephemeral React state; disk untouched), but unsaved human edits are silently lost. Committed e2e test 6 only asserts the status bar, not buffer preservation.

**P2-3 — No gateway health indicator.** After the gateway dies, the status bar continues to display "Gateway: <name>" with the Server icon; there is no connectivity watchdog/polling. The failure is only discovered on the next save (then mislabeled per P2-1). Item 3's "UI says disconnected" is therefore only partially met (it says _something_ error-like, never "Saved").

**P3 —** (a) Google Fonts third-party dependency in `index.html` (cosmetic, https, has fallback; all app assets/API same-origin); (b) server CORS echoes the request origin with `Access-Control-Allow-Headers: *` — not exploitable because the gateway always runs with a token (random 64-hex if unset; an attacker site cannot read it cross-origin), but echoing `*` could be narrowed; (c) DEV/TEST-only window globals (`__vaultStorage`, `__BrowserFSAVaultStorage`, `__coordinator`, `__setStorageWriteDelay`) — absent from production builds; (d) the server index only reflects changes made **through the gateway** (external direct-filesystem writers are invisible until a gateway operation touches the file — consistent with the documented single-authority contract, not a regression).

## 20. Verdict

# **STOP — exact blockers**

The functional core is **proven**: exactly one vault authority in gateway mode (no FSA/OPFS/local-write reachable at runtime), no FSA fallback on gateway death, stale human/agent writes cannot overwrite each other (20/20), delete cannot resurrect, rename cannot create ghosts, property OCC exact-one-winner, browser token handling safe (headers only), real gateway-served browser works same-origin, CLI/MCP/browser share canonical state, standalone mode green, security edges gated.

But the audit's own gates are not fully green at HEAD:

1. **`verify:full` fails at HEAD** — `prettier --check` flags two committed docs (`EXTERNAL_ACCESS.md`, `PHASE3B_GATEWAY_MANAGED_WEB_REPORT.md`). Trivial fix (reformat), required for the gate.
2. **P2-1** — web save path collapses 401/403/413/503/network into "External Conflict!" (error-semantics truthfulness).
3. **P2-2** — manual Disconnect silently discards unsaved buffers.
4. **P2-3** — no disconnected/health indicator after gateway death.

No P0/P1; none of the blockers corrupts data or breaks the single-authority topology. Remediation tasks in `GEMINI_PHASE3B_REMEDIATION.md`. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**
