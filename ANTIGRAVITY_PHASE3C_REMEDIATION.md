# ANTIGRAVITY_PHASE3C_REMEDIATION.md

One blocker (P2-1) plus two small follow-ups. No P0/P1.

## R3C-1 — Gateway-restart resync is broken for the emitted cursor format (P2-1, blocker)

- **Severity:** P2 (event gap without resync; audit items 13/14)
- **Problem:** After a gateway restart, a client reconnecting with `Last-Event-ID: evt_<seq>_<rand>` (the format the server itself emits as the SSE `id:` and the web client stores) receives **no `stream.reset`** and silently misses all events until the fresh instance's sequence counter exceeds the old cursor. The server only performs the `server_restarted` check when the client sends the `instId:seq` format, which the server never emits and the web client never sends.
- **Evidence:** end-to-end runtime probe on real artifacts — restart on the same port; reconnect with `evt_` cursor → no reset event (silent gap); reconnect with `instId:seq` cursor → `stream.reset` with `reason: server_restarted`. Code path: `apps/gateway/src/server.ts` events handler sets `lastServerInstanceId` only in the `lastEventIdHeader.includes(':')` branch; `packages/workspace/src/events.ts` `getEventsSince(lastSeq, undefined)` on a fresh instance hits `lastSequence >= sequenceCounter (0)` → `{reset:false, events:[]}`. The committed unit test (`tests/integrity/gateway-change-stream.test.ts:102-106`) calls `getEventsSince(4, 'old-server-instance')` directly on the publisher — it never exercises the HTTP path, so the format mismatch is untested.
- **Exact reproduction:** start gateway; open SSE; perform one mutation (capture `id: evt_...`); kill the gateway; restart on the same port; reconnect with `Last-Event-ID: <evt_...>`; perform a mutation → **no reset is received and the new event may also be missed if the new sequence is ≤ old**.
- **Root cause:** cursor-format asymmetry: the server emits `eventId` (`evt_<seq>_<rand>`) but only derives an instance check from `instId:seq`.
- **Affected files:** `apps/gateway/src/server.ts` (events handler cursor parsing), `packages/workspace/src/client.ts` (`subscribeToEvents` cursor tracking), `packages/workspace/src/events.ts` (maybe a helper), `EXTERNAL_ACCESS.md` (documentation), `tests/integrity/gateway-change-stream.test.ts` (+ e2e).
- **Required change (pick one coherent design):**
  1. **Encode the instance id in the emitted id** — e.g. emit `id: <serverInstanceId>:<seq>` (or `inst_<instanceId>_<seq>`) so the server's existing `includes(':')` branch and the web client's stored cursor naturally carry the instance; then `getEventsSince`'s `server_restarted` branch fires after every restart. Keep the `evt_` parse as a backward-compat fallback.
  2. **Or** in `getEventsSince`, treat `lastSequence > 0` against a fresh instance (`sequenceCounter` starting low / empty buffer) as `replay_window_expired`/`server_restarted` instead of a silent empty return (the current `lastSequence >= this.sequenceCounter → empty` branch is the silent-gap culprit and is semantically wrong across instances).
- **Required regression test:** e2e/integration through the **HTTP path** — connect, mutate, capture the emitted SSE id, kill + restart the gateway, reconnect with that id, assert `stream.reset` is received (reason `server_restarted`), then assert a post-restart mutation's event is received with the new instance id. The existing publisher-level test must stay (it proves the branch exists), but the end-to-end test is what catches this class of bug.
- **Acceptance criteria:** after a restart, any client reconnecting with a pre-restart cursor receives an explicit `stream.reset` (or equivalent documented resync signal); no silent gap; the web browser performs a safe full refresh on reset; OCC/clean-buffer/dirty-buffer flows unchanged.
- **Dependencies:** none.
- **What NOT to do:** do not silently drop the cursor check; do not make restart resync optional; do not "fix" by clearing the cursor on the client (that would hide gaps rather than resync); do not remove the ring-buffer overflow reset.

## R3C-2 — `EXTERNAL_ACCESS.md` overclaims restart→reset (P3, docs)

- **Problem:** the doc says "If expired or across gateway restart, `event: stream.reset` is sent" — false for the emitted cursor format until R3C-1 lands.
- **Required change:** make the sentence accurate (tie it to the fixed cursor format) once R3C-1 is merged.
- **Acceptance criteria:** documentation matches observed behavior.

## R3C-3 — HTTP-level `index.degraded/index.recovered` test coverage (P3, tests)

- **Problem:** the committed change-stream tests never exercise `index.degraded`/`index.recovered` through the server; only the publisher/workspace paths were inspected.
- **Required change:** add an integration test injecting an index-upsert failure after a canonical mutation and asserting the truthful `note.*` event + `index.degraded` event; then a rebuild asserting `index.recovered`.
- **Acceptance criteria:** both event types verified over the HTTP stream with truthful `indexStatus`.

## Order

R3C-1 is the blocker (must land first, with its HTTP-level regression test). R3C-2 and R3C-3 land with it. Re-run `verify:full` (exit 0) and the committed + audit e2e suites before Phase 3D.
