# PHASE3C_FINAL_CLOSURE_AUDIT.md

Re-audit of the Phase 3C remediation (R3C-1, R3C-2, R3C-3) at HEAD `391debb2e079a53d9e921186b41f1b2f0e258ad6`. **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean.

## 1. Baseline & original findings

Original findings (from `PHASE3C_LIVE_CHANGE_STREAM_AUDIT.md`, not the closure report):

| Item      | Original finding                                                                                                                                              | Acceptance (original)                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R3C-1** | `evt_<seq>_<rand>` cursor never triggers `server_restarted` — after a gateway restart the old cursor silently gaps until the new instance's counter passes it | Old cursor from gateway A produces an explicit reset on B; same-instance replay preserved; replay expiration resets; no silent gaps; legacy cursor fail-safe; web performs safe restart resync |
| **R3C-2** | `EXTERNAL_ACCESS.md` overclaimed restart→`stream.reset`                                                                                                       | Docs match observed behavior (cursor format, replay, expiration, restart, legacy)                                                                                                              |
| **R3C-3** | No HTTP-level `index.degraded`/`index.recovered` coverage                                                                                                     | Both events proven over the real SSE endpoint with truthful `indexStatus`                                                                                                                      |

## 2. Cursor contract — **PASS**

The server now emits SSE `id: <serverInstanceId>:<sequence>` (`encodeEventCursor`) — carrying **both** the process instance and the sequence position. The web client (`subscribeToEvents`) stores the full emitted id and sends it back verbatim via `Last-Event-ID` (header) / `?lastEventId=` (query; the **cursor**, never the token — the token stays in the `Authorization` header). Payload `eventId` (`evt_<seq>_<rand>`) is a distinct per-event identifier and is **not** conflated with the replay cursor (the emitted SSE id is the instance-qualified cursor). `parseEventCursor` accepts the new format, the legacy `evt_` format, and a plain integer, with bounded input (≤256 chars) and non-negative integer validation.

## 3. Exact R3C-1 reproduction — **PASS (22/22)**

Real production gateway artifacts, 22 restart cycles: gateway A → connect authenticated SSE → mutate → capture the emitted SSE id (verified `format = <instanceId>:<sequence>`) → kill A → start gateway B (same vault, same port) → reconnect with A's exact captured id → **`stream.reset` received with `reason: server_restarted`** → mutate through B → the new event is received with **B's** `serverInstanceId` (≠ A's). No event gap; no waiting for the new sequence to exceed the old; the old bug (silent empty return) is impossible for the emitted format (the instance mismatch branch fires before any sequence comparison).

## 4. Repeat restart test — **PASS**

The 22-cycle loop showed **zero** intermittent silent gaps and **zero** stale cross-instance replay (every reconnect reset before any event; every post-restart event carried the new instance id).

## 5. Same-instance replay — **PASS**

Within one instance: receive seq N, disconnect, produce N+1..N+K, reconnect with cursor N → the missed events replay **strictly in order** with **no** unnecessary reset (verified R1–R5; `serverInstanceId` unchanged). The fix did not destroy useful replay.

## 6. Replay window expiration — **PASS**

1030-event churn (> 1024 ring buffer) → reconnect with a too-old cursor on the same instance → **`stream.reset` with `reason: replay_window_expired`** — explicit, no silent gap.

## 7. Legacy `evt_` cursor — **PARTIAL (residual P2)**

- Same instance, in-buffer: legacy `evt_<seq>_<rand>` reconnects replay correctly (no reset) — documented fallback works.
- Across restart (common case): `sequenceCounter < lastSequence` → **`stream.reset` (`server_restarted`)** — observed in the full-suite run (`{reset:true, reason:"server_restarted"}`).
- **Residual defect (P2, narrow):** if a **legacy-format** cursor reconnects after a restart **and the new instance has already advanced its counter past the legacy sequence**, the server replays the partial window (`events > lastSeq`) **without any reset**, silently skipping the new instance's early events ≤ lastSeq and mixing sequence spaces. Proven in an isolated reproduction: legacy seq 1 from instance A vs new instance B at counter 3 → B's events H1,H2 replayed, **H0 silently skipped**, no reset. The current web client is unaffected (it always sends `instanceId:seq`, proven safe 22/22), but the public API still accepts legacy cursors, so a silent gap remains reachable via the API. This is exactly the case audit item 7 rejects ("legacy cursor interpreted only as a sequence in a way that can silently skip events across restart"). Required change: make legacy cursors always emit an unconditional safe `stream.reset` (the docs already claim this) or prove buffer identity before replay.

## 8. Malformed cursors — **PASS**

Empty, garbage, huge (500 chars), negative, non-numeric, `:::`, `evt_`, `evt_abc_x`, `a:b:c`, `null`, `NaN` — all 12 cases: no crash, no unbounded processing, safe fresh/error behavior, no authorization bypass (auth is checked before cursor parsing; live events continue to flow after each malformed cursor).

## 9. Real web restart resync — **PASS (spot-checked)**

The committed e2e change-stream suite (4 tests, green) covers the browser resync path; this audit re-verified on real artifacts that a restarted gateway emits `server_restarted`, and the browser's existing reset handler performs a full `refreshVault` (clean notes show authoritative latest; dirty buffers are preserved — the dirty-buffer invariants were re-verified in the targeted regression below, including after event-driven invalidation). No FSA fallback, no auto-save, no auto-merge, no silent overwrite.

## 10 + 11. index.degraded / index.recovered over HTTP — **PASS**

- Committed integration test (gateway-change-stream.test.ts test 8) drives the **real HTTP SSE** endpoint with an injected index-upsert failure: after a successful canonical mutation, the stream carries the truthful `note.*` event **and** `index.degraded` (disk mutation succeeded; no rollback because the disposable index failed; `indexStatus` truthful), then after rebuild `index.recovered` arrives on the same public event path.
- This audit verified on the **real production binary**: `POST /api/v1/index/rebuild` → 200 `{count:1100, status:"verified"}` (1100 files from the probe suite's churn — the rebuild truly re-indexed the whole vault), then `GET /api/v1/search?q=Welcome` returned the correct match — the rebuilt index operates correctly.

## 12. R3C-2 documentation — **PARTIAL**

`EXTERNAL_ACCESS.md` §10 now documents the emitted cursor format, same-instance replay, `replay_window_expired`, `server_restarted`, and legacy compatibility — matching observed behavior **for the new cursor format**. One residual mismatch: the legacy-cursor sentence claims it "fails safe by emitting `stream.reset` (`server_restarted`)" — false for the narrow window in §7 (partial replay without reset). P3 doc overclaim tied to the P2-LEGACY fix.

## 13. Targeted Phase 3C regression — **PASS**

- Dirty browser V1 + MCP V2 + event: buffer **preserved byte-for-byte**, save → **409**, **V2 survives on disk** (re-verified).
- Delete via stream: no resurrection (file stays absent after stale save).
- Rename via stream: no ghost (verified in the Phase 3C audit; the rename invalidation path unchanged — spot-checked).
- Self-event: no recursive save (Phase 3C probe 11: exactly one PUT per save; unchanged).
- Token: absent from URL/SSE payload (probe 20 re-verified; the cursor in `?lastEventId=` is a sequence cursor, not a credential).
- Single authority: no FSA/OPFS gateway-mode writes (unchanged architecture; no new paths introduced by the fix).

## 14. Event ordering — **PASS**

Within an instance: sequences strictly increase, SSE ids unique and unambiguous (`<instanceId>:<seq>` — the instance id prefix identifies the sequence space). Across restart: sequences may reset, but the instance id differentiates the space and the new-format cursor is never ambiguous.

## 15. Resource safety — **PASS**

30 rapid SSE connect/disconnect cycles + the 22-restart cycles: no listener/timer/connection leaks observed (gateway remained responsive — mutation 201 immediately after; fresh subscribers still received live events). Ring buffer stays bounded (1024).

## 16. Full clean gate

| Step                                                  | Result                                  |
| ----------------------------------------------------- | --------------------------------------- |
| `rm -rf apps/gateway/dist packages/*/dist` + `npm ci` | OK                                      |
| `npm run format:check`                                | **PASS**                                |
| `npm run lint`                                        | **PASS** (0 errors)                     |
| `npm run typecheck`                                   | **PASS**                                |
| `npm test`                                            | **PASS — Vitest: 54 files / 289 tests** |
| `npm run build`                                       | **PASS**                                |
| `npm run test:e2e`                                    | **PASS — Playwright: 23/23**            |
| `npm run verify:full`                                 | **PASS (exit 0)**                       |

## 17. Remote CI

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` 404 for the SHA (private repo); Node 20/22/Playwright/packaging status not queryable. Reported as unverified, not non-existent.

## 18. Severity

**P0: none. P1: none.**

- **R3C-1: CLOSED** — the real emitted cursor is restart-safe (22/22 explicit `server_restarted` resets, no gaps); same-instance replay intact; expiration resets; malformed cursors safe.
- **R3C-2: CLOSED** with one P3 doc overclaim (legacy "fails safe" wording).
- **R3C-3: CLOSED** — `index.degraded`/`index.recovered` proven over real HTTP SSE (committed injected-failure test) plus real-binary rebuild/search verification.
- **P2-LEGACY (residual, narrow):** a legacy `evt_` cursor reconnecting across a restart where the new instance has already advanced past the legacy sequence silently skips the new instance's early events (no reset, partial replay). Reachable only via the legacy format (pre-upgrade clients / manual API use); the current web client is unaffected. This is the one gap against the audit's item 7 acceptance ("unconditional safe reset or exact-buffer-proof replay").

## 19. Verdict

# **STOP — exact blocker: P2-LEGACY (legacy-cursor restart ambiguity)**

R3C-1 (new-format cursor restart safety), same-instance replay, replay expiration, web resync, index.degraded/recovered over HTTP, docs (new format), targeted regressions, and the full gate (verify:full exit 0; 54/289 vitest; 23/23 playwright) are **all green**. The one remaining blocker is the narrow legacy-cursor path: a `evt_<seq>_<rand>` cursor reconnecting after a restart, when the new instance has already advanced past that sequence, is interpreted as a bare sequence and replays a partial window **without a reset** — silently skipping the new instance's early events (proven in isolation). Per audit item 7 this is the exact case to reject ("legacy cursor interpreted only as a sequence in a way that can silently skip events across restart"). Required fix (trivial): legacy cursors always emit an unconditional `stream.reset` (`server_restarted`) — matching the docs' claim — plus an HTTP-level regression test for the already-advanced-new-instance case. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**
