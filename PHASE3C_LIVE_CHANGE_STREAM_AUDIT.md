# PHASE3C_LIVE_CHANGE_STREAM_AUDIT.md

Adversarial audit of the Phase 3C live change stream at HEAD `96a4a7e6e5e49c5be414822f4549cd33796af6cd` (`feat(phase3c): live gateway change stream with real-time SSE invalidation`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean.

## 1. Baseline

| Step                                                                                  | Result                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Exact SHA                                                                             | `96a4a7e6e5e49c5be414822f4549cd33796af6cd` (on origin/main)                                                                              |
| Clean (`rm -rf apps/gateway/dist packages/*/dist` + `npm ci` + `npm run verify:full`) | **PASS** — `verify:full` exit 0: 54 files / **284 unit tests**, build, e2e **22/22**                                                     |
| Remote CI                                                                             | **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` 404 for the SHA (private repo); reported as unverified, not non-existent |

## 2. Event authority — **PASS**

`WorkspaceEventPublisher.publish` is called **only after durable committed success** in every mutation (workspace.ts: create ~586, update ~758, setProperty ~946, rename ~1416, delete ~1580 — each after the `success: true` audit record and after the canonical write/safeSave completes). Rename publishes one `note.renamed` (with `affectedPaths`) plus one `note.modified` per rewritten backlink file **only after the full backlink refactor completes**; the rollback/failure path throws before any publish. A failed/conflicted mutation never emits a successful event (409s produce no `note.*` event). `index.degraded` is published after a canonical success with a truthful `indexStatus`.

## 3. Single authority — **PASS**

Streaming adds no write path: the SSE endpoint is GET-only; the browser subscription effect (`useVault.ts` gateway mode) only calls `refreshVault`/`readNote`/`getBacklinks` (REST reads) and updates React state. No FSA/OPFS/coordinator/safe-writer usage in the stream path; topology unchanged (`Web/CLI/MCP → Gateway → OpenObWorkspace → Vault`).

## 4. Authenticated stream — **PASS**

`GET /api/v1/events` requires `workspace.read` scope (403 otherwise; 401 without/with-bad token). The web client uses **streaming `fetch()` with the `Authorization: Bearer` header** (client.ts `subscribeToEvents`) — **not** native `EventSource`, and the token never appears in URL/query/fragment/DOM/console/stream data. The `lastEventId` cursor may travel in a query param (cursor, not a secret — acceptable). Committed integration test 4 verifies 401-on-bad-token + no sensitive content in event DTOs.

## 5. Event privacy — **PASS**

Runtime-inspected every event payload key: `schemaVersion, eventId, sequence, serverInstanceId, timestamp, type, path, version, operation, requestId, clientId, indexStatus` (+ optional `oldPath/newPath/affectedPaths/reason`). Verified by probe: event JSON contains **no note bodies, no property values, no bearer tokens, no API keys, no absolute filesystem paths** (vault dir absent from payloads; paths are vault-relative). Path/version metadata only — appropriate for authenticated workspace readers.

## 6. CRUD events — **PASS**

Real Web/CLI/MCP operations each produced truthful events with correct `type`/`path`/`version`; rename carries `oldPath`+`newPath`+`affectedPaths` (the rewritten backlink files); delete emits `note.deleted` only after durable removal. No event observed before durable success (all 5 mutation types verified live).

## 7. Dirty buffer (critical) — **PASS (20/20)**

Real Chromium + real gateway + real `openob-mcp`: 20 iterations of (browser opens Race.md V1 → human types unsaved → MCP updates V1→V2 → event arrives). Every iteration: **human buffer preserved byte-for-byte**, **agent V2 survives on disk exactly**, browser shows a stale/conflict marker, **no auto-reload over the dirty buffer, no auto-save, no auto-merge**; human `Ctrl+S` → **409**. No P1.

## 8. Clean buffer live update — **PASS**

Browser clean on V1 → MCP writes V2 → **without any manual refresh** the browser displays V2, the tab's version becomes V2; subsequent human edit + save from V2 **succeeds** (no stale-V1 retention).

## 9. Delete resurrection — **PASS**

Browser opened the note → MCP deleted → event: clean tab closes and the tree updates; with a **dirty** buffer the buffer remains (recoverable in the UI) but a stale save returns conflict and the **deleted note stays absent** — no canonical recreate.

## 10. Rename ghost — **PASS**

Browser opened B.md → MCP renamed B→C → event: clean tab migrates to C and loads the new content; a **dirty** tab is **not silently retargeted** (stays at B, conflict marker); stale save → 409; **B.md absent, C.md authoritative, no ghost recreation**.

## 11. Self-event loop — **PASS**

10 web saves on a dedicated note → **exactly 10 PUT requests** (one canonical mutation per save), no autosave/event recursion, no repeated REST writes, no version regression (disk stable after events settle).

## 12. Ordering — **PASS**

60 concurrent gateway mutations (real MCP) → SSE received **60/60** `note.created` events with **strictly monotonic** sequences, **unique** eventIds, no missing committed ops; final state consistent. Structural events (rename → per-backlink modified) are emitted deterministically in order.

## 13. Replay — **PASS**

Disconnect at event N → 5 mutations → reconnect with `Last-Event-ID: N` → the 5 missed events replay **exactly once, in order** (no duplicates of pre-disconnect events). Exceeding the 1024-event ring buffer (1030-event churn) → reconnect → explicit **`stream.reset` (`replay_window_expired`)** — no silent gap.

## 14. Gateway restart — **FAIL (P2-1, the blocker)**

- `serverInstanceId` changes across restart (verified) and the server _has_ a `server_restarted` reset branch.
- **However**, the server emits SSE ids as `evt_<seq>_<rand>` (`event.eventId`) and parses the `evt_` format into a sequence **only** — `lastServerInstanceId` is set exclusively from the `instId:seq` format, which the server never emits and the web client never sends (client.ts stores `eventId`). After a restart, the new instance's `sequenceCounter` is 0, so `getEventsSince(lastSeq>0, undefined)` hits `lastSequence >= sequenceCounter` → `{reset:false, events:[]}` → **no `stream.reset`; the old cursor silently gaps** until the new instance's sequence exceeds the old cursor.
- **Runtime-confirmed** (real gateway, restart on the same port): reconnect with the `evt_` cursor → **no reset** (silent gap); reconnect with `instId:seq` → `server_restarted` reset works. The committed integration test (gateway-change-stream.test.ts:102-106) calls `getEventsSince(4, 'old-server-instance')` directly on the publisher — it never exercises the end-to-end HTTP path, so the format mismatch is untested and the docs (`EXTERNAL_ACCESS.md`: "across gateway restart, `stream.reset` is sent") overclaim.
- Severity: **P2** ("event gap without resync") — no data loss (OCC still protects every write; a manual refresh restores truth), but the "restart semantics are safe" and "replay/resync prevents silent gaps" gates fail.

## 15. Stream drop — **PASS**

Aborted only the SSE connection (gateway API alive): client reconnects with bounded exponential backoff (500 ms start → ×1.5 → 10 s cap), receives new events after reconnect; no FSA fallback; OCC remains safe. Live-stream loss is not conflated with gateway loss (the `/health` probe independently drives the Disconnected badge; a pure SSE drop reconnects transparently).

## 16. Slow client / resource — **PASS**

25 connect/disconnect SSE cycles completed in ~1.6 s with the gateway still responsive (mutation 201 immediately after); a fresh subscriber still receives live events; `unsubscribe` clears the listener (publisher `listeners` Set + server `activeSseConnections` cleanup on `res close/finish`); bounded 1024-event ring buffer; no gateway-wide stall, no unbounded per-client queue observed.

## 17. Index degradation — **PASS (code) / test-gap note**

The workspace publishes `index.degraded` after a canonical mutation succeeds with a failed index upsert (truthful: canonical event + degraded status, no false canonical failure), and `index.recovered` on rebuild. The committed change-stream tests do **not** cover `index.degraded/recovered` at the HTTP level — noted as a test gap (P3), not a defect.

## 18. Backlink rename — **PASS**

Note with two inbound links renamed via real MCP: the `note.renamed` event's `affectedPaths` = **both rewritten backlink sources** (`L1.md`, `L2.md`), plus one `note.modified` per source (`operation: refactor_backlinks`) so the browser invalidates/refetches each — no stale-link state.

## 19. Direct filesystem edit — **PASS (truthful docs)**

No `fs.watch`/chokidar/native-monitoring claims anywhere in the Phase 3C docs (verified by grep) — direct external filesystem edits are not promised to stream. OCC still protects later gateway writes via storage version checks.

## 20. Authorization — **PASS**

No token → **401**; wrong token → **401**; forged scope params → no elevation; read-only authenticated user gets events (documented `workspace.read` requirement); the event stream itself is GET-only and grants **zero mutation power**.

## 21. Real artifacts full scenario — **PASS**

Real `openob-gateway` + real `openob-mcp` + real `openob` CLI + production Web in real Chromium: **browser open → MCP create (tree updates live) → CLI modify (clean tab shows V2 live) → MCP property (disk verified) → CLI rename (tab migrates live) → MCP delete (tree removes live)** — all without any manual browser refresh; filesystem verified at each step.

## 22. Standalone regression — **PASS**

Local/FSA/OPFS mode requires no SSE (the subscription effect returns early unless gateway mode) and never connects to a gateway; all standalone behavior retained — committed e2e **22/22** green (incl. the 9 standalone local-mode tests) and **284** unit tests green.

## 23. Full gate

`npm run format:check` / `lint` (0 errors) / `typecheck` / `npm test` (54 files / 284) / `build` / `npm run test:e2e` (22/22) / `npm run verify:full` (**exit 0**) — all green at HEAD.

## 24. Remote CI

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — GitHub Actions inaccessible (404 for the private repo); Node 20/22/Playwright/packaging status not queryable.

## 25. Severity

**P0: none. P1: none.** Dirty buffers never overwritten (20/20), no resurrection/ghost, no dual authority, no scope bypass, no false committed event.

**P2-1 (blocker) — gateway-restart resync is broken for the emitted cursor format:** `evt_`-format `Last-Event-ID` never triggers `server_restarted` reset (server sets `lastServerInstanceId` only from the never-emitted `instId:seq` format); after a restart the old cursor silently gaps (`getEventsSince` returns empty because the fresh instance's `sequenceCounter` is 0). End-to-end runtime-confirmed; the committed unit test bypasses the HTTP path; `EXTERNAL_ACCESS.md` overclaims restart→reset.

**P3:** committed HTTP-level test coverage gap for `index.degraded/recovered`; doc overclaim in `EXTERNAL_ACCESS.md` tied to P2-1.

## 26. Verdict

# **STOP — exact blocker: P2-1**

Everything else passes: committed gateway mutations stream truthfully (no temp/rollback/failed events), dirty buffers are never overwritten (20/20), clean notes live-refresh, no resurrection/ghost, replay is exactly-once with an explicit reset on overflow, auth/token safety holds (Authorization header only, zero mutation power), resources bounded, real Web/CLI/MCP integration works, standalone mode green, `verify:full` exit 0. But **gateway-restart resync is unsafe**: a client reconnecting with the cursor format the server itself emits silently misses all events after a restart (no `stream.reset`, no resync) — violating the "replay/resync prevents silent gaps" and "restart semantics are safe" gates. Remediation in `ANTIGRAVITY_PHASE3C_REMEDIATION.md`. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**
