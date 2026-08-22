# PHASE3I_ELECTRON_FINAL_AUDIT

**OpenOb — Phase 3I FINAL Desktop Product Audit**
**Electron + Embedded Gateway + Release-Candidate Integrity**

- **Audited commit (HEAD):** `5a8b42ea65de4249e785f392a6320a3658f31768` (main)
- **Audited tree:** working tree as-is (Phase 3I implementation is present but **entirely uncommitted** — 31 modified + 9 untracked files)
- **Auditor role:** DeepSeek (adversarial review / second model per AGENTS.md)
- **Scope:** CURRENT main; audit only — **no production code modified**
- **Environment:** Windows 10.0.26200, Node v22.23.1, npm 11.4.2, Electron 43.4.0 (binary downloaded for smoke test), vitest 3.2.7, Playwright 1.62.1

---

## 0. EXECUTIVE VERDICT

# ⛔ STOP — OPENOB DESKTOP IS NOT A RELEASE CANDIDATE

**The Electron desktop application cannot launch. It crashes at module load before any application code runs.**
Two further release-critical defects (AI dead in desktop; secrets encryption key is a public constant) and
two build-gate failures (`npm ci`, electron-builder) compound the verdict.

**Verdict gate result (from audit §46):**

| Gate condition                                 | Result                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Electron has one canonical workspace authority | ✅ structurally (unreachable at runtime)                                         |
| packaged renderer is hardened                  | ⚠️ renderer hardening OK, but **no CSP** despite claim                           |
| embedded Gateway works                         | ⚠️ implementation shared & loopback-bound, **but app never boots**               |
| watchers do not create second writes           | ✅                                                                               |
| secrets/tokens stay protected                  | ❌ **P1** — encryption key is a derivable constant; load errors unsurfaced       |
| external changes preserve OCC                  | ✅ (unit + e2e)                                                                  |
| AI/plugins/views work inside Electron          | ❌ **P1** — AI is 403-dead in desktop; plugins/views only proven in browser mode |
| crash/restart is safe                          | ❌ cannot be exercised — app crashes at startup                                  |
| desktop package launches                       | ❌ **P0** — boot crash; packaging also refuses electron version range            |
| full clean gate passes                         | ❌ `npm ci` fails (lockfile out of sync)                                         |

**NEXT PHASE = NOT Dogfood/Public Alpha.** Blocker remediation → re-audit → only then re-evaluate Alpha.

---

## 1. BASELINE (§1)

| Check              | Result | Evidence                                                                                                                                                                                                                       |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HEAD recorded      | ✅     | `5a8b42ea65de4249e785f392a6320a3658f31768` (matches Gemini Phase 3I report)                                                                                                                                                    |
| Working tree clean | ❌     | 31 modified + 9 untracked files. **The entire Phase 3I desktop implementation (`apps/desktop/`, `packages/workspace/src/plugin-services.ts`, desktop tests/reports) is uncommitted.** No release can be cut from a dirty tree. |
| Clean install      | ❌     | `npm ci` → `EUSAGE: Missing: @okw/desktop-app@0.1.0 from lock file`. `package-lock.json` contains **0** references to the new `apps/desktop` workspace. A fresh checkout cannot install.                                       |
| Build / test       | ⚠️     | All compile/test steps pass on the pre-existing `node_modules` (details §42); install step fails                                                                                                                               |

---

## 2. CRITICAL FINDINGS

### ⛔ P0-1 — Desktop app crashes at startup (ERR_MODULE_NOT_FOUND)

**Reproduction (real Electron smoke, exact `apps/desktop` entry):**

```
$ cd apps/desktop && npx electron .
App threw an error during load
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Test prompts\Subway\packages\desktop\src\types.js'
imported from D:\Test prompts\Subway\packages\desktop\src\index.ts
```

**Root cause chain:**

1. `apps/desktop/dist/main.js:6-8` (plain `tsc` output) imports `@okw/desktop`, `@okw/gateway`, `@okw/ai` at runtime.
2. Every `@okw/*` package `exports` points at **TypeScript source**: `packages/desktop/package.json` → `".": "./src/index.ts"` (likewise `vault`, `workspace`, `ai`, `index`, `markdown`, `core`, `plugin`).
3. `packages/desktop/src/index.ts` re-exports `./types.js` — Node's ESM loader looks for `src/types.js`, which does not exist (`src/types.ts` is the file), and Node 22 cannot execute raw `.ts` anyway.
4. The gateway binaries work only because `apps/gateway/build.js` bundles them with **esbuild** (`bundle: true`; `dist/bin/mcp.js` contains **0** `@okw/` imports). **`apps/desktop` has no bundle step** (`apps/desktop/package.json` build = `tsc -p tsconfig.json`).

**Impact:** Sections §10, §21, §22, §23, §24, §29, §40, §43 all fail. The packaged artifact would crash identically (worse: `files` in `electron-builder.json` ships `packages/*/dist/**/*` but **not** `packages/*/src/**/*`, so even resolution of the TS source would fail inside asar).

**Why CI was green:** no automated test executes `apps/desktop/dist/main.js` in Node. The "desktop E2E" runs a browser against Vite with a **mocked** bridge (§7 finding), and CI has no Electron job.

**Minimal compatible fix (for Gemini):** bundle desktop main/preload with esbuild exactly like `apps/gateway/build.js` (single `bundle: true` build), or point `@okw/*` package exports at committed `dist` builds. This is an architecture-adjacent decision; recording as **ADR-required** per AGENTS.md.

---

### 🔴 P1-1 — AI is non-functional in the desktop app (all AI endpoints 403)

**Reproduction** (vitest probe starting the embedded gateway with the _exact_ arguments `apps/desktop/src/main.ts:145-154` passes — i.e. **no `scopes`**):

```
GET /api/v1/notes            -> 200
GET /api/v1/ai/providers     -> 403 {"code":"FORBIDDEN","message":"Forbidden: listing AI providers requires workspace.ai.use scope"}
PUT /api/v1/ai/secrets/openai -> 403 {"code":"FORBIDDEN","message":"Forbidden: configuring AI secrets requires workspace.ai.configure scope"}
POST /api/v1/ai/chat         -> 403 {"code":"FORBIDDEN","message":"Forbidden: AI chat requires workspace.ai.use scope"}
```

**Root cause:** `apps/gateway/src/server.ts:305-315` — when `scopes` is omitted, the server grants only `workspace.read/search/write/properties.write/rename/delete/views.write`. `main.ts` passes no `scopes`, so the desktop renderer's `GatewayAIBackend` (`packages/workspace/src/ai-backend.ts:268+`) gets **403 on every AI call**: providers, models, secret config, chat — and therefore plugin `ai.chat` (`packages/workspace/src/plugin-services.ts:112-138`) too.

**Impact:** §12 and the verdict gate "AI … work inside Electron" fail. The Phase 3I report never exercised desktop AI (no AI step in the desktop e2e).

**Fix:** `main.ts` `startGateway` must pass `scopes: [..., 'workspace.ai.use', 'workspace.ai.configure']` (decision: Gemini/architecture).

---

### 🔴 P1-2 — Secret "master key" is a deterministic public constant; corruption is silent

- `apps/desktop/src/main.ts:123`: `const masterSecret = \`okw-desktop-master-${app.getPath('userData')}\`;`— the AES-256-GCM key is derived (PBKDF2,`packages/desktop/src/secure-storage.ts:51-55`) from a **constant string + predictable userData path**. Anyone who can read the user's files can recompute the key and decrypt `userData/secure/secrets.json`. This is obfuscation, not at-rest protection. It contradicts the standing decision (docs/DECISIONS.md — "explicit **user-provided master passphrase** … not machine-bound", Constitution Law 17 / F-005) and forgoes OS binding (Electron `safeStorage`/DPAPI is unused).
- `getLoadError()` (set on GCM auth failure) is referenced **only** in `secure-storage.ts` and tests — no runtime/UI surfaces it. A corrupted secrets file therefore presents as an **empty key list** ("no saved keys"), i.e. corruption is not handled truthfully. This is the previously recorded **P1-SEC-001 / F4-D** which is **still open**.
- Test coverage gap: `tests/integrity/desktop-embedded-gateway.test.ts` test 8 uses real passphrases (`'super-secure-passphrase-123'`) and never exercises the production `main.ts` key derivation — so the suite passes while production semantics are broken.

**Impact:** §13 fails; §12's "desktop secret persistence does not regress Phase 3G" is not met.

**Fix (decision required):** use Electron `safeStorage` (DPAPI/Keychain) for the key, or implement a real user passphrase flow; surface `getLoadError()` in the settings UI.

---

### 🟠 P2-1 — No Content Security Policy anywhere (contradicts the Phase 3I report)

- `apps/gateway/src/server.ts` static serving sets only `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` (lines 263-264) — **no `Content-Security-Policy` header** (grep across server, `apps/web/index.html`, `apps/web/dist/index.html`, `vite.config.ts`: zero CSP matches).
- The Phase 3I report states "Strict CSP header injected in HTTP and main process" (§2 of report) — **this claim is false**.
- `apps/web/index.html:12-18` also loads **Google Fonts from external CDNs** (`fonts.googleapis.com` / `fonts.gstatic.com`) — an external remote-resource dependency (offline-first §30, and CSP `default-src 'self'` cannot even be written while this remains).

**Impact:** §25 fails. Renderer is currently only our bundled code (HTML escaping policy + `dangerouslySetInnerHTML` ban mitigate XSS), so risk is defense-in-depth today — but the release gate explicitly requires CSP.

---

### 🟠 P2-2 — Packaging cannot run: electron version is a range

`root package.json` declares `"electron": "^43.4.0"`. `electron-builder` **requires an exact version**:

```
⨯ Electron version "^43.4.0" is a range, not a fixed version … Pin the version in package.json
```

`npm run pack` (electron-builder --dir) **exits 1**. §43 packaging gate fails regardless of code.

---

### 🟠 P2-3 — "Desktop E2E" does not run Electron; CI has no desktop job

- `tests/e2e/desktop-app.spec.ts` is a **chromium-browser** test against the Vite dev server (playwright.config.ts `webServer: npm run dev`), with a hand-injected mock: `page.addInitScript(() => { (window as any).openobDesktop = {...} })` (spec lines 80-95). Real Electron main/preload/IPC is **never executed by any automated test** — which is precisely why P0-1 shipped green.
- `.github/workflows/ci.yml` has no Electron step: no `build:desktop` execution, no `electron-builder`, no Windows job, no launch smoke.
- The integrity suite likewise drives the watcher by calling `runtime.watcher.handleFsEvent(...)` manually (test 4/5) rather than asserting on real `fs.watch` events.

**Impact:** §10/§21-§24/§29/§40 have **no automated coverage**; only static review here. A CI smoke job that launches the built app would have caught P0-1.

---

### 🟠 P2-4 — Remote CI is red for this exact tree

Locally I cannot observe GitHub Actions (§44 caveat), but CI's first step is `npm ci` (`.github/workflows/ci.yml:28`), which fails deterministically on this tree (§1 lockfile finding). `REMOTE CI UNVERIFIED IN THIS ENVIRONMENT` → **but deterministically broken at install**.

---

## 3. SECTION-BY-SECTION FINDINGS

| §     | Check                              | Verdict            | Evidence                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ---------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Baseline                           | ❌                 | §1 above (dirty tree + npm ci fails)                                                                                                                                                                                                                                                                                                                     |
| 2     | One canonical authority            | ✅ static          | `DesktopVaultRuntime.create` (`packages/desktop/src/desktop-runtime.ts:79-125`) constructs exactly one `NodeFsVaultStorage` + `SafeWriter` + `SqliteDocumentIndex` + `OpenObWorkspace`; watcher/gateway share the same instances; renderer holds no storage. No second disk writer anywhere (grep: renderer uses `MemoryVaultStorage` via browser stub). |
| 3     | Raw desktop writer search          | ✅                 | Renderer never constructs `NodeFsVaultStorage`/`SafeWriter`/`SqliteDocumentIndex`/`OpenObWorkspace`; vite aliases node-fs-storage → browser stub. Main constructs them only inside the one runtime.                                                                                                                                                      |
| 4     | Gateway instance                   | ✅ static          | `startGateway` is the shared implementation (`apps/gateway/src/server.ts:1395`), `assertLoopbackHost` enforced, `port: 0` → ephemeral. No forked copy.                                                                                                                                                                                                   |
| 5     | Session token                      | ✅                 | `OPENOB_DESKTOP_${crypto.randomUUID()}` (122-bit); not persisted: desktop config stores only windowBounds/lastVaultPath; `useVault.ts:703-710` skips `sessionStorage` when `openobDesktop` present; integrity test 2 + e2e scan storage/DOM/URL/vault files.                                                                                             |
| 6     | Electron security                  | ✅ static          | `nodeIntegration:false, contextIsolation:true, sandbox:true` (`apps/desktop/src/main.ts:198-203`).                                                                                                                                                                                                                                                       |
| 7     | Preload surface                    | ✅                 | 4 typed methods, fixed channels, no `ipcRenderer` exposure, no fs/exec/env (`apps/desktop/src/preload.ts`).                                                                                                                                                                                                                                              |
| 8     | Raw vault IPC                      | ✅                 | No read/write/delete/rename fs IPC in main; CRUD only via gateway HTTP.                                                                                                                                                                                                                                                                                  |
| 9     | IPC validation                     | ✅                 | Fixed handlers; malformed payloads can't reach privileged paths (no payload-driven logic).                                                                                                                                                                                                                                                               |
| 10    | Gateway vault flow (real Electron) | ❌                 | **P0-1 — app crashes at load; cannot create/edit anything.**                                                                                                                                                                                                                                                                                             |
| 11    | Plugin flow                        | ⚠️                 | Structurally correct (renderer `PluginHost` + `createWorkspacePluginHostServices(backend)` → gateway → single writer; `plugin-gateway.spec.ts` passes Daily Notes/Templates through the Gateway backend with OCC). Unreachable in real desktop (P0-1).                                                                                                   |
| 12    | AI flow                            | ❌                 | **P1-1 reproduced** (403). Renderer never receives raw keys ✅; local + cloud AI both dead in desktop.                                                                                                                                                                                                                                                   |
| 13    | Secure storage                     | ❌                 | **P1-2** (static key, unsurfaced load errors, Phase 3G regression).                                                                                                                                                                                                                                                                                      |
| 14    | Watcher single authority           | ✅                 | Watcher mutates only the shared derived index and publishes via `workspace.getEventPublisher()`; no second index.                                                                                                                                                                                                                                        |
| 15    | Self-write loop                    | ⚠️                 | Test 5 passes (hash-match dedup, single manifest entry). Note: tests force events manually; real `fs.watch` storm not stress-tested; dedup depends on workspace index-update ordering vs watcher echo.                                                                                                                                                   |
| 16    | External OCC                       | ✅                 | Test 6 + e2e `gateway-managed-web` #4: stale save → 409, V2 survives, editor buffer preserved.                                                                                                                                                                                                                                                           |
| 17    | External rename                    | ✅ static          | rename = delete+create events → index remove+upsert; UI `note.deleted` handler converges; no ghost path (not directly e2e-tested for rename).                                                                                                                                                                                                            |
| 18    | External delete                    | ✅                 | Watcher removes from index + publishes; `useVault.ts:501-535` keeps dirty buffer, marks externally deleted; e2e #5 (resurrection prevention) passes.                                                                                                                                                                                                     |
| 19    | Index disposability                | ✅                 | Test 7: delete `index.db`, restart → deterministic rebuild from Markdown.                                                                                                                                                                                                                                                                                |
| 20    | Vault switch                       | ✅                 | Test 9: old gateway/watcher torn down, events isolated. Real app path (main.ts `stopCurrentSession` → `startSessionForVault`) unreachable (P0-1).                                                                                                                                                                                                        |
| 21    | Single instance                    | ✅ static          | `app.requestSingleInstanceLock()` + focus forwarding (main.ts:34-44).                                                                                                                                                                                                                                                                                    |
| 22    | Crash/restart                      | ❌                 | Cannot start (P0-1); safe-writer + boot reconciliation logic exists but is unexercisable.                                                                                                                                                                                                                                                                |
| 23    | Gateway crash                      | ✅ static          | Renderer has no fallback disk writer; save failures → `disconnected` status (`useVault.ts:1110`); no blind local writes. Caveat: if the gateway is unreachable **at boot**, desktop falls through to the in-memory seed vault (`useVault.ts:836-842`) — confusing ghost state, P3 (no disk writes though).                                               |
| 24    | Clean exit                         | ✅ static          | `before-quit` → `stopCurrentSession()` → runtime.close (checkpoint, watcher stop, index close) + gateway.stop (closeAllConnections).                                                                                                                                                                                                                     |
| 25    | CSP                                | ❌                 | **P2-1** — none present; report claim false.                                                                                                                                                                                                                                                                                                             |
| 26    | Navigation                         | ✅ static          | `will-navigate` blocks non-gateway/dev origins; `setWindowOpenHandler` denies all, opens http/https externally (main.ts:211-228).                                                                                                                                                                                                                        |
| 27    | External links                     | ✅                 | Only http/https routed to `shell.openExternal`; javascript:/file: rejected.                                                                                                                                                                                                                                                                              |
| 28    | Package content                    | ⚠️                 | `files` whitelist excludes tests/.env/fixtures/vaults ✅; but includes `node_modules/**/*` wholesale (dev-dep bloat risk) and omits `packages/*/src` (compounding P0-1 in asar). No artifact produced to fully inspect.                                                                                                                                  |
| 29    | Windows artifact                   | ❌                 | **P2-2** electron-builder refuses version range; would crash on launch anyway (P0-1). No dev-server dependency by design (loads from gateway) ✅.                                                                                                                                                                                                        |
| 30    | Offline start                      | ⚠️                 | Design is local-first ✅; external Google Fonts CDN degrades gracefully; unverifiable at runtime (P0-1).                                                                                                                                                                                                                                                 |
| 31    | MCP same workspace                 | ✅                 | External MCP connects to the same embedded gateway/workspace instance (shared server impl); mcp-stdio suite (10 tests) passes against live gateway.                                                                                                                                                                                                      |
| 32-34 | MCP/plugin/AI concurrency          | ✅                 | OCC enforced in workspace (SafeWriter); 409 flows covered by tests 6, e2e #4, plugin-gateway spec. Desktop-specific paths unreachable (P0-1).                                                                                                                                                                                                            |
| 35    | Saved views/table/board            | ✅                 | Phase 3D/3E/3F suites + e2e (saved-views-board, table-mutations) all pass in browser mode; no desktop-mode regression observable (P0-1).                                                                                                                                                                                                                 |
| 36    | Secret leak scan                   | ✅ static          | No raw token/key in config, vault corpus, logs, or browser storage; gateway redacts secrets in errors (`server.ts:916-917, 990-991, 1101-1104`); masks via `getMaskedSecret`.                                                                                                                                                                            |
| 37    | No duplicate desktop AI            | ⚠️                 | No separate cloud AI authority in renderer (GatewayAIBackend only) ✅ — but AI is 403-dead (P1-1).                                                                                                                                                                                                                                                       |
| 38    | No duplicate plugin authority      | ✅                 | Plugins are backend-driven via `plugin-services.ts`; writes through gateway; no desktop-local ghost writer.                                                                                                                                                                                                                                              |
| 39    | Reserved metadata regression       | ✅                 | `isReservedWorkspacePath` is case-insensitive (`packages/core/src/path.ts:118-144`, `toLowerCase`), enforced in workspace note APIs and plugin services (commit 8e08150).                                                                                                                                                                                |
| 40    | Full real user flow                | ❌                 | App cannot launch (P0-1).                                                                                                                                                                                                                                                                                                                                |
| 41    | Performance sanity                 | ⚠️                 | `scale-benchmark.test.ts` passes (1,000 real files → parse/rebuild/search/backlinks/graph 7.8s; 10,000 synthetic docs engine-only 1.2s). 10k-note **desktop startup** (full first-boot rebuild blocks `initialize`) unmeasured; watcher runs a full `getSourceManifest()` per event (`desktop-runtime.ts:346`) — scaling concern.                        |
| 42    | Full clean gate                    | ❌                 | format:check ✅ · lint ✅ (8 warnings) · typecheck ✅ · unit ✅ 416/416 · build ✅ · e2e ✅ 35/35 (browser) · **npm ci ❌** · **desktop pack ❌**. `verify:full` cannot pass.                                                                                                                                                                            |
| 43    | Packaging gate                     | ❌                 | **P2-2** + P0-1.                                                                                                                                                                                                                                                                                                                                         |
| 44    | Remote CI                          | ❌ (deterministic) | ci.yml step 1 `npm ci` fails on this tree; no desktop job exists. Exact-SHA job observation not possible here.                                                                                                                                                                                                                                           |
| 45    | Severity                           | —                  | See §4.                                                                                                                                                                                                                                                                                                                                                  |
| 46    | Output                             | ✅                 | This document.                                                                                                                                                                                                                                                                                                                                           |

---

## 4. FINDINGS REGISTER (severity per §45 rubric)

| ID   | Sev                                                                                  | Finding                                                                                                                                                                                   | Fix owner                                                                         |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P0-1 | **P0 / release blocker** (desktop entirely non-functional; every runtime gate fails) | Electron main crashes at load — `@okw/*` packages resolve to TS source; desktop main is un-bundled tsc output (`ERR_MODULE_NOT_FOUND … src/types.js`)                                     | Gemini (architecture): bundle desktop like gateway (esbuild) or ship dist exports |
| P1-1 | **P1** (AI flow broken in desktop; plugin AI too)                                    | Embedded gateway started without `workspace.ai.use`/`workspace.ai.configure` → 403 on all `/api/v1/ai/*`                                                                                  | Gemini: pass scopes in `main.ts`                                                  |
| P1-2 | **P1** (secret/token exposure)                                                       | Static derivable master key (`okw-desktop-master-<userData>`); no user passphrase, no OS binding; `getLoadError()` never surfaced (P1-SEC-001 still open)                                 | Gemini/architecture: `safeStorage` or real passphrase + surface load errors       |
| P1-3 | **P1** (clean-install infra)                                                         | `npm ci` fails: `package-lock.json` missing `@okw/desktop-app@0.1.0`                                                                                                                      | Gemini: regenerate lockfile (commit)                                              |
| P2-1 | **P2**                                                                               | No CSP anywhere; report's CSP claim false; Google Fonts CDN                                                                                                                               | Gemini                                                                            |
| P2-2 | **P2**                                                                               | electron-builder refuses `^43.4.0` range                                                                                                                                                  | Gemini: pin exact electron version                                                |
| P2-3 | **P2**                                                                               | No real-Electron test; CI has no desktop job; watcher tests force events manually                                                                                                         | Gemini: add electron smoke job (would have caught P0-1)                           |
| P2-4 | **P2**                                                                               | Remote CI deterministically red at `npm ci`                                                                                                                                               | covered by P1-3                                                                   |
| P3-1 | P3                                                                                   | Static-file path-prefix check `targetFile.startsWith(webDistDir)` lacks trailing separator (`server.ts:232`) — escape requires a sibling dir named `dist*`; tighten to `webDistDir + sep` | Gemini                                                                            |
| P3-2 | P3                                                                                   | Watcher drops event on transient double-read failure (`desktop-runtime.ts:337-341` "marked dirty" but no resync loop)                                                                     | Gemini                                                                            |
| P3-3 | P3                                                                                   | Full `getSourceManifest()` per watcher event; 10k-note first-boot rebuild blocks startup                                                                                                  | Gemini (perf)                                                                     |
| P3-4 | P3                                                                                   | Dead legacy `DesktopIpcBridge` / `NativeIpcChannel` surface (unwired; exported from `@okw/desktop`)                                                                                       | Gemini                                                                            |
| P3-5 | P3                                                                                   | Desktop boot fallback into in-memory seed vault when gateway unreachable at boot (`useVault.ts:836-842`) — ghost state UX hazard                                                          | Gemini                                                                            |
| P3-6 | P3                                                                                   | `lint` 8 `react-hooks/exhaustive-deps` warnings                                                                                                                                           | Gemini                                                                            |

---

## 5. VERIFIED vs UNVERIFIABLE

- **Verified by execution:** unit 416/416; e2e 35/35 (browser); format/lint/typecheck/build; AI-403 reproduction; npm ci failure; electron-builder failure; Electron boot crash.
- **Verified statically:** single-writer architecture, preload/IPC surface, token non-persistence, navigation hardening, `.openob` guard, OCC paths, secret redaction/masking.
- **Unverifiable in this environment (documented, not asserted):** real-Electron interactive flows (§10, §16-§18, §21-§24, §29, §40), Windows installer install/launch (§29), offline network cut (§30), remote CI jobs (§44), packaged-artifact content inspection (§28 — artifact never produced).

---

## 6. RECOMMENDED REMEDIATION ORDER

1. **P0-1** — bundle desktop main/preload (esbuild, mirror `apps/gateway/build.js`); add a CI Electron smoke job that launches the built app and curls its loopback `/health`.
2. **P1-1** — add AI scopes to the desktop `startGateway` call; add an AI integration test against a desktop-style gateway.
3. **P1-3** — regenerate `package-lock.json` (commit `@okw/desktop-app`).
4. **P2-2** — pin `electron` to an exact version; re-run `npm run pack`.
5. **P1-2** — architecture decision: `safeStorage` vs user passphrase; surface `getLoadError()`.
6. **P2-1** — add CSP (meta tag in `index.html` and/or header in `createGatewayServer`); remove/self-host Google Fonts.
7. P3 items as time allows.

After 1-6 land: re-run this audit end-to-end (including the full clean gate from a fresh `npm ci`), then re-evaluate the **Dogfood / Public Alpha** verdict. **No new architecture phase.**
