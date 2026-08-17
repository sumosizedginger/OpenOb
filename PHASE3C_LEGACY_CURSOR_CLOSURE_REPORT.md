# Phase 3C Legacy Cursor Closure Report (P2-LEGACY)

## 1. Executive Summary

- **Objective:** Remediate P2-LEGACY by eliminating unsafe bare-sequence replay on legacy `evt_<seq>_<rand>` cursors.
- **Starting Commit SHA:** `391debb2e5f9524f079a0e62503620f46c21a6bd`
- **Result:** **COMPLETE & GREEN**
- **Test Results:** 54 Vitest files (293 tests) passing + 23 Playwright E2E tests passing. `npm run verify:full` exits 0. Prettier formatting 100% clean.

---

## 2. P2-LEGACY Root Cause & Fix

### Root Cause

Legacy cursors in format `evt_<seq>_<rand>` (or bare integer sequences) carry an event sequence number but do not contain `serverInstanceId`. When a legacy client reconnected after a gateway restart to a new gateway instance that had already produced subsequent mutations (e.g. `B:1`, `B:2`, `B:3`), the server would parse `1` as a valid sequence on the current process and replay `[B:2, B:3]`, silently skipping `B:1` because it falsely assumed sequence `1` originated on instance B.

### Fix

1. **Unconditional Legacy Reset:** Legacy cursors (`evt_<seq>_<rand>` or plain integers) can never prove which server instance generated them. In `packages/workspace/src/events.ts` and `apps/gateway/src/server.ts`, any incoming legacy cursor now unconditionally emits `event: stream.reset` with machine-readable `reason: 'legacy_cursor'`.
2. **Removed Unsafe Sequence Extraction:** The production path no longer extracts sequence numbers from legacy cursors for incremental buffer lookups. `getEventsSince(lastSeq, clientServerInstanceId)` immediately returns `{ reset: true, reason: 'legacy_cursor' }` if `clientServerInstanceId` is omitted.
3. **Modern Cursor Protocol Preserved:** Modern instance-aware cursors (`<serverInstanceId>:<sequence>`) continue to support:
   - Same instance + retained sequence -> incremental replay in order.
   - Same instance + expired sequence -> `stream.reset (reason: 'replay_window_expired')`.
   - Different instance -> `stream.reset (reason: 'server_restarted')`.

---

## 3. Verification & Test Evidence

### Real HTTP/SSE Integration Tests (`tests/integrity/gateway-change-stream.test.ts`)

1. **Test 9 (P2-LEGACY Advanced-Instance HTTP Regression):**
   - Starts Gateway A, creates note, stops Gateway A.
   - Starts Gateway B on same port/vault and advances it to sequence 3 (`B:1`, `B:2`, `B:3`).
   - Connects with `Last-Event-ID: evt_1_legacyA`.
   - Asserts first semantic SSE event is `event: stream.reset` with `reason: legacy_cursor`.
   - Asserts **0 note events** are partially replayed.
   - After reset, mutates Gateway B (`B:4`) and verifies client receives `B:4` live under instance B's cursor.
2. **Test 10 (Same-Process Legacy Cursor Reset):**
   - Advances running gateway to sequence 3.
   - Connects with `Last-Event-ID: evt_1_samerun`.
   - Asserts that even on the same process, a legacy cursor unconditionally triggers `stream.reset` (`reason: legacy_cursor`).
3. **Test 11 (Malformed & Near-Legacy Inputs):**
   - Tests `evt_`, `evt_bad_rand`, `evt_-1_rand`, `evt_999999999999999999999_rand`, `EVT_1_rand`, `random text`, and oversized strings (>256 chars).
   - Verifies server handles all inputs safely without crashing or hanging.
4. **Test 12 (20x Advanced-Instance Legacy Cursor Stress Loop):**
   - Executes 20 sequential advanced-instance restarts and reconnects.
   - 20/20 iterations deterministically received `stream.reset (reason: legacy_cursor)`.

### Full Pipeline Verification Output

```text
> open-knowledge-workspace@0.1.0 verify:full
> npm run verify && npm run verify:e2e

Checking formatting...
All matched files use Prettier code style!

> open-knowledge-workspace@0.1.0 lint
> eslint .

> open-knowledge-workspace@0.1.0 typecheck
> tsc --build

> open-knowledge-workspace@0.1.0 test
> vitest run
Test Files  54 passed (54)
     Tests  293 passed (293)

> open-knowledge-workspace@0.1.0 build
[OpenOb Gateway] Build complete -> dist
[OpenOb Web] Build complete -> dist

> open-knowledge-workspace@0.1.0 test:e2e
> playwright test
Running 23 tests using 1 worker
23 passed (41.6s)
```

---

## 4. Remote CI Status

`REMOTE CI UNVERIFIED IN THIS ENVIRONMENT`

---

## 5. Final Verdict

**READY FOR DEEPSEEK FINAL PHASE3C AUDIT**
