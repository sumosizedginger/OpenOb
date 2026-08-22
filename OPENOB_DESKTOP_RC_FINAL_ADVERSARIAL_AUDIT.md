# OPENOB DESKTOP RC FINAL ADVERSARIAL AUDIT

**Audit:** FINAL CONSOLIDATED — 106-section RC adversarial audit (supersedes all prior).
**Mode:** AUDIT ONLY. No production code modified. No production commits created.
**Repository:** https://github.com/sumosizedginger/OpenOb
**Audit target:** current committed main **+** the uncommitted RC-hardening working-tree state (the de-facto release candidate).
**Environment:** Windows 10 (win32/x64), Node v22.23.1, Electron 43.4.0, app version 0.1.0.
**Intended verified platform:** Windows x64 desktop alpha (dogfood).

---

## 1. Baseline — **FAIL**

| Item                  | Required | Actual                                                    |
| --------------------- | -------- | --------------------------------------------------------- |
| `origin/main == HEAD` | yes      | **yes** — both `3d61b8ab7562c10962df0bdc2daf7e830765a633` |
| tracked tree clean    | yes      | **NO — 18 modified + 5 untracked files**                  |

The **entire RC hardening is uncommitted**: `apps/desktop/src/main.ts`, `preload.ts`, `types.ts`, `build.js`, `electron-builder.json`, `apps/web/src/App.tsx`, `useVault.ts`, `FileTree.tsx`, `PluginManagerModal.tsx`, `packages/plugin/src/host.ts`, `package.json`, `.github/workflows/ci.yml`, 4 test files, plus untracked `OPENOB_RELEASE_CANDIDATE_HARDENING_REPORT.md`, `apps/web/src/components/AboutModal.tsx`, `scripts/verify-desktop-release.mjs`, `tests/e2e/desktop-data-safety.spec.ts`, `tests/integrity/desktop-security-hardening.test.ts`, `tests/integrity/product-truth.test.ts`.

The Gemini hardening report (`OPENOB_RELEASE_CANDIDATE_HARDENING_REPORT.md`) was read but **not treated as evidence**; every claim below was re-verified by execution or source.

## 2. Security boundary — **PASS**

- **Navigation origin check (§5):** `isAllowedNavigation` parses the URL and compares the **exact origin** to the current embedded-gateway origin (dev: exact configured Vite origin). Malformed URLs → `false`. No `startsWith`-style prefix trust.
- **Adversarial navigation (§6):** `http://127.0.0.1:<PORT>@evil/`, `<PORT>.evil.example`, query-param smuggling all resolve to a foreign origin → rejected. Covered by `desktop-security-hardening.test.ts` (origin-spoof variants) — green in the 451.
- **Privileged IPC (§7–§9):** every `ipcMain.handle` (get-bootstrap, get-info, get/set-onboarding-state, plugin prefs) calls `validateIpcSender`: `event.sender === mainWindow.webContents` **and** `senderFrame === mainFrame` **and** exact trusted origin; malformed sender URL → reject. Token escape attempt from untrusted frame → rejected (test-covered).
- **Hardening regression (§10):** production window keeps `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`; preload exposes only 4 typed methods on fixed channels; no generic `ipcRenderer` bridge.

## 3. Plugin boundary — **PASS**

- **`window.__pluginHost` (§11):** assigned **only** inside `if (import.meta.env.DEV || MODE === 'test')` (App.tsx:291–293). Production bundle `apps/web/dist/assets/index-*.js` contains **0 occurrences** (verified in built artifact).
- **Test harness (§12):** dev/test-gated at compile time (`import.meta.env.DEV`), stripped from prod bundle — not broad `NODE_ENV !== 'production'` runtime logic.
- **Raw-service boundary (§13):** `getContext` not exposed to production renderer; plugin execution through permission-gated `PluginAPI` (plugin-sdk-hardening suite green).
- **HTML sink (§14):** `host.ts` error path rewritten to `createElement`/`textContent`/`replaceChildren` — `innerHTML` interpolated-error removed. Hostile `<img onerror>` payload test green.
- **Sink sweep (§15):** no `eval`/`new Function`; no raw `.innerHTML =` in plugin rendering paths.

## 4. Save/race safety — **PASS**

- **Authority (§16):** `saveNote`/`flushDirtyNotes` route through the workspace backend / OCC — no raw filesystem bypass added.
- **In-flight revision race (§17, mandatory):** monotonic per-tab `revision` counter + `sentRevision` snapshot; a newer edit typed while a save is in flight is **not** marked clean when the older save resolves; the newer revision is then saved against the authoritative version returned by the first save. Covered by `browser-concurrency.spec.ts` A2/A3 — green.
- **Same-path serialization (§18):** per-path in-flight queue (`await existingInFlight` before a second save) — no self-generated OCC conflict, no simultaneous same-version saves (A4 green).
- **Edit-while-queued (§19):** newest buffer always wins; intermediate buffers may coalesce, newest never lost (A2/A3/A4).
- **Autosave timers (§20–§24):** inactive-tab autosave eligible (B/B2); rename migrates pending timer to new path, no stale old-path write (H1/C2); delete cancels timer, no resurrection (H12); discard cancels; vault switch resolves/cancels old timers before authority change.
- **Flush (§25–§27):** iterative until clean or truthful conflict; owns/cancels pending debounce; bounded timeouts fail safe (app stays open / error surfaced).

## 5. Close/quit safety — **PASS**

- **Typed handshake (§28):** explicit request/response flush protocol with unique request id, reason, typed result, sender validation, bounded timeout — not ad-hoc one-way events.
- **Single coordinator (§29–§30):** one central shutdown coordinator; guards duplicate flush, recursive `app.quit()`, double dialogs, double runtime close; one flush transaction per shutdown attempt (reentrancy tests).
- **Dirty close / quit failure / quit-with-conflict (§31–§34):** dirty close blocks or persists (packaged-exe dirty-close verified in prior audits, coordinator unchanged); save failure → app remains open or explicit decision; OCC conflict surfaced with no forced overwrite; "Quit without saving" only on conscious confirmation with clear loss wording.

## 6. Vault-switch safety — **PASS**

Single transaction ordering (select → main requests renderer flush → positive result → old runtime stops → new starts → `vault-switched`); exactly one flush transaction per switch; old session alive during flush; conflict aborts the switch with old runtime kept alive; dirty switch either saves first or cancels — no silent buffer loss. (Code + concurrency/switch suites green.)

## 7. File Tree mutations — **PASS**

- **Unopened rename/delete (§39–§41):** authoritative version acquired through workspace backend before mutating; mutation race → 409, no latest-overwrite retry.
- **Dirty delete/rename (§42–§44):** explicit destructive confirmation mentioning unsaved edits; rename preserves dirty buffer at new path and migrates pending autosave.
- **Folder truth (§45–§47):** folder-delete control removed from FileTree (no clickable no-op, no blind routing through note delete); folder create backend-supported; mode-specific capability reflects reality (product-truth tests).
- **Determinism/errors (§48–§49):** tree topology identical regardless of entry order; rename/delete/create failures surface understandable user errors without token/path/stack leakage.

## 8. App readiness — **PASS**

`useVault` exposes explicit truthful states (`initializing`/`ready`/`error`/`disconnected`); onboarding is gated on real workspace readiness (no welcome over ghost state, §51); bootstrap failure → truthful error/disconnected UI, no tutorial, no ghost fallback vault (§52).

## 9. Help/Learn discoverability — **PASS** (one item NOT REPRODUCED)

Native Help menu with **Learn OpenOb / Quick Tour / Keyboard Shortcuts / About** (§53–§56); Quick Tour replays the existing engine, no duplicate; Keyboard Shortcuts UI matches runtime; in-app three-dot More menu groups Help/Learn (§57); web mode keeps the full in-app path (§58); About shows OpenOb branding, version, platform, build SHA, clean state — no token/API key/paths (§59); menu actions go through a narrow typed command bridge (§60). §98 (fresh human evaluator) — **NOT REPRODUCED** in this environment; prior assess graded discoverable via native menu + More-menu grouping.

## 10. Plugin preference persistence — **PASS**

Persisted preferences are loaded **before** first-party plugins are enabled (App.tsx now `await pluginHost.enablePlugin(pluginId)` driven by loaded prefs — the old unconditional enable-all removed); disabled plugin does not execute `onload` after restart (hardening tests); re-enable persists; state lives in userData config (desktop) / namespaced localStorage (web) — never markdown/vault; `set-plugin-preference` IPC validates payloads (unknown ids, non-booleans, oversized lists rejected — no arbitrary object dumped to `desktop-config.json`).

## 11. Starter content truth — **PASS**

Fresh seed carries OpenOb branding; no stale "Open Knowledge Workspace" / "Sandboxed Plugin SDK" / architecture-phase language; no claim that third-party plugin JS is sandboxed when it is in-process capability-gated (product-truth tests). Existing user vaults are never re-seeded when `DEFAULT_VAULT_SEED` changes.

## 12. Build identity — **PASS (truthfulness) / FAIL (§3 gate refusal)**

- **Injection (§2):** `apps/desktop/build.js` computes `git rev-parse HEAD` + `git status --porcelain` **at build time** and esbuild-`define`s `OPENOB_BUILD_SHA`/`OPENOB_SOURCE_CLEAN`; the app (`desktop:get-info`) reads only the injected env — **no git shell-out at application runtime**.
- **Runtime verification (§97):** from the actual packaged app, `getAppInfo()` returned `{name:'OpenOb', version:'0.1.0', buildSha:'3d61b8ab7562c10962df0bdc2daf7e830765a633', sourceClean:false, platform:'win32', storageStatus:'ready'}` — exact package source, truthful dirty flag.
- **§3 gate refusal: FAIL** — see blockers.

## 13. Release scripts / formal gate — **PARTIAL**

- **Script semantics (§69):** truthful: `pack:desktop` = unpacked smoke; `dist:desktop` = real distributables (NSIS + Portable); `verify:desktop:release` = the documented formal gate; no misleading aliases.
- **Gate contents (§70–§72):** builds fresh web + desktop, runs electron-builder, requires Setup + Portable (missing → fail), writes SHA-256 manifest — **PASS**. Missing: release-dir cleaning, an in-gate packaged-app test, and dirty-source refusal — **FAIL** (see blockers).

## 14. Test isolation — **FAIL**

§78/§79: the packaged-exe spec (`desktop-electron.spec.ts`) launches `win-unpacked/OpenOb.exe` **without `--user-data-dir`** → uses the real profile. Snapshot proof: running the full e2e mutated `%APPDATA%\@okw\desktop-app` — **8 files added, 17 changed** (cache, Code Cache, DIPS, Local Storage LOG, DevToolsActivePort). §80: interrupted runs leave temp dirs (191 `openob-*` dirs accumulated in TEMP; passing runs clean their own).

## 15. Windows distributables — **PASS** (NSIS execution: NOT EXECUTED)

- **Two distinct artifacts (§73–§74):** `OpenOb-Setup-0.1.0-x64.exe` (NSIS, oneClick:false, custom install dir) and `OpenOb-Portable-0.1.0-x64.exe` — distinct names, no collision, config supported by electron-builder.
- **Portable execution (§75):** the actual Portable was launched; embedded gateway `/health` → `{"status":"ok","version":"0.1.0","readOnly":false,"vault":"OpenOb Vault"}`; `GET /` → 200 text/html with `<div id="root">` (real React UI, Jackass branding); `GET /api/v1/workspace` without auth → 401. (Playwright cannot attach through the 7z-SFX wrapper — test-tool limitation, not a product failure.)
- **NSIS install/uninstall (§76):** **NOT EXECUTED** — two automated silent attempts (`/S /D=<temp dir>`) each exited 1 with no installed files. Structure validated: MZ PE header, 114,492,672 bytes, expected artifact name.
- **Hashes (§77):** Setup `586db3dc508953f93d9bf1af3fcb0141c8dec44a5fc74a28e0f1f3d1b678926e` (114,492,672 B) ≠ Portable `2e9e1e9cad9e9ed892dae8fd97f7b84a9ec813f6907b1b81f4d074310f892383` (114,140,231 B) — both match the manifest.

## 16. CI evidence — **CONFIG PASS / REMOTE UNVERIFIED**

`.github/workflows/ci.yml` (working-tree version) runs `npm ci`, `format:check`, and on Windows **`verify:desktop:release`** + uploads Setup/Portable/manifest via `actions/upload-artifact` (§81/§82 — real release verification, not just `--dir`). **§83: REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — GitHub API returns 404 (private repo); local `format:check` fails on committed `README.md`, so remote CI would be red at HEAD regardless.

## 17. Platform/signing truth — **PASS (truthful)**

Windows x64: verified by execution (packaged exe, portable, gate). macOS/Linux: packaging configured (ICNS/icons present), **not** release-verified — documentation must state this. Windows binaries: **UNSIGNED DOGFOOD BUILD** — manifest declares `"notarization": "unsigned-dogfood-candidate"`; no fabricated credentials; mac signing/notarization unconfigured.

## 18. Regression gates — **PARTIAL**

| Gate                         | Result                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm ci`                     | **PASS**                                                                                                |
| `npm run format:check`       | **FAIL** — `README.md` (committed, since brand commit) + `OPENOB_RELEASE_CANDIDATE_HARDENING_REPORT.md` |
| `npm run lint` / `typecheck` | PASS                                                                                                    |
| `npm test` (unit+integrity)  | **451/451 PASS** (71 files, incl. all new hardening suites)                                             |
| `npm run build`              | PASS                                                                                                    |
| `npm run test:e2e`           | **42/42 PASS** (incl. save-race, data-safety, packaged-exe, AI, onboarding)                             |
| `npm run verify:full`        | **FAIL (exit 1)** at format:check                                                                       |

Regression specifics (§88–§96): onboarding welcome modal/skip/replay green; tutorial byte-identical vault; dirty editor preserved through tutorial; AI BYOK secret outside browser storage; static/API boundary verified on the live portable (200 HTML, 401 unauth); OCC 409 paths green; plugin permission enforcement intact; read-only gateway truthful; fresh package boots with real React UI + branding.

## 19. Artifact inventory

| Artifact                                | Size (bytes) | SHA-256                                                            | Launched                        |
| --------------------------------------- | ------------ | ------------------------------------------------------------------ | ------------------------------- |
| `release/win-unpacked/OpenOb.exe`       | —            | —                                                                  | yes (UI, About identity probed) |
| `release/OpenOb-Setup-0.1.0-x64.exe`    | 114,492,672  | `586db3dc508953f93d9bf1af3fcb0141c8dec44a5fc74a28e0f1f3d1b678926e` | **no** — install not executed   |
| `release/OpenOb-Portable-0.1.0-x64.exe` | 114,140,231  | `2e9e1e9cad9e9ed892dae8fd97f7b84a9ec813f6907b1b81f4d074310f892383` | yes (UI + gateway verified)     |
| `release/release-manifest.json`         | —            | —                                                                  | n/a (contents verified above)   |

## 20. Remaining non-blocking limitations (DEFERRED — NON-BLOCKING DOGFOOD)

- NSIS automated install/uninstall (silent install exits 1 in this session; structure validated, documented above).
- macOS/Linux executable verification — Windows is the only claimed verified alpha platform.
- Code signing — unsigned dogfood, truthful in manifest/docs.
- §98 human discoverability evaluation — not reproduced with a fresh evaluator.
- Test temp-dir cleanup on interrupted runs (§80, P3).

---

## Final Verdict

# ⛔ STOP — exact blocker(s)

1. **B-BASE (P1) — nothing is committed.** `HEAD == origin/main == 3d61b8a`, but the entire RC hardening (18 modified + 5 untracked files: IPC/navigation hardening, save-race fixes, plugin-pref ordering, plugin-host gating, AboutModal, release gate, CI wiring, hardening tests, report) exists **only in the working tree**. §1 "tracked tree clean" FAILS; no RC can be tagged, and remote CI cannot be green from committed state.
2. **B-RC-1 (§3, P2) — the formal release gate does NOT refuse dirty source.** Empirically proven: with 18 modified files plus a temporary marker in `README.md`, `node scripts/verify-desktop-release.mjs` exited **0** with "🎉 PASSED" and wrote a manifest recording `sourceClean: false`. §3 requires the official gate to refuse dirty source. The gate also omits release-dir cleaning and an in-gate packaged-app test (§70–§72).
3. **B-RC-2 (§78/§79, P2) — packaged-Electron tests are not profile-isolated.** `desktop-electron.spec.ts` launches `win-unpacked/OpenOb.exe` without `--user-data-dir`; the full e2e mutated the real `%APPDATA%\@okw\desktop-app` profile (8 files added, 17 changed).
4. **B-RC-3 (§99, P2) — `verify:full` is red.** `format:check` fails on committed `README.md` (formatting drift since the brand commit) and the unformatted hardening report.

Everything else in the 106-section matrix is **PASS** with executable/source evidence (451 unit + 42 e2e + live packaged-app probes: build identity truthful via build-time git injection, About SHA == package source, IPC/navigation boundary intact, plugin host absent from the production bundle, save-race and close/vault-switch safety green, real Portable artifact boots and serves the UI with a correct static/API boundary). NSIS install: **NOT EXECUTED** (documented per §76). Remote CI: **UNVERIFIED IN THIS ENVIRONMENT** (§83).

No new phase. The three P2 hardening gaps (gate dirty-refusal, profile isolation, format gate) plus committing the hardening are the concrete path to READY.
