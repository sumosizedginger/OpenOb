# OPENOB REMOTE BROWSER CI CLOSURE AUDIT

**Audit:** REMOTE BROWSER CI ROUTING — verify committed fix for GitHub Ubuntu browser CI failures.
**Mode:** AUDIT ONLY — no production code modified, no commits created.
**Target:** committed main `e3b6da9c7257112596e9a62e578ae26147473200` (== origin/main, tracked tree clean).
**Environment:** Windows 10 (win32/x64), Node v22.23.1, Electron 43.4.0.

---

## 1. Baseline — PASS

- `HEAD == origin/main == e3b6da9`; `git status --porcelain` = 0.
- Fix commit: `e3b6da9 "fix(ci): isolate browser e2e from electron visual harness"` (touches `.github/workflows/ci.yml`, `package.json`, `tests/e2e/ai-gateway.spec.ts`, `capture-screenshots.spec.ts`, `desktop-electron.spec.ts`, `onboarding-tour.spec.ts` — CI routing, spec tags, and the ai-gateway refactor only; **`scripts/verify-desktop-release.mjs` not in the commit → release gate unchanged**).

## 2. Fix design (committed code)

| Concern                                    | Before                                                                       | After                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser CI invocation                      | full `playwright test` ran everything, including Electron + visual harnesses | `"test:e2e": "playwright test --grep-invert \"@electron\|@visual\""` — browser job (`npm run test:e2e -- --ignore-snapshots`) selects browser-only tests                                                                                                               |
| ai-gateway stale `apps/web/dist`           | navigated directly to a `serveWeb` gateway, depended on built static bundle  | temp vault + `NodeFsVaultStorage`/`SafeWriter` workspace + temporary `startGateway` backend on a free port (API only, no static serving); web app served by Playwright `webServer` (`npm run dev` → vite on `localhost:3100`) — **zero dependency on `apps/web/dist`** |
| Screenshot harness leaking into browser CI | exclusion based on phrase "Real Electron"                                    | harness tagged `['@electron', '@visual']` → excluded from browser (`@electron`) **and** electron-harness (`@visual`) routing; runnable via its dedicated command                                                                                                       |
| Electron tests                             | in browser CI                                                                | `"test:e2e:electron": "playwright test --grep \"@electron\" --grep-invert \"@visual\""` (real-Electron tests only), run in the Windows job alongside the release gate                                                                                                  |

## 3. Verification executed

1. **Deleted** `apps/web/dist`, `apps/desktop/dist`, `apps/desktop/release` (proved absent before the run).
2. **Browser E2E with dist deleted** — `npm run test:e2e -- --ignore-snapshots` (exact committed CI command):
   - **37/37 passed (47.4s), exit 0**
   - `capture-screenshots` / `desktop-electron` **NOT selected** (0 occurrences in run output)
   - `ai-gateway.spec.ts` selected and green **without** `apps/web/dist`
   - **BYOK/masked-secret/model assertions intact**: `expect(page.locator('text=sk-••••••••1234')).toBeVisible()` (spec:165), `sk-••••••••9999` (spec:175), model-availability assertion `expect(modelOptions).toContain('Unavailable')` (spec:277); 20 BYOK/model references retained
3. **Dedicated visual harness still runs**: `npx playwright test tests/e2e/capture-screenshots.spec.ts` → **1 passed** (10.9s) after rebuilding dist.
4. **`verify:desktop:release` not weakened**: gate script unchanged by the fix; still runs real packaged-Electron tests in-gate on Windows (`OPENOB_REQUIRE_PACKAGED`, `desktop-electron.spec.ts` — 2 passed in the preceding closure audit; Windows job also runs `npm run test:e2e:electron`).
5. **Electron harness routing**: `npm run test:e2e:electron -- --ignore-snapshots` → **3 passed, 1 skipped**; `desktop-electron` selected (2), `capture-screenshots` NOT selected (0).
6. **Gates**: `format:check` 0 · `lint` 0 · `typecheck` 0 · **unit 454/454 (72 files)** · browser e2e 37/37 · **`verify:full` 0**.
7. **Final tree**: `git status --porcelain` = 0; `origin/main == HEAD == e3b6da9`; no stray processes; temp logs removed.

## 4. Verdict

# ✅ REMOTE BROWSER CI ROUTING VERIFIED

- all browser tests pass with the committed CI command,
- ai-gateway uses Playwright webApp + temporary Gateway backend and does **not** require `apps/web/dist`,
- BYOK secret/model assertions remain intact,
- `capture-screenshots` and `desktop-electron` are **not** selected by the browser run,
- the screenshot harness still runs through its dedicated command,
- `verify:desktop:release` still explicitly runs real packaged Electron tests on Windows and was not weakened,
- format/lint/typecheck/unit/browser-e2e/verify:full all green,
- committed tree clean and `origin/main == HEAD`.

**Note:** remote GitHub Actions result for `e3b6da9` remains unobservable from this environment (private repo); local execution of the exact committed CI commands stands as the routing proof.
