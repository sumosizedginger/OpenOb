# PHASE3C_FINAL_CLOSURE_AUDIT.md

Final re-audit of the P2-LEGACY remediation at HEAD `fd9b7c01a7389eea3b1b6031265bc7747823b504` (`fix(phase3c): legacy cursor unconditional reset for restart safety (P2-LEGACY)`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean.

## 1. Baseline & original bug (not redefined)

Original P2-LEGACY (from the Phase 3C closure audit, unchanged): a **legacy** cursor (`evt_<seq>_<rand>` or a bare integer) reconnecting across a gateway restart — when the new instance had already advanced past the legacy sequence — was interpreted as a bare sequence and replayed a partial window (`events > lastSeq`) **without a reset**, silently skipping the new instance's early events (`B:1` skipped, `B:2`/`B:3` replayed). The web client was unaffected (it sends `instanceId:seq`), but the public API accepted legacy cursors as trusted replay positions.

Fix inspected in `apps/gateway/src/server.ts` + `packages/workspace/src/events.ts`: any cursor parsed as `isLegacy` now **unconditionally** emits `stream.reset` with `reason: 'legacy_cursor'` (server branch fires before any replay logic; `getEventsSince` returns `{reset:true, reason:'legacy_cursor'}` whenever `clientServerInstanceId` is omitted with `lastSequence > 0`). The heuristic legacy replay path is **removed**. Modern `instanceId:seq` cursors are unchanged.

## 2. Exact old-bug reproduction — **PASS (32/32 cycles)**

Real production gateway artifacts: for each cycle — fresh gateway B advanced to sequence ≥ 3 (`B:1`, `B:2`, `B:3` committed via real `openob-mcp`), then reconnect to `GET /api/v1/events` with `Last-Event-ID: evt_1_legacy`:

- The **first semantic SSE event is `stream.reset`** with `reason: legacy_cursor`.
- **Zero** `note.created` events are replayed before/after the reset from the legacy cursor (asserted on the captured stream).
- The `B:2`/`B:3`-only incremental replay that the old bug produced **never occurs** — any incremental replay based solely on a legacy sequence is impossible (the production path no longer extracts sequence positions from legacy cursors for buffer lookups).

Ran 8 cycles in the suite plus 3 additional full runs (24 more cycles) = **32/32**, all identical. The committed HTTP-level test (gateway-change-stream.test.ts test 9) covers the same scenario (gateway A → stop → gateway B advanced to seq 3 → `evt_1_legacyA` → reset + zero partial replay + `B:4` live after reset).

## 3. Legacy always-reset matrix — **PASS (9/9)**

`evt_1_a`, `evt_2_b`, `evt_999_c` each tested against: **fresh** gateway, **advanced** gateway (post-mutations), and **restarted** process (restart then reconnect) — **every one of the 9 combinations produced `stream.reset` (`legacy_cursor`)**. No legacy cursor is ever used as a trusted replay position.

## 4. Modern cursor regression — **PASS**

- Same instance: `A:1` → disconnect → `A:2`, `A:3` → reconnect with `<instA>:1` → **`A:2`, `A:3` replay in order, no reset** (verified `Mod2.md,Mod3.md`).
- Different instance: reconnect with `<instA>:1` after restart → **`stream.reset` (`server_restarted`)**.

## 5. Replay window regression — **PASS**

Same instance, cursor older than the 1024-event ring (1030-event churn) → **`stream.reset` (`replay_window_expired`)**. The legacy-reset change did not alter modern expiration semantics.

## 6. Malformed cursors — **PASS**

`evt_`, `evt_bad`, `evt_-1_x` → legacy-parse → **safe reset** (`legacy_cursor`); oversized (300 chars), `garbage`, `::::` → parse-null → **fresh connection** (no reset, no crash, no unsafe replay); live events continue to flow after each. No resource issue, no authorization bypass (auth is checked before cursor parsing).

## 7. HTTP path only — **PASS**

All acceptance evidence above was gathered through the **real built gateway artifact**: `GET /api/v1/events` route, real SSE framing (`id:`/`event:`/`data:` lines), `Last-Event-ID` header + `?lastEventId=` query, real `openob-mcp` mutations. Publisher-level `getEventsSince()` unit tests exist only as supplemental evidence (the committed test 1); acceptance is satisfied by the HTTP-path tests (committed tests 9/10 + this audit's probes).

## 8. Docs — **PASS**

`EXTERNAL_ACCESS.md` now states: modern cursors support same-instance replay / `replay_window_expired` / `server_restarted`; **legacy `evt_<seq>_<rand>` cursors "unconditionally trigger `event: stream.reset` with `reason: legacy_cursor`, guaranteeing safe full resynchronization without risk of partial/gapped replay"** — matching observed HTTP behavior exactly. **No documentation claims legacy incremental replay.**

## 9. Targeted Phase 3C regression — **PASS**

Real web (production SPA + real gateway + real MCP + real Chromium):

- Clean note → MCP V2 → **live refresh** (browser shows V2 without manual reload).
- Dirty note → MCP V2 → **buffer preserved**, save → **409**, **V2 survives on disk**.
- Delete → no resurrection / rename → no ghost (unchanged from the Phase 3C audit; the event path is untouched by this fix).
- Self-event → no save loop (unchanged; one PUT per save).
- `index.degraded` / `index.recovered` → emitted over real HTTP SSE (committed test 8, injected-failure path) — unchanged.
- Token → absent from URL/event payloads (re-verified in the browser test).

## 10. Full clean gate

| Step                                                  | Result                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `rm -rf apps/gateway/dist packages/*/dist` + `npm ci` | OK                                                                                                             |
| `npm run format:check`                                | **PASS**                                                                                                       |
| `npm run lint`                                        | **PASS** (0 errors)                                                                                            |
| `npm run typecheck`                                   | **PASS**                                                                                                       |
| `npm test`                                            | **PASS — Vitest: 54 files / 293 tests**                                                                        |
| `npm run build`                                       | **PASS**                                                                                                       |
| `npm run test:e2e`                                    | **PASS — Playwright: 23/23**                                                                                   |
| `npm run verify:full`                                 | **PASS (exit 0)**                                                                                              |
| Legacy advanced-instance regression                   | **32/32** runs (8 in-suite + 24 across three repeat runs), all `legacy_cursor` resets with zero partial replay |

## 11. Remote CI

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` 404 for the SHA (private repo); Node 20/22/Playwright/packaging status not queryable. Reported as unverified, not non-existent.

## 12. Severity

**P0: none. P1: none. P2-LEGACY: CLOSED.**

The only residual is fully remediated: legacy cursors can no longer skip events across restarts (unconditional `legacy_cursor` reset; the sequence-only replay path is deleted). Modern cursors retain all required semantics (same-instance replay, `server_restarted`, `replay_window_expired`). Docs match behavior. Full gate green.

## 13. Verdict

# **LIVE GATEWAY CHANGE STREAM COMPLETE**

- Legacy `evt_` cursors **always reset** (`legacy_cursor`) — verified 32/32 against real artifacts, including the exact advanced-new-instance case from the original bug.
- **No legacy sequence-only replay path remains** in the production code (inspected) or behavior (probed).
- The advanced-new-instance case **cannot** silently skip early events — the first semantic event is always the reset, and zero note events are replayed from a legacy cursor.
- Modern same-instance replay remains functional (`A:2,A:3` in order).
- Modern cross-instance restart reset remains functional (`server_restarted`).
- Replay-window expiration remains functional (`replay_window_expired`).
- Docs match actual HTTP behavior (no legacy incremental-replay claim).
- `verify:full` passes (54/293 Vitest, 23/23 Playwright).

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**
