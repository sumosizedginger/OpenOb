# PHASE2A_FINAL_CI_AUDIT.md

Final CI re-audit at HEAD `c0307341f66e46beada43f3496d7128826df7588` (`fix(ci,tests): isolate process test build outputs to eliminate tsc dist shadowing race`). **AUDIT ONLY** — no production code modified; temporary state (forced tsc dist) removed; working tree clean except pre-existing `reasonix.toml`.

## 1. Exact SHA & clean-state sequence

**HEAD:** `c0307341f66e46beada43f3496d7128826df7588` (on `origin/main`, no commits after).

Executed exactly as required:

| Step                                       | Result                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rm -rf apps/gateway/dist packages/*/dist` | OK                                                                                                                                                                                                                                                                                       |
| `npm ci`                                   | PASS (0 vulnerabilities)                                                                                                                                                                                                                                                                 |
| `npm run typecheck`                        | **PASS** (exit 0) — and, critically, **does NOT (re)emit `apps/gateway/dist`** in this environment: `tsc --build` is incremental and `tsconfig.tsbuildinfo` (untracked, present from prior runs) marks the project up-to-date, so no dist is produced                                    |
| `npm test`                                 | **FAIL** — 49/50 files pass (245/246 tests), **one deterministic failure**: `apps/gateway/src/__tests__/gateway.test.ts > 20. Clean State Executable Test: Spawns built CLI executable as real process` (`CLI exit with code …: ENOENT` — `apps/gateway/dist/bin/cli.js` does not exist) |

**Required: PASS → NOT MET. STOP.**

## 2. The exact blocker (proven, not inferred)

`apps/gateway/src/__tests__/gateway.test.ts` test 20 resolves and spawns **`../../dist/bin/cli.js`** — i.e. the **shared `apps/gateway/dist`** (the same directory `npm run typecheck`'s tsc and `apps/gateway/build.js`'s esbuild both target). This is:

1. **A stale-artifact dependency**: the test only passes if `dist/bin/cli.js` happens to exist at test time. It passed in all 26 earlier full-suite runs only because `apps/gateway/dist` had been produced by a prior `npm run build`. From clean state it fails deterministically (verified twice).
2. **A test-order dependency**: `ci.yml` runs `npm test` (line 49) **before** `npm run build` (line 52), so the test's behavior depends on the pre-test state of dist.
3. **An accidental tsc-dist consumer** (the audit's exact question): on a fresh checkout, `npm run typecheck`'s `tsc --build` **does** emit `apps/gateway/dist` (no tsbuildinfo in git → full build). Proven by forcing emission (`npx tsc --build --force apps/gateway`): the emitted `dist/bin/gateway.js` is **broken** (`ERR_MODULE_NOT_FOUND` — it imports `@okw/*` TS sources) and the emitted `dist/bin/cli.js` **happens to run** (its `@okw/workspace` imports are type-only and elided) — so on a fresh CI checkout, test 20 would pass **while exercising the tsc-emitted CLI, not the esbuild production bundle**. That is exactly the "process tests must execute esbuild-produced artifacts, not tsc-emitted shared dist" violation.

The fix commit `c030734` correctly isolated the two **integrity** process files (`gateway-process-packaging.test.ts`, `gateway-external-mutations.test.ts`): both now build their own private esbuild bundle via `node apps/gateway/build.js --outdir <unique-temp>` and spawn that artifact; grep confirms **zero** references to shared `apps/gateway/dist` in those files; 20/20 loop iterations pass. **But test 20 in `gateway.test.ts` was missed** and still consumes the shared dist.

## 3. What IS verified stable

- **Process suites (isolated esbuild artifacts): 20/20 consecutive runs** on `gateway-process-packaging.test.ts` + `gateway-external-mutations.test.ts`, 0 failures — real gateway starts (`/health`, auth), real CLI works (REST), Phase 2A mutation flow (create → update → set-property → stale-409) works end-to-end.
- No shared-dist race between those two files (unique temp outdirs), no test-order dependency among them, no retries/sleep inflation/weakened assertions (re-verified).
- Phase 2A mutation unit/HTTP tests, P2A-1 413 contract tests, web e2e: green (245/246 in the failing run; the single failure is test 20).

## 4. verify:full

**FAIL (exit 1)** — same single blocker: `gateway.test.ts` test 20. All other gates (format, lint, typecheck, 49/50 files, build, e2e 9/9) green.

## 5. Remote CI

**REMOTE CI UNVERIFIED** — the environment cannot access GitHub Actions for this repository (`api.github.com/…/actions/runs?head_sha=c030734…` and the repo API both return 404; private/unlisted repo). Reported as unverified, not non-existent. Note: even if remote CI were green, it could be green **for the wrong reason** (consuming the tsc-emitted CLI), per §2.3.

## 6. Verdict

# **STOP — READY FOR PHASE 2B BLOCKED**

**Exact blocker:** `apps/gateway/src/__tests__/gateway.test.ts` test 20 ("Clean State Executable Test") spawns the shared `apps/gateway/dist/bin/cli.js`, producing a deterministic clean-state failure (`npm test` from `rm -rf dist` + typecheck) and, on a fresh checkout, silently testing the tsc-emitted artifact instead of the esbuild production bundle (ci.yml runs `npm test` before `npm run build`). The required sequence `rm -rf dist && npm ci && npm run typecheck && npm test` does **not** pass.

**Required fix (minimal, same pattern as the already-fixed integrity files):**

1. In `gateway.test.ts`, replace test 20's hardcoded `../../dist/bin/cli.js` with an isolated esbuild bundle: `beforeAll` builds `apps/gateway/build.js --outdir <unique-temp>`, and the test spawns `<temp>/bin/cli.js` (clean up after). Assert the artifact is the esbuild bundle (e.g. self-contained, no `packages/*/src` runtime imports) so it cannot accidentally regress to a tsc-emitted file.
2. Optionally reorder `ci.yml` to `npm run build` before `npm test` (defense in depth), and add the packaging smoke job output verification.
3. Regression gate: the exact required sequence passes from clean state, and `npm run verify:full` passes.

Everything else stands: the isolated process suites are stable (20/20), the Phase 2A mutation logic, P2A-1 413 contract, and web regression are green. Rename/delete not audited, as instructed.
