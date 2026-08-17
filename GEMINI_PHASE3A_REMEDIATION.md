# GEMINI_PHASE3A_REMEDIATION.md

Three items for the single-writer cycle. P2-1 blocks the Phase 3A verdict; P2-2/P2-3 land with it before Phase 3B.

## R3A-1 — Oversized MCP message terminates openob-mcp (P2-1, blocker)

- **Severity:** P2 (protocol robustness/availability; audit item 7)
- **Problem:** A single stdio JSON-RPC message > 10 MB kills the `openob-mcp` process. Client sees "Connection closed"; the server exits (code 0, no stderr) and must be restarted. A malicious client can crash the MCP server on demand (DoS). No data impact: nothing reaches the gateway (its body limit is also 10 MB).
- **Evidence:** real-SDK probe — `callTool` with 11 MB content → "Connection closed"; child `exit code=0`; follow-up call → "Not connected". Mechanism confirmed in `node_modules/@modelcontextprotocol/server`: `STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024`, transport throws `ReadBuffer exceeded maximum size of ...`, session closes.
- **Exact reproduction:** `openob-mcp --url <gw> --token <t>`; send `tools/call` with `arguments.content` ≈ 11 MB; observe process exit.
- **Root cause:** `apps/gateway/src/bin/mcp.ts` passes no error handling / buffer configuration to `serveStdio`; the SDK's default 10 MB read-buffer overflow is unhandled and terminates the session/process.
- **Affected files:** `apps/gateway/src/bin/mcp.ts` (transport error handling / `serveStdio` options).
- **Required change:** (a) handle the transport/session error so the process stays alive and returns a clean MCP error (or explicitly rejects oversized messages before they reach the buffer); and/or (b) configure `serveStdio` with a documented `maxBufferSize` aligned with the gateway's 10 MB body cap, rejecting oversize with a proper MCP error instead of dying. stderr may log the rejection; stdout must stay pure JSON-RPC.
- **Required regression test:** process-level — send a >10 MB tool argument through the official SDK, assert the tool result is an error (or the call is rejected), then assert a FOLLOW-UP `workspace_info` call still succeeds on the same process.
- **Acceptance criteria:** oversized message → no process exit; next request succeeds; stdout remains pure JSON-RPC; no token leak in stderr; suite green.
- **Dependencies:** none.
- **What NOT to do:** do not silently accept >10 MB (gateway would 413 anyway); do not write oversized payloads to disk; do not disable the buffer check entirely.

## R3A-2 — `openob_update_note` drops frontmatter — document the contract (P2-2)

- **Severity:** P2 (silent-data-loss footgun on the agent surface; NOT a transport bug)
- **Problem:** `openob_update_note({path, content, expectedVersion})` replaces the whole file: YAML properties are lost unless re-included in `content`. Verified **inherited** from the REST/gateway contract (`workspace.updateNote` writes `request.content` verbatim; `PUT /api/v1/notes/:path` passes only `{path, content, expectedVersion}`) — MCP mirrors the gateway correctly, so this is a documentation/contract finding, not a Phase 3A regression.
- **Evidence:** real-MCP probe — create with `properties: { tags: ['a'] }` → disk has `tags: [a]`; update with content only → disk `# New\n\nEDITED body` (frontmatter gone), `get_properties` → `{}`.
- **Required change:** (a) update the `openob_update_note` tool description to state content replacement semantics (properties must be re-supplied or preserved via `openob_set_property`); (b) optionally surface a gateway-level warning field in the update response when an existing note's frontmatter would be dropped.
- **Required regression test:** MCP-level — create with properties → update without properties → assert the response/description contract is explicit (doc-level) OR assert the documented behavior (properties dropped) is stable and deterministic.
- **Acceptance criteria:** documented; behavior deterministic; no silent surprise for new agents.
- **What NOT to do:** do not silently merge frontmatter into update content (changes the gateway contract); do not add a second update semantic.

## R3A-3 — Declare `sql.js` in `apps/gateway` (P2-3, packaging)

- **Severity:** P2 (standalone install fragility)
- **Problem:** `build.js` leaves `import 'sql.js'` external in the `openob-gateway` bundle, but `apps/gateway/package.json` does not declare it — it resolves only via npm hoisting from `@okw/index`. A standalone gateway install could fail with `ERR_MODULE_NOT_FOUND: Cannot find package 'sql.js'`.
- **Evidence:** run `bin/gateway.js` outside the repo tree → `ERR_MODULE_NOT_FOUND 'sql.js'`; `npm ls sql.js` → only under `@okw/index`; `grep '"bin"' apps/gateway/package.json` deps list `@modelcontextprotocol/*`, `zod` — no `sql.js`.
- **Required change:** declare `sql.js` (matching `@okw/index`'s resolved version) in `apps/gateway/package.json` dependencies; re-run `npm ci` and the packaging Tests A–G.
- **Required regression test:** packaging smoke — build with a clean node_modules and run `openob-gateway` (start + /health 200) in a temp dir that has only the declared deps installed.
- **Acceptance criteria:** no runtime resolution into `packages/*/src/*.ts`; no undeclared externals; bins run from a standalone install of declared deps.
- **What NOT to do:** do not bundle the sql.js WASM inline without a loader test; do not depend on hoisting order.
