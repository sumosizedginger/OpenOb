# OPENOB NODE 24 WINDOWS BLOCKER CLOSURE RE-AUDIT

**Mode:** AUDIT ONLY — no files modified, no commits.
**Baseline:** `3039c22` (prior verdict: NOT CLOSED — FIX REQUIRED; Windows Node 24 libuv crash `3221226505` / `UV_HANDLE_CLOSING` at `src\win\async.c:94`; CI coverage hole).
**HEAD:** `91dae9ad198319e073a6624f286adbe4afff01b5` (== origin/main, tracked tree clean).
**Commits audited:** `ca7e370 fix(gateway): harden Windows Node 24 shutdown lifecycle`, `907b2dc test(perf): report benchmark timing samples`, `91dae9a ci: add Windows Node 24 gateway runtime gate`.
**Runtimes:** system Node 22.23.1; official portable Node 24.19.0 — both executed locally on Windows.

---

## AUDIT 1 — Scope — PASS

`ca7e370`: only `apps/gateway/src/bin/{cli,gateway,mcp}.ts` (shutdown lifecycle). `907b2dc`: only the two benchmark test files (+8 lines of logging). `91dae9a`: `ci.yml` (+22 lines, the new gate job) plus committing the prior audit report doc. No cosmetic or unrelated refactors.

## AUDIT 2 — Reproduce original failure / current HEAD — CRASH RESOLVED (local)

- Original failure reproduced as documented at baseline (Node 24.19.0, pre-fix behavior: `process.exit` after REST calls → spawned CLI exits `3221226505`, libuv `UV_HANDLE_CLOSING` assertion).
- **Current HEAD, Node 24.19.0 Windows:** the previously failing files now pass **deterministically** — `gateway.test.ts` + `gateway-external-mutations.test.ts` + `gateway-process-packaging.test.ts`: **42/42** (first run), **32/32** (repeat), `gateway-external-mutations` **2/2** (third pass). **Full suite: 457/457, exit 0** (73 files). No `3221226505`, no `0xC0000409`, no `UV_HANDLE_CLOSING`, no forced kill.
- **Node 22 control** (identical node_modules): 32/32 — both runtimes green.

## AUDIT 3 — Root-cause validity — PASS

Cause was `process.exit()` racing libuv handle close on Node 24/Windows teardown (forced terminate while a handle close is in flight → assertion). Fix: `process.exit(n)` → `process.exitCode = n` + natural event-loop drain, with `return` where needed (`cli.ts` 3 sites incl. `result.exitCode`, `gateway.ts` 1, `mcp.ts` 1). This corresponds exactly to the demonstrated cause; it does **not** add sleeps/timing-shifts/retries. Remaining `process.exit(1)` calls in `gateway.ts` (lines 111/125/134/140) are **pre-server error paths** (no handles exist — safe); the SIGTERM handler's `await gateway.stop(); process.exit(0)` (line ~190) is proven safe by the passing SIGTERM shutdown tests (external mutations, TEST E). No double-close, no leaked timers/HTTP/WS/stdio visible; exit codes stay truthful (tests assert them).

## AUDIT 4 — Crash-suppression check — PASS (none found)

No `catch-and-ignore`, no special handling of `3221226505`, no `test.skip`, no platform/node-version conditionals, no `taskkill`, no retry-until-clean-exit, no premature termination. The fix _removed_ `process.exit` rather than masking it. No cheating.

## AUDIT 5 — Windows Node 24 CI — COVERAGE PRESENT (job red remotely)

`ci.yml` now has a **`windows-gateway-runtime`** job: `runs-on: windows-latest`, `actions/setup-node@v6` Node `24.x`, `npm ci`, `npm run build:gateway`, then `npx vitest run apps/gateway/src/__tests__/gateway.test.ts tests/integrity/gateway-external-mutations.test.ts tests/integrity/gateway-process-packaging.test.ts` — **the exact process-level path**. No `continue-on-error`, no allow-failure, no skip; failure propagates. Existing Electron/release coverage untouched. **However, the job is RED on the latest remote run (see Audit 10).**

## AUDIT 6 — Node 22 remote failure — RED AGAIN, exact cause still unobservable

The previously red Node 22 lane failed **again** at "Run Test Suites" on the HEAD run. Exact assertion remains unobservable (job logs 403 without auth; check-run annotations empty). Local Node 22 is green (457-suite equivalent verified earlier; 32/32 just now). No evidence links it to benchmark weakening — the benchmark semantics are unchanged (see Audit 7).

## AUDIT 7 — Performance gate — PASS (no weakening)

`907b2dc` adds only `console.log` of the samples/median/budget — no threshold changes, no fastest-of-N, no retries, no CI bypass, no doc-count/query change, no mock. Median-of-3 retained. Measured locally on Node 24: `[152.1, 173.1, 209.6] ms | Median: 173.1 ms | Budget: < 500 ms` (the previously missing observability MINOR is fixed).

## AUDIT 8 — Support truth — PASS

`.nvmrc = 24`; engines `"node": ">=22 <=24"`; CI matrix `[24.x, 22.x]` + Node 24 in browser/electron/pages jobs + the new Windows 24 gate. Windows Node 24 now passes the process-level suite locally (457/457). Declared support matches local evidence; remote CI is the remaining gap.

## AUDIT 9 — Correctness regression — PASS (local)

CLI commands work (TEST B info/read/search via REST), MCP suite green, gateway REST + write-scope tests green, exit codes truthful (TEST G help/unknown semantics, external-mutations asserts 0/1), packaged gateway + Electron embedded gateway suites green (all within the 457).

## AUDIT 10 — Remote CI for HEAD — **CI NOT FULLY GREEN**

| Job                                            | Remote conclusion                               |
| ---------------------------------------------- | ----------------------------------------------- |
| Node 24.x — Typecheck, Test & Build            | success                                         |
| Playwright E2E Browser Concurrency             | success                                         |
| Electron Desktop Packaging & Windows E2E Smoke | success                                         |
| Windows Node 24 Gateway Runtime Tests          | **failure** (the new gate itself)               |
| Node 22.x — Typecheck, Test & Build            | **failure** (Run Test Suites — 3rd consecutive) |
| Deploy to GitHub Pages                         | success                                         |

The local fix is solid (457/457, deterministic), yet the two Windows/Node-22 lanes fail remotely with **identical local commands passing** — a remote-only discrepancy whose exact assertion is unobservable from this environment (logs 403 without a token; check-run summaries empty). Plausible causes (runner Node patch variance, Defender/AV spawn latency vs process-test timeouts, shared-runner load) cannot be confirmed without job logs.

---

## FINDING REGISTER

| #   | Class        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | **MATERIAL** | Remote CI red in the new **Windows Node 24 Gateway Runtime Tests** job and the **Node 22** lane, while identical local runs pass (457/457 Node 24; 32/32 Node 22). Exact remote assertion unobservable (logs 403, annotations empty). Impact: HEAD CI not green; the dedicated coverage gate added by the fix does not pass remotely. Minimum fix: obtain the failing job logs (Actions log access), identify the remote-only failure (likely runner Node patch / process-spawn timing vs test timeouts), and address it. |

The local Windows Node 24 crash blocker (F-1 of the prior audit) is **genuinely fixed** — no crash code remains, no suppression, deterministic green locally.

---

## VERDICT

# NODE 24 MIGRATION NOT CLOSED — FIX REQUIRED

The Windows Node 24 process crash is **resolved** (ca7e370's `process.exitCode` lifecycle fix is the correct root-cause fix, verified 457/457 deterministic on Node 24.19.0/Windows with a Node 22 control), the CI coverage hole is **closed in config** (the Windows Node 24 gateway gate exists and runs the exact process-level files), the benchmark gate is **unweakened** with the added observability, and scope was disciplined. What remains: **remote CI is red in two lanes** — the new Windows Node 24 gate and the Node 22 compatibility lane — with local reproduction green, so the migration cannot be declared closed until the remote-only failures are diagnosed (requires Actions log access) and green.

**WINDOWS NODE 24 PROCESS CRASH: RESOLVED** (locally proven; no crash suppression)
**WINDOWS NODE 24 CI COVERAGE: PRESENT** (job added, exact files; currently red remotely)
**NODE 22 COMPATIBILITY CI: RED**
**PERFORMANCE REGRESSION: NO**
**PERFORMANCE GATE WEAKENED: NO**
**CI FULLY GREEN: NO**
