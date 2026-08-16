# GEMINI_EXTERNAL_ACCESS_PHASE1_REMEDIATION.md

Handoff from `EXTERNAL_ACCESS_PHASE1_AUDIT.md` (HEAD `54cf1bef1e782482c8c1b82e6007f3542db8307a`). **Only unresolved work.** The Phase 1 boundary itself (OpenObWorkspace + read-only gateway + MCP/CLI adapters) is verified solid: no P0/P1, byte-identical vault under the adversarial matrix, zero traversal escapes, real auth, truthful single-authority docs. Two P2s and four P3s below. Correctness/security first.

---

## E1 — Error responses leak absolute filesystem paths via raw message passthrough

- **ID:** E1
- **Severity:** P2 (implementation-sensitive path disclosure on loopback; violates the no-leak error contract)
- **Scope:** SHARED (`packages/workspace/src/errors.ts`; message construction in `packages/vault/src/node-fs-storage.ts`)
- **Problem:** `toApiError` maps `StorageError` → `500 STORAGE_ERROR` and unknown errors → `500 INTERNAL_ERROR` passing `err.message` verbatim. `NodeFsVaultStorage` wraps fs errors as `StorageError("Failed to read \"<path>\": <fs err.message>")`, and fs error messages embed the absolute path (`EACCES: permission denied, open 'C:\...\Welcome.md'`). Any storage read failure therefore returns the vault's absolute path to the caller. Parser/index failures leak raw messages the same way.
- **Empirical evidence:** temp probe (removed), injected EACCES-style read error: HTTP response body contained `"Failed to read \"Welcome.md\": EACCES: permission denied, open 'C:\Users\...\ext-phase1-...\Welcome.md'"` — JSON-unescaped check `absolute path leaked: true`. Parser failure returned `INTERNAL_ERROR` with raw `boom in parser at D:\vault\x.md:3`.
- **Exact reproduction:** start gateway over a Node vault; cause a storage read failure (e.g. permission-denied file, or any read that raises a non-NotFound fs error); `GET /api/v1/notes/<path>` → 500 with the absolute path in `message`. (The EISDIR directory-read case happens not to include the path in the message on this Node build, but EACCES/ENOENT formats do.)
- **Root cause:** `errors.ts` passes `err.message` (and the raw message fallback for unknown errors) into the DTO; storage-layer messages embed absolute paths by construction.
- **Affected files:** `packages/workspace/src/errors.ts`, optionally `packages/vault/src/node-fs-storage.ts` (redact at source).
- **Required change:** redact implementation details from external messages: (a) in `toApiError`, replace `err.message` for `StorageError` with a stable `STORAGE_ERROR` message (`err.path`/`fallbackPath` already carry the vault-relative path; absolute paths must never appear); (b) for the unknown-error fallback, return a generic message (`"An internal error occurred"` + error `code`), logging the real message server-side; (c) optionally strip `, open '<abs path>'` style suffixes at the storage layer so internal logs are also clean. Keep vault-relative `path` in the DTO — that is intended.
- **Required regression test:** permanent gateway test that forces a storage read failure with an absolute path in the fs message and asserts the response body contains neither the absolute path nor its JSON-escaped form; a parser-failure test asserting no raw message/stack leakage; existing error-code tests stay green.
- **Acceptance criteria:** no error response from any Phase 1 endpoint contains an absolute filesystem path or an unredacted internal error message; codes remain stable (`STORAGE_ERROR`/`INTERNAL_ERROR`); the real message is available in logs only.
- **Dependencies:** none.
- **What NOT to do:** do not leak the path via `details`; do not return 200 for failures; do not put the absolute path in any DTO field; do not log the token.

---

## E2 — Gateway and CLI are library-only: no runnable process, lifecycle config untestable

- **ID:** E2
- **Severity:** P2 (deliverable packaging gap; report overstates "a local gateway HTTP process")
- **Scope:** `apps/gateway`
- **Problem:** `apps/gateway` exports `createGatewayServer`/`startGateway`/`runCli` but has no `bin` and no launcher wiring `NodeFsVaultStorage` + `rebuildVaultIndex` + token + server. Users cannot actually run the gateway or CLI; "invalid vault configuration rejected" and "inaccessible vault rejected" are untestable end-to-end; the report's claim of a shipped "gateway HTTP process" is not yet true.
- **Empirical evidence:** grep: no `bin` in `apps/gateway/package.json`, no launcher module; `main` re-exports `server.js`/`cli.js` only. All lifecycle tests had to construct the wiring manually in the audit probes.
- **Exact reproduction:** `npm run dev` in the repo starts the web app only; there is no command that starts the gateway.
- **Root cause:** Phase 1 delivered the boundary library but not the process wrapper.
- **Affected files:** `apps/gateway` (new `src/main.ts` launcher, `package.json` `bin` + scripts), root `package.json` script.
- **Required change:** add a small launcher (`openob-gateway` bin): resolve vault root (CLI arg or env), construct `NodeFsVaultStorage`, `MemoryDocumentIndex`/`SqliteDocumentIndex`, run `rebuildVaultIndex` once, build `OpenObWorkspace` (readOnly true), generate or read a token (env `OPENOB_TOKEN` or random printed once to stderr), call `startGateway`, handle SIGINT/SIGTERM clean shutdown. Reject invalid/inaccessible vault roots with a clear message and nonzero exit before binding. Add a `openob` bin for the CLI. Update `EXTERNAL_ACCESS_PHASE1_REPORT.md` to describe what is actually shipped.
- **Required regression test:** real-process tests: spawn the bin against a temp vault (health OK, workspace OK with token, 401 without), invalid vault path → nonzero exit + clear error, occupied port → `EADDRINUSE` + nonzero exit, SIGTERM → clean exit and no junk left.
- **Acceptance criteria:** `npx openob-gateway <vault>` starts a loopback read-only gateway with token auth and rebuilds the index once at startup; `npx openob ...` runs the CLI; all failure modes exit nonzero with useful messages.
- **Dependencies:** none (Phase 2 mutation endpoints will build on this process).
- **What NOT to do:** do not ship a daemon/PM2-style supervisor; do not auto-generate tokens into files the web bundle can read; do not bind to anything but loopback.

---

## E3 — MCP runtime deferral not stated explicitly in docs

- **ID:** E3
- **Severity:** P3 (documentation precision)
- **Scope:** docs (`EXTERNAL_ACCESS.md`)
- **Problem:** §6 lists MCP tools without stating that only protocol-neutral declarations + an in-process dispatcher ship in Phase 1 and that the transport/server runtime is deferred to a later phase; a reader could assume tools are servable today.
- **Evidence:** `mcp.ts` contains definitions + `handleMcpToolCall`; no stdio/SSE server exists anywhere.
- **Required change:** one explicit sentence: "Phase 1 ships the MCP tool declarations and dispatcher only; the MCP server transport (stdio/SSE) is deferred." Keep the truthful thin-adapter claim.
- **What NOT to do:** do not add a half-baked transport in Phase 2 planning; do not claim tools are live.

---

## E4 — REST subaction suffix shadowing for notes named like subactions

- **ID:** E4
- **Severity:** P3 (protocol polish)
- **Scope:** `apps/gateway/src/server.ts`
- **Problem:** `/api/v1/notes/<path>/backlinks|links|properties|graph-neighbors` suffix matching means a note whose filename is exactly one of those names in a subfolder (e.g. `Sub/backlinks`) cannot be read through REST — the subaction route wins.
- **Evidence:** route logic at `server.ts` (`decodedSegment.endsWith('/backlinks')` etc.) applied before the default note read.
- **Required change:** resolve the note path first and only treat the suffix as a subaction when the remainder is an existing file (e.g. try `workspace.getNoteMetadata(remainder)`; if found, serve the note; else treat as subaction). Document the disambiguation rule.
- **Required regression test:** vault with `Sub/backlinks.md`; assert `GET /api/v1/notes/Sub/backlinks` returns the note and `GET /api/v1/notes/Welcome.md/backlinks` still returns backlinks.
- **What NOT to do:** do not reorder routes in a way that breaks the documented subaction contract; do not require a trailing-slash convention.

---

## E5 — Minor protocol/doc polish (optional, non-blocking)

- **ID:** E5
- **Severity:** P3
- **Scope:** `apps/gateway/src/server.ts`, docs
- **Items:** (a) `/health` returns the vault name — document it as intended identity or drop the field; (b) token comparison is a plain string `!==` — note it is loopback-adequate, or use `crypto.timingSafeEqual` for hygiene; (c) `EXTERNAL_ACCESS.md` should state that tokenless mode trusts any loopback caller; (d) CLI should document `stdout` vs `stderr` conventions for agents (currently `runCli` returns `{exitCode, output}`).
- **What NOT to do:** do not add CORS as a "security" measure; do not bind non-loopback for convenience.

---

## Execution order

1. **E1** (error redaction) — before any Phase 2 mutation work; cheap and shrinks the leak surface.
2. **E2** (runnable gateway/CLI) — at the start of Phase 2 so mutation endpoints are testable end-to-end.
3. **E3, E4** (doc precision + route disambiguation) — with Phase 2 planning.
4. **E5** (polish) — opportunistic.

Phase 2 gate per the audit: **PROCEED** — no P0/P1, boundary proven, read-only proof stands, traversal blocked, auth real, loopback default, index reuse correct, single-authority docs truthful, CI green. E1 should land first (recommended, not a gate-blocker); E2 is required for Phase 2 to be verifiable end-to-end. P2/P3 do not undermine the boundary.
