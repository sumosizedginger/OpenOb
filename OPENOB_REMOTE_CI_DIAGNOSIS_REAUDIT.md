# OPENOB REMOTE CI DIAGNOSIS & REMEDIATION RE-AUDIT

**Mode:** AUDIT ONLY — no files modified, no commits.
**Baseline:** `91dae9a` (prior: local crash RESOLVED; remote CI red in **Windows Node 24 Gateway Runtime Tests** + **Node 22** lane).
**HEAD:** `bbfcd696121df765c444085701705a7466dd0817` (== origin/main, tracked tree clean).
**Commit audited:** `bbfcd69 "test: stabilize gateway latency and scale benchmark median sampling"`.
**Runtimes:** system Node 22.23.1 + official portable Node 24.19.0 (Windows).

---

## AUDIT 1 — Log evidence — MINOR (documented-evidence gap)

No in-repo evidence that Gemini obtained the actual Actions logs for the old red jobs: no run/job IDs, no quoted assertion, no diagnosis document. Remediation targets the timing-variance pattern rather than a quoted failure. The audit's MATERIAL clause ("if Gemini never obtained the actual logs") is **unverifiable** from this environment (job logs 403 without a token; check-run annotations were empty) — but the outcome below is decisive: the exact same commands now pass remotely on the first attempt with only measurement hardening, which empirically confirms the diagnosis class.

## AUDIT 2 — Windows remote failure classification — RUNNER ENVIRONMENT / TRANSIENT (empirically confirmed)

Old failure class: cold-start/timing variance on shared runners — the gateway latency test timed a cold HTTP connection (`d1/d2/d3` from `Date.now()` with no warm-up) and the benchmark measured cold statement/route dispatch. Fix corresponds to cause: `apiFetch('/api/v1/workspace')` warm-up + `performance.now()` in `gateway.test.ts`; full-query-config warm-up + median-of-5 in `scale-benchmark.test.ts`. No product behavior changed.

## AUDIT 3 — Windows crash stays dead — PASS

`git diff ca7e370..HEAD -- apps/gateway/src/bin/` = **empty** (lifecycle code untouched since the exitCode fix). Targeted process tests on Node 24.19.0/Windows (current HEAD): `gateway.test.ts` + `gateway-external-mutations.test.ts` + `gateway-process-packaging.test.ts` → **32/32 pass** (gateway.test.ts now includes the warmed latency test). No `3221226505`, no `0xC0000409`, no `UV_HANDLE_CLOSING`. No new `process.exit` on active-handle paths, no force-kill, no swallow, no abnormal-exit acceptance, no Windows skip, no retries, no arbitrary sleeps.

## AUDIT 4 — Windows CI gate — PASS (GREEN remotely)

`windows-gateway-runtime` job intact: `windows-latest`, `setup-node@v6` Node `24.x`, `npm ci`, `build:gateway`, `npx vitest run` the same three process-level files. No `continue-on-error`, no conditional skip, no command change that reduces coverage. **Remote conclusion: success.**

## AUDIT 5 — Node 22 old failure — stabilized, benchmark still executes remotely

Exact old assertion remains unobservable (logs 403). The benchmark is **not removed, not isolated out of CI**: it still runs inside `npm test` in the Node 22 lane, and the lane is now **green remotely**. Old timing samples from before stabilization (prior local runs, Node 22): `[156.1, 160.2, 167.4, 172.9, 205.3]` median 167.4 ms (current HEAD) — the previous remote failures at 559/658 ms were single cold samples; the median design now absorbs them.

## AUDIT 6 — Performance integrity — PASS (not weakened)

vs `91dae9a`: 10,000 documents unchanged; same target query (`folderScope cat_0`, filter `status equals active`, sort `index desc`, limit 50) unchanged; **500 ms budget unchanged**; correctness assertions retained (`nodes.length === 10000`, `edges > 5000`, `total > 0`, `rows <= 50`). Warm-up upgraded to the full query configuration (same statement path as measurement). **Median-of-3 → median-of-5** — still the **median** (middle of sorted samples), not fastest-of-N; no retry-until-pass, no CI skip, no allow-failure, no mock. Measured locally on Node 24: `[177.4, 192.1, 198.5, 217.4, 236.6] ms | Median: 198.5 ms | Budget: < 500 ms`.

## AUDIT 7 — Node patch pinning — PASS (none, correctly)

No patch pinning introduced. The crash was fixed by code (exitCode), the remote flakes by methodology — pinning was unnecessary and is absent. `.nvmrc`/workflows/docs remain consistent (24.x / `>=22 <=24`).

## AUDIT 8 — Timeout changes — PASS (none)

`bbfcd69` changes no timeout values (diff = measurement/timer changes only). No 2x/5x/10x increases, nothing masking a hang.

## AUDIT 9 — Scope — PASS

`bbfcd69` = `apps/gateway/src/__tests__/gateway.test.ts` (15 lines), `tests/integrity/scale-benchmark.test.ts` (11 lines), plus committing the prior audit report. No production refactors, no UI/Electron/Pages/dependency/benchmark-rewrite changes.

## AUDIT 10 — New remote CI for HEAD — ALL GREEN (observed, run_attempt=1)

Run `32612652063` (first attempt, no reruns):

| Required job                             | Conclusion            |
| ---------------------------------------- | --------------------- |
| Node 24.x — Typecheck, Test & Build      | **success**           |
| Node 22.x compatibility                  | **success** (was red) |
| Windows Node 24 Gateway Runtime Tests    | **success** (was red) |
| Playwright Browser E2E                   | success               |
| Electron Desktop Packaging & Windows E2E | success               |
| GitHub Pages build/deploy                | success               |

## AUDIT 11 — Repeatability — acceptable with one caveat

One green remote run for `bbfcd69` (run_attempt=1; no rerun/replay trickery — the earlier red runs were different commits, not retries of this one). Root cause was runner variance → robustness comes from the measurement design (median-of-5 + aligned warm-up + monotonic timer), which is the standard honest defense and is deterministic locally (repeated passes this session). Caveat: only one remote confirmation exists; a second green run would fully close repeatability, but none can be triggered from this environment (no workflow-dispatch auth).

---

## FINDING REGISTER

| #   | Class | Finding                                                                                                                                                                                                                                                                                                                            |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | MINOR | No committed log evidence / diagnosis write-up for the two old red jobs (run/job IDs, exact assertion). Unverifiable whether logs were obtained privately; the empirical outcome (first-attempt green after measurement-only changes) confirms the timing-variance class. Fix: document the actual failure once log access exists. |
| F-2 | MINOR | Median-of-5 change has no written quantitative justification in the commit (acceptable: still median, budget/doc-count/query unchanged; the 5 samples locally span 177–237 ms with a stable middle).                                                                                                                               |
| F-3 | MINOR | Repeatability rests on a single remote green run (cannot trigger more without auth).                                                                                                                                                                                                                                               |

No BLOCKER, no MATERIAL finding.

---

## VERDICT

# NODE 24 MIGRATION VERIFIED WITH NON-BLOCKING FINDINGS

Both previously-red remote lanes are now **green on the first attempt** of the stabilized commit — Windows Node 24 Gateway Runtime Tests and the Node 22 compatibility lane — with all other required jobs green and the benchmark gate intact and unweakened. The measurement-only remediation (HTTP warm-up, aligned full-query warm-up, monotonic timers, median-of-5) matches the demonstrated timing-variance failure class; the Windows native crash remains dead (lifecycle code untouched, 32/32 process tests green locally on Node 24.19.0). Remaining items are documentation/observability MINORs.

**ORIGINAL WINDOWS NATIVE CRASH: RESOLVED**
**REMOTE WINDOWS NODE 24 GATE: GREEN**
**REMOTE NODE 22 COMPATIBILITY: GREEN**
**PERFORMANCE BUDGET: median 198.5 ms locally (Node 24), 167.4 ms (Node 22) — gate < 500 ms**
**PERFORMANCE GATE WEAKENED: NO**
**REMOTE FAILURE ROOT CAUSES PROVEN: NO** (log evidence unobtainable; class confirmed empirically by first-attempt green after measurement-only changes — not proven from actual log text)
**ALL REQUIRED CI GREEN: YES**
