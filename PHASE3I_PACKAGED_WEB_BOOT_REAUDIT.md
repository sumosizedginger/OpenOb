# PHASE3I_PACKAGED_WEB_BOOT_REAUDIT

**Packaged Web Boot Fix — Re-Audit (committed main `c29a2b8`)**

- **Prior user-reproduced failure:** packaged `OpenOb.exe` showed raw `UNAUTHORIZED / Missing or invalid authentication credentials` instead of the UI.
- **Fix commit:** `c29a2b8` "fix(desktop): package and serve web UI from deterministic resource path"
- **Auditor:** DeepSeek (adversarial second model) — AUDIT ONLY, no production code modified
- **Environment:** Windows 10.0.26200, Node 22.23.1, Electron 43.4.0

---

## 0. VERDICT

# ✅ PACKAGED OPENOB BOOT VERIFIED

The exact failure sequence (delete `release/` → clean install → build → pack → launch real `win-unpacked/OpenOb.exe`) was reproduced from scratch; the packaged app now boots to the real React UI with zero raw `UNAUTHORIZED` JSON, and every security boundary holds.

**Push status:** `origin/main` == local HEAD == `c29a2b8` — already pushed (verified via `git ls-remote`; `git push` reports up-to-date).

---

## 1. ROOT CAUSE (confirmed in code)

1. Old `getWebDistPath()` used relative-dir hopping (`../../../apps/web/dist`) + `process.cwd()` fallbacks — both invalid in packaged mode → no `index.html`.
2. `electron-builder` packed web assets via `files: ["../../apps/web/dist/**/*"]` (inside asar, unverified).
3. `server.ts` let static misses **fall through** into `/api/v1` token auth → `GET /` returned the 401 JSON.

## 2. FIX (verified in diff `c29a2b8`)

- `electron-builder.json`: web assets moved to **`extraResources: { from: "../web/dist", to: "web" }`** → deterministic `resources/web/`.
- `main.ts` `getWebDistPath()`: packaged mode = `process.resourcesPath/web` with **fail-fast throw** if `index.html` missing; dev mode probes a documented path list and throws a clear build error.
- `server.ts`: static delivery now **terminates** — 200 on hit, `404 Not Found` on miss, `403 Forbidden` on boundary escape; **never falls into auth**.
- `package.json`: `pack:desktop` / `package:desktop` / `dist:desktop` now enforce `build:web && build:desktop` first.
- **Electron security config unchanged** (no webPreferences/nodeIntegration/contextIsolation/sandbox/navigation lines touched).

---

## 3. REQUIRED SEQUENCE (executed exactly, from scratch)

| Step | Command                       | Result                                                                                        |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | `rm -rf apps/desktop/release` | ✅ deleted                                                                                    |
| 2    | `npm ci`                      | ✅ 639 packages                                                                               |
| 3    | `npm run build`               | ✅                                                                                            |
| 4    | `npm run pack:desktop`        | ✅ `win-unpacked/OpenOb.exe` + `resources/web/` (index.html, assets JS/CSS, brand/, favicons) |
| 5    | Launch **actual** exe         | ✅ below                                                                                      |

## 4. DIRECT PROBE OF THE RUNNING PACKAGED EXE (Playwright `_electron` against `win-unpacked/OpenOb.exe`)

| Probe (no auth unless noted)            | Result                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                 | **200 `text/html`**, contains `<div id="root">`                                                                             |
| `GET /assets/index-*.js`                | **200** `application/javascript`                                                                                            |
| `GET /assets/index-*.css`               | **200** `text/css`                                                                                                          |
| `GET /favicon.ico`                      | **200** `image/x-icon`                                                                                                      |
| `GET /brand/openob-mark.png`            | **200** `image/png`                                                                                                         |
| `GET /api/v1/workspace` (no token)      | **401** `{"code":"UNAUTHORIZED","message":"Unauthorized: Missing or invalid authentication credentials"}` — boundary intact |
| `GET /api/v1/workspace` (Bearer token)  | **200** workspace JSON (`storageType: node-fs`)                                                                             |
| Window title                            | `OpenOb`                                                                                                                    |
| Body contains `UNAUTHORIZED` / raw JSON | **false**                                                                                                                   |
| Header logo                             | `/brand/openob-mark.png` (Jackass) — brand retained                                                                         |
| Vault                                   | boots as `OpenOb Vault` (node-fs)                                                                                           |

**Missing-index failure mode (simulated):** renamed `resources/web/index.html` away and relaunched → app logs the clear fail-fast error `OpenOb web application assets are missing from the desktop package (checked "...resources\web")` — **no raw 401 rendered**. Restored after test.

## 5. FULL GATE + TREE

- `npm run verify:full` → **exit 0** (format, lint, typecheck, unit 425/425, build, e2e 38/38 incl. both real-Electron tests)
- Final `git status --porcelain` → **0 entries** (clean; only this untracked report added)
- `git ls-remote origin refs/heads/main` → `c29a2b8` == HEAD; push up-to-date

---

## 6. CONCLUSION

**PACKAGED OPENOB BOOT VERIFIED.** The packaged executable deterministically serves the web UI from `resources/web/`, renders the full React workspace, keeps `/api/v1` token-protected, preserves the Saint Jackass branding, and fails loudly (not with a misleading 401) if assets are missing. No blockers. Do not begin another phase.
