# OPENOB NODE 24 MIGRATION + SCALE-BENCHMARK ADVERSARIAL AUDIT

**Mode:** AUDIT ONLY — no files modified, no commits.
**Target:** committed main `3039c22a4e9ea70b5a307ac21ce063f2cf824f61` (== origin/main, tracked tree clean). Commits audited: `8e9a9da "test(perf): stabilize scale benchmark gate"`, `3039c22 "chore(ci): migrate OpenOb to Node 24 LTS"`.
**Environment:** Windows 10 (win32/x64). Runtimes: system Node **22.23.1**, downloaded portable **Node 24.19.0** (official nodejs.org binary) — both used empirically.

---

## AUDIT 1 — Node version truth — PASS

- `.nvmrc` = `24` ✓
- root `package.json` engines: `"node": ">=22 <=24"` (Node 24 primary; Node 22 retained)
- `ci.yml` matrix `[24.x, 22.x]`; browser-e2e + Windows-electron jobs use `24.x`; `pages.yml` uses `24.x`
- No contradictory version claims anywhere (README updated; devcontainer/Docker absent; no scripts pin another runtime)
- MINOR: `<=24` upper bound will block future Node 25 until edited — intentional conservative pinning, worth a comment.

## AUDIT 2 — GitHub Action runtime — PASS

`actions/checkout@v6` and `actions/setup-node@v6` in `ci.yml` and `pages.yml` (v6 targets the Node 24 action runtime — the Node 20 deprecation source is gone). **No `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` workaround anywhere.** Action-internal runtime correctly distinguished from the app runtime installed by `setup-node`.

## AUDIT 3 — Node 24 compatibility — **FAIL on Windows (BLOCKER)**

Verified empirically with a real Node 24.19.0 binary:

- `npm ci` on Node 24: **PASS**
- `npm run typecheck`: **PASS**
- `npm run build`: PASS (from prior gate runs; build under Node 24 OK)
- Full unit suite on Node 24: **3 tests FAIL, deterministically (reproduced 2/2 runs)**:
  - `tests/integrity/gateway-external-mutations.test.ts` — both tests fail: `expected 3221226505 to be 1` (spawned gateway CLI exits with **3221226505 = 0xC0000409 STATUS_STACK_BUFFER_OVERRUN**)
  - `apps/gateway/src/__tests__/gateway.test.ts` #20 "Clean State Executable Test" — `CLI exit with code 3221226505: Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` — a **libuv teardown assertion crash inside Node 24 on Windows** when the spawned CLI process shuts down.
- **Control:** the identical `node_modules`, run under Node 22.23.1 → the same files pass **32/32**. The breakage is Node-24-on-Windows-specific, not code-specific.
- Benchmarks (`scale-benchmark`, `large-vault-benchmark`): **PASS on Node 24** (4/4).
- Gateway CLI/MCP: the spawned-binary path is exactly what crashes on Windows; on Linux (remote CI) it passes.

## AUDIT 4 — Node 22 policy — PASS (intentional)

`engines ">=22 <=24"` + a retained `22.x` CI lane = deliberate compatibility coverage, not accidental baggage. Node 20 removed (expected). Documented policy exists (engines + README).

## AUDIT 5 — Benchmark diff — PASS (no cheating found)

`8e9a9da` changed only the two benchmark test files. Cheat-checks, all clean:

- threshold NOT raised: `expect(queryMs).toBeLessThan(500)` unchanged (search 500, rebuild 5000, upsert 500, graph 10000, backlinks 200)
- no `test.skip`, no CI-environment bypass, no retry-until-pass, no fastest-of-N
- median-of-3 keeps the **middle** sample — it does not discard slow samples to find a fast one
- measured query is the **same query as baseline** (`folderScope 'cat_0'`, filter `status equals active`, sort `index desc`, limit 50); a simpler warm-up query runs before measurement only
- 10,000 documents retained; assertions on result integrity retained (`nodes.length === 10000`, `edges.length > 5000`, `queryRes.total > 0`, `rows.length <= 50`)
- no mock replacing real query work; no production code touched by either commit

## AUDIT 6 — Timing methodology — PASS

`Date.now()` → `performance.now()` (monotonic); explicit warm-up query before sampling (JIT/statement-compile/cache warm); 3 samples → **median**; timed region is exactly the awaited query call. This distinguishes runner noise from real regressions at the 500 ms scale without going toothless. Weakness: the measured values are assertion-only (not logged) — observability MINOR.

## AUDIT 7 — Performance budget — PASS (no loosening)

Old target 500 ms = new target 500 ms. The remote 559/658 ms failures were single cold samples; the fix is a **methodology calibration** (warm-up + median), not a budget change. The 500 ms median-of-3 budget remains a meaningful interactive requirement for a 10k-document filtered+sorted query.

## AUDIT 8 — Production optimization — PASS (nothing changed)

Neither commit touches production query/index code. No caching, no skipped indexing, no reduced graph work, no semantic risk. Differential/correctness suites (`query-differential`, `view-mutations`, OCC suites) green.

## AUDIT 9 — CI coverage — PASS (lanes intact)

Node 24 primary lane ✓, Node 22 compatibility lane ✓ (though red — see Audit 11), browser Playwright ✓, Windows Electron/release ✓, Pages build/deploy ✓. Node 20 removal is expected, not a coverage regression.

## AUDIT 10 — Pages — PASS

`pages.yml` builds with Node 24 (`24.x`), `/OpenOb/` base + upload + deploy wiring unchanged, no Pages test removed. Remote **Deploy to GitHub Pages for HEAD = success**; live site `https://sumosizedginger.github.io/OpenOb/` → **200**.

## AUDIT 11 — Remote CI evidence — **MATERIAL**

Real GitHub-hosted runs for HEAD `3039c22` (via public API):

| Job                                            | Conclusion                           |
| ---------------------------------------------- | ------------------------------------ |
| Node 24.x — Typecheck, Test & Build            | **success**                          |
| Playwright E2E Browser Concurrency             | success                              |
| Electron Desktop Packaging & Windows E2E Smoke | success                              |
| Node 22.x — Typecheck, Test & Build            | **failure** (step "Run Test Suites") |
| Deploy to GitHub Pages                         | success                              |

Two problems: (1) the retained **Node 22 lane is red remotely** — exact assertion unobservable (job logs 403 without auth; check-run summaries empty); local Node 22 is green (454/454 previously; 32/32 for the CLI-spawn files just now), consistent with the historical 559/658 ms benchmark flake on shared runners, but unproven. (2) The green Node 24/Electron jobs do **not** exercise the Windows vitest suite that crashes locally — the Windows Node 24 breakage is invisible to CI. Green badge ≠ full migration proof.

## AUDIT 12 — Scope — PASS

`8e9a9da`: only the 2 benchmark test files. `3039c22`: `.nvmrc`, `ci.yml`, `pages.yml`, `package.json` engines, README (2 lines), plus committing the prior audit report doc. No unrelated refactoring, no CI/packaging/security changes beyond the migration itself.

---

## FINDING REGISTER

| #   | Class        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | **BLOCKER**  | **Node 24 on Windows crashes the spawned gateway CLI.** `apps/gateway/src/__tests__/gateway.test.ts` #20 + `tests/integrity/gateway-external-mutations.test.ts` (2 tests) fail deterministically on Node 24.19.0/Windows: spawned CLI exits `3221226505` with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` (libuv teardown assertion). Same code passes 32/32 on Node 22. **Impact:** Windows local dev/test and any Windows-run vitest suite are red under Node 24; Windows is the primary desktop platform. **Minimum fix:** keep Windows dev/test on Node 22 until the libuv crash is resolved (upstream Node fix or a teardown workaround in the gateway CLI), while Node 24 stays the Ubuntu CI primary; or pin a Node 24 patch where the assertion is fixed. |
| F-2 | **MATERIAL** | CI greenness is incomplete evidence: the Windows vitest suite is not exercised by any job (ubuntu can't reproduce the Windows-only crash; the Windows job runs only the Electron smoke spec), so the remote green badge masks F-1. Additionally the retained **Node 22 lane is red remotely** ("Run Test Suites") — exact cause unobservable; locally green, likely the shared-runner benchmark flake, but unproven → HEAD's CI is not fully green.                                                                                                                                                                                                                                                                                                                                                           |
| F-3 | MINOR        | Benchmark measured values are not logged (assertion-only gate) — add a printed median for remote observability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F-4 | MINOR        | `engines: ">=22 <=24"` upper bound blocks Node 25 without an edit; document intent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## VERDICT

# NODE 24 MIGRATION NOT CLOSED — FIX REQUIRED

The benchmark remediation (`8e9a9da`) is honest and sound — no threshold loosening, no skips, no sampling tricks, meaningful 500 ms median-of-3 gate over 10k docs — and Node 24 works for install/typecheck/build/unit on Linux (remote Node 24 lane green) and for the benchmarks on both runtimes. But the migration is not closed because **Node 24 is broken on Windows** (deterministic libuv teardown crash in the spawned CLI; 3 failing tests, reproduced 2/2; Node 22 control green), and the remote CI topology does not exercise that path.

**PERFORMANCE REGRESSION: NO** — benchmark gate green on Node 22 and Node 24, thresholds unchanged, zero production code changed.

**CI GREENNESS ACHIEVED WITHOUT TEST WEAKENING: NO** — the benchmark fix contains no weakening, but overall CI is red (Node 22 lane failed remotely) and the Windows Node 24 breakage is not covered by any CI job; greenness for the migration commit was never actually achieved.
