# PHASE3A_LIVE_MCP_AUDIT.md

Adversarial audit of the Phase 3A live MCP stdio transport at HEAD `52b41ea66d3da2230b73cd971d20bb5bfe39e506` (`feat(mcp): implement Phase 3A live MCP stdio transport (openob-mcp)`). **AUDIT ONLY** — no production code modified; temporary probes (official SDK + raw stdio) removed afterward; working tree clean.

## 1. Baseline

| Step                                                                                | Result                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact HEAD                                                                          | `52b41ea66d3da2230b73cd971d20bb5bfe39e506` (on origin/main, no commits after)                                                                                                                     |
| Clean (`rm -rf apps/gateway/dist packages/*/dist` + `npm ci` + `npm run typecheck`) | **PASS**                                                                                                                                                                                          |
| `npm test`                                                                          | **PASS** — 52 files / **270 tests**                                                                                                                                                               |
| `npm run verify:full`                                                               | **PASS (exit 0)** — format/lint/typecheck/270 tests/build/**e2e 9/9**                                                                                                                             |
| Remote CI                                                                           | **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` returns 404 for the SHA and the private repo; environment cannot access GitHub Actions. Reported as unverified, not non-existent. |

## 2. Single authority — **PASS (no second vault authority)**

- `packages/workspace/src/mcp.ts` (tool declarations + in-process dispatcher): imports only `errors`, `types`, `workspace`; **zero** occurrences of `VaultStorage`, `NodeFsVaultStorage`, `SafeWriter`, `NoteWriteCoordinator`, `DocumentIndex`, `fs.writeFile`, `storage.write/remove`, `index.upsert/remove`.
- Live transport `apps/gateway/src/mcp-server.ts` + `apps/gateway/src/bin/mcp.ts`: `createOpenObMcpServer` holds **only** an `OpenObGatewayClient` (pure REST: `fetch` + `Authorization: Bearer`). Comment states the invariant: "The MCP server holds NO DIRECT VAULT STORAGE OR INDEX ACCESS."
- **Production bundle** (`build.js` esbuild output `bin/mcp.js`): grep for the seven authority symbols → **0 matches each**; 15 references to `OpenObGatewayClient`/`/api/v1`.
- Chain: `MCP tool → OpenObGatewayClient (REST) → OpenObGateway (scopes) → OpenObWorkspace → SafeWriter/storage/index`. No bypass found in source or bundle.

## 3. Real MCP protocol — **PASS**

Official SDK (`@modelcontextprotocol/client` 2.x + `StdioClientTransport`) against the **real built `openob-mcp` executable**:

- `connect()` → initialize handshake succeeds; `getServerCapabilities()` populated; server info `openob-mcp` v0.1.0.
- `listTools()` → exactly the 11 expected tools.
- `callTool` → real tool execution through the gateway.
- **stdout purity** (raw child, no SDK): every non-empty stdout line parses as JSON-RPC (`jsonrpc: 2.0`); no banners, no debug logs, no token. Startup diagnostics go to **stderr** only (`[openob-mcp] Starting stdio MCP server targeting gateway: ...`).
- **stderr injection**: the startup banner (and client-id) is emitted on stderr while the protocol continues to work — verified a tool call right after stderr output succeeds.

## 4. Tool coverage — **PASS (11/11)**

All tools exercised over real MCP; results match gateway behavior; canonical disk verified after each step:

`openob_workspace_info` (noteCount), `openob_list_entries` (`{path, entries}`), `openob_read_note` (V tokens), `openob_search` (`{query,total,matches,limit,offset}`), `openob_get_backlinks` (bare `BacklinkDTO[]`), `openob_get_properties` (`{path, properties}`), `openob_create_note` (frontmatter written), `openob_update_note` (content replaced, disk verified), `openob_set_property` (frontmatter updated, disk verified), `openob_rename_note` (old gone / new present), `openob_delete_note` (file gone; `Seed.md` byte-untouched).

## 5. Authorization — **PASS (gateway-owned)**

- Default read-only gateway: `create_note` → **403 FORBIDDEN** (`isError` tool result, no file created).
- Forged arguments (`scopes: ['workspace.write']` in tool args) → still **403** — scopes cannot be granted through MCP args.
- Write-only gateway (`workspace.write` without `rename`/`delete`/`properties`): create allowed; `rename_note` → 403, `delete_note` → 403, `set_property` → 403 (Phase 2 separation preserved through MCP).
- MCP process itself grants no permissions: it is a pure REST client of the gateway.

## 6. OCC / errors — **PASS**

- Stale `update_note` → **409**, stale `set_property` → **409**, stale `rename_note` → **409**, stale `delete_note` → **409** — each as `isError` tool results carrying `error.status: 409`; canonical file unchanged afterward (**no auto-retry, no force overwrite** — verified on disk).
- Wrong token → **401**; missing note → **404**; read-only mutation → **403**; malformed tool args (wrong types) → `isError` and the **server survives** (next call works); **gateway unavailable** → truthful **503 `GATEWAY_UNAVAILABLE`** `isError`, MCP server stays alive.
- Malformed raw stdio (garbage line + truncated JSON frame before a valid frame) → tolerated; valid `initialize` and `tools/list` still answered correctly; no corruption.

## 7. Secrets / protocol safety — **PASS with one P2 (see §12, P2-1)**

- stdout: 100% JSON-RPC; no bearer tokens, no env secrets, no API keys, no banners (verified by raw capture and by the official-SDK client working).
- stderr: startup banner only; token value never present in stderr or in any tool error response.
- **P2-1 (protocol robustness): an oversized tool argument (>10 MB JSON-RPC message) terminates the `openob-mcp` process** — the stdio server's read buffer caps at 10 MB (`STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024`), the transport throws, the session closes, and the process exits (code 0, no stderr); the client sees "Connection closed" and the server is gone (no corruption — nothing reached the gateway; the gateway's own limit is also 10 MB, so no >10 MB note could ever be written — availability only, not data). A malicious client can therefore kill the MCP process repeatedly. This violates item 7's "malformed client input must not crash server."

## 8. Process / packaging — **PASS within repo, with one P2 (see §12, P2-3)**

- Clean build yields runnable `openob` (→ `bin/cli.js`), `openob-gateway` (→ `bin/gateway.js`), `openob-mcp` (→ `bin/mcp.js`); `package.json` `bin` map verified; CLI/MCP `--help` exit 0.
- stdin **EOF** → clean exit **code 0** (graceful).
- **SIGTERM / SIGINT** → prompt termination, no orphan, no temp/lock junk. On Windows (this Node 22.23.1) the signal terminates the process directly without running JS handlers (verified even with a minimal repro: `code=null sig=SIGTERM`, handler never runs) — the `process.on('SIGTERM'/'SIGINT')` handlers are registered and cover POSIX; either way the process dies promptly and leaves nothing behind. Repeated start/stop: 5+ cycles, zero orphans (verified against `tasklist`).
- No shared-dist/stale-build dependency: every probe built its own isolated esbuild `--outdir`; the committed suite's process tests do the same (unique `.dist-*` per file).
- **P2-3: `sql.js` is an undeclared runtime dependency of the gateway bundle.** esbuild leaves `import 'sql.js'` external; it resolves today only via npm hoisting from `@okw/index`. `apps/gateway/package.json` declares `@modelcontextprotocol/*` and `zod` but **not** `sql.js`. Inside this workspace the bins run; a standalone install of the gateway package could hit `ERR_MODULE_NOT_FOUND: Cannot find package 'sql.js'` depending on hoisting.

## 9. End-to-end — **PASS**

Real gateway + real `openob-mcp` process + real official MCP client: `create → read V1 → update → set_property → search → get_backlinks → rename → delete` all succeed; **canonical Markdown verified on disk** at every step (`Notes/New.md` created with frontmatter; renamed; deleted; `Seed.md`/`Linker.md` untouched). Repeat against a **default read-only gateway**: `create_note` → 403, nothing written.

## 10. Regression — **PASS**

Full suite green (270 tests): REST/CLI/MCP Phase 2 create/update/property, rename/delete OCC, 413 contract, process isolation, packaging Tests A–G, 9 Playwright e2e — all pass under `verify:full`. Live-MCP probe file: 7/7 tests × 4 consecutive runs, deterministic.

## 11. Baseline re-verification after probe removal

`npm test` → 52 files / 270 tests PASS; `npm run verify:full` → exit 0 (9 e2e green).

## 12. Severity

**P0: none.** **P1: none.**

- **P2-1 — Oversized MCP message kills the openob-mcp process** (protocol robustness/availability; item 7 violated). >10 MB single stdio message → transport read-buffer overflow → session close → process exit (code 0, silent). No data impact (gateway limit is also 10 MB), but a client can crash the MCP server on demand. Fix direction: catch the transport overflow error in `bin/mcp.ts` and keep the process alive returning a clean MCP error (or enforce/raise the buffer ceiling with explicit rejection); add a regression test sending >10 MB and asserting the server still answers the next request.
- **P2-2 — `openob_update_note` drops frontmatter** (contract/documentation). Verified this is the **inherited gateway contract**: `workspace.updateNote` (workspace.ts:580+) writes `request.content` verbatim via SafeWriter, and the REST `PUT /api/v1/notes/:path` route passes only `{path, content, expectedVersion}`. The MCP tool faithfully mirrors the gateway — this is **not** a Phase 3A transport defect. It is a silent-data-loss footgun newly exposed on the agent surface: an agent updating body content loses YAML properties unless it re-includes them. Required change: document it in the tool description (and consider a gateway-level warning); MCP behavior itself is correct.
- **P2-3 — `sql.js` undeclared in `apps/gateway` dependencies** (packaging). Bundle leaves `sql.js` external; works via npm hoisting in-repo, fragile for standalone installs. Fix: declare `sql.js` in `apps/gateway/package.json` (or bundle it via esbuild with the WASM loader).

**P3:** Windows SIGTERM/SIGINT terminate via signal without running the JS handler (Node platform behavior; handlers cover POSIX; graceful EOF exit verified). No orphan/temp/junk left in either case.

## 13. Verdict

# **STOP — exact blocker: P2-1**

`openob-mcp` **crashes (process exits) when a single tool argument exceeds ~10 MB** — the stdio read-buffer limit is hit, the transport throws, and the process terminates silently (client: "Connection closed"). Item 7 requires that malformed/oversized client input must not crash the server; it does. The blocker is availability-only (nothing reaches the gateway; the gateway's own 10 MB cap means no oversized note could ever be written), so there is **no P0/P1** — but per the audit's own gate the LIVE MCP TRANSPORT verdict cannot be issued while a hostile client can kill the MCP process.

Everything else passes: MCP uses the gateway exclusively (no second authority), real stdio protocol works with the official SDK, all 11 tools work, authorization stays gateway-owned (403/401, scope separation, forged-arg resistance), OCC 409s and error semantics survive truthfully (incl. 503 gateway-unavailable), no secret/protocol leakage in stdout/stderr, real production artifacts run, `verify:full` green, e2e 9/9. **P2-2 (frontmatter doc) and P2-3 (sql.js) are non-blocking but must land with P2-1 before Phase 3B.**

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** (GitHub Actions inaccessible for the private repo; 404 on the SHA).
