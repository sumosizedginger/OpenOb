# GEMINI_PHASE3B_REMEDIATION.md

Four items for the single-writer cycle. R3B-0 is the verify:full gate; R3B-1..3 are the P2 findings. No P0/P1.

## R3B-0 — `verify:full` red at HEAD (prettier on committed docs)

- **Severity:** P2 (process gate)
- **Problem:** `npm run verify:full` fails at `format:check` because two committed markdown docs are not Prettier-clean: `EXTERNAL_ACCESS.md`, `PHASE3B_GATEWAY_MANAGED_WEB_REPORT.md`.
- **Evidence:** `npm run verify:full` → `prettier --check .` → `[warn] EXTERNAL_ACCESS.md`, `[warn] PHASE3B_GATEWAY_MANAGED_WEB_REPORT.md`; all other gates (lint/typecheck/278 tests/build/15 e2e) pass.
- **Required change:** run `npx prettier --write EXTERNAL_ACCESS.md PHASE3B_GATEWAY_MANAGED_WEB_REPORT.md` and commit.
- **Acceptance criteria:** `verify:full` exit 0 at the fix commit.

## R3B-1 — Web save path collapses all gateway errors to "External Conflict!" (P2-1)

- **Severity:** P2 (error-semantics truthfulness; audit item 14)
- **Problem:** In `apps/web/src/hooks/useVault.ts` `saveActiveNote`'s gateway branch, the first catch arm is `if (err instanceof GatewayError || err.status === 409 || err.code === 'CONFLICT')`. `OpenObGatewayClient` throws `GatewayError` for **every** non-2xx (401/403/404/413/503), so the dedicated `403 → alert(read-only)` and `404` arms are unreachable for gateway errors. Runtime-verified: a **403** read-only save renders "External Conflict!" + conflict modal; a **dead-gateway network failure** renders "External Conflict!" instead of a disconnected state.
- **Exact reproduction:** start gateway with read-only scopes; connect browser; type; Ctrl+S → status shows "External Conflict!" (expected: read-only denial). Kill gateway; Ctrl+S → "External Conflict!" (expected: disconnected/error).
- **Root cause:** error-class check (`instanceof GatewayError`) precedes status/code discrimination.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (saveActiveNote gateway catch), possibly `packages/workspace/src/client.ts` error metadata (expose status/code on the thrown error — already present).
- **Required change:** reorder the arms: handle `err.status/code` first — `401 → auth error`, `403 → read-only alert` (existing arm), `404 → missing note`, `413 → too large`, `5xx/network/TypeError → "Disconnected — cannot reach gateway"` (set a `gatewayReachable:false` state), `409/CONFLICT → conflict modal` last.
- **Required regression test:** e2e — read-only gateway save shows the read-only message (not "External Conflict!"); gateway-kill save shows a disconnected message; stale save still shows the conflict modal.
- **Acceptance criteria:** each HTTP error class renders a distinct truthful status; no "Saved" lie in any failure; existing conflict flow unchanged.
- **What NOT to do:** do not auto-retry saves; do not auto-reconnect-and-save; do not hide the error.

## R3B-2 — Manual Disconnect silently discards unsaved buffers (P2-2)

- **Severity:** P2 (session/data-loss UX; user-initiated)
- **Problem:** `disconnectGateway` (useVault.ts:464-500) calls `setOpenTabs([])` unconditionally; any dirty tab's unsaved edits are dropped with no warning. Committed e2e test 6 only asserts the status-bar switch.
- **Exact reproduction:** connect to gateway; edit Welcome.md (unsaved); click Disconnect in the connect modal → buffer gone, editor empty, no prompt.
- **Required change:** before discarding, check `openTabs` for `isDirty`; if any dirty tab exists, confirm with the user (e.g., "You have unsaved changes — Discard them and switch to local mode?"). On cancel, abort the disconnect.
- **Required regression test:** e2e — dirty tab + Disconnect → confirmation appears; cancel keeps the buffer and gateway mode; confirm switches to local mode.
- **Acceptance criteria:** no silent loss of unsaved edits on any mode switch; disk untouched either way.
- **What NOT to do:** do not auto-save dirty buffers on disconnect (changes the user's intent); do not block disconnect when nothing is dirty.

## R3B-3 — No gateway health/disconnected indicator (P2-3)

- **Severity:** P2 (disconnect/session weakness; audit item 3)
- **Problem:** After the gateway dies, the status bar still shows "Gateway: <name>" with the Server icon; nothing indicates the connection is lost until the next save (which then mislabels it per R3B-1).
- **Exact reproduction:** connect; kill the gateway process; observe the status bar unchanged ("Gateway: …") with no disconnected signal for an idle editor.
- **Required change:** a lightweight health check (e.g., periodic `/health` or `workspace_info` probe every N seconds, or a failed-request latch) that flips the status bar to a "Disconnected" state (and, per R3B-1, distinguishes read-only vs disconnected vs conflict). Keep the editor buffer intact and allow a re-save once the gateway returns.
- **Required regression test:** e2e — kill gateway → status bar shows Disconnected within ~2× probe interval without any user action; restart → status recovers; buffer preserved throughout.
- **Acceptance criteria:** truthful connectivity indication without lying about save state; no data loss during the outage.
- **What NOT to do:** do not auto-switch to a local vault on detection (would create a second authority); do not discard buffers.

## Dependencies / order

R3B-0 (gate) is independent. R3B-1 and R3B-3 interact (disconnected state consumed by the save-error mapping); implement R3B-1 first, then R3B-3. R3B-2 is independent. After the four land, re-run `verify:full` (must be exit 0) and the committed + probe e2e suites before Phase 3C.
