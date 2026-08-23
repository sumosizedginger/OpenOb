# OPENOB GITHUB PAGES ADVERSARIAL AUDIT

**Mode:** AUDIT ONLY — no files modified (except temp probe fixtures, all removed), no commits.
**Target:** committed main `f3b75c1e3ba09d1b0133731f2910b9791681f9c0` (== origin/main, tree clean). Pages commits after `e3b6da9`: `7569134 "feat(web): deploy OpenOb to GitHub Pages"`, `f3b75c1 "fix(ci): refine GitHub Pages workflow schema"`.
**Deployment target:** `https://sumosizedginger.github.io/OpenOb/` (must work from `/OpenOb/`).
**Environment:** Windows 10, Node 22, Chromium 1.62.1 (~Chrome 141).

---

## AUDIT 1 — Changed scope — PASS

Pages commits touch only: `.github/workflows/pages.yml` (new), `apps/web/src/App.tsx` (+3/-3), `onboarding/LearnCenterModal.tsx`, `WelcomeModal.tsx`, `utils/assets.ts` (new), web tests (`pages-smoke.spec.ts`, `github-pages-deployment.test.ts` new; 1-line updates to onboarding-tour/brand-assets). **No Electron runtime, desktop packaging, release verification, security boundary, or other-workflow changes.** Scope stayed Pages-specific.

## AUDIT 2 — Base path — PASS

`apps/web/vite.config.ts`: `base: process.env.VITE_BASE_PATH || './'`; `pages.yml` sets `VITE_BASE_PATH: /OpenOb/`. Built output (proven from `dist/index.html` with the base set natively): entry JS `/OpenOb/assets/index-*.js`, CSS `/OpenOb/assets/index-*.css`, modulepreloads `/OpenOb/assets/…`, favicons `/OpenOb/favicon.ico` etc. (Note: building from git-bash mangles `/OpenOb/` via MSYS path conversion into `/Program Files/Git/OpenOb/` — a **local shell artifact only**; CI builds on Ubuntu where the env is native. Not a product issue.)

## AUDIT 3 — Root-relative path sweep — PASS

Source: no `src="/`, `href="/`, `fetch('/`, `url(/`, hardcoded `/brand`, `/favicon`, `/assets`, `/api` anywhere in `apps/web/src` (only `window.location.origin` in `GatewayConnectModal.tsx:31-32` — an intentional gateway-connect UI). Built JS: the only root-absolute strings are memory-FS virtual paths (`/dev`, `/tmp`, `/home/web_user`) from the standalone storage shim — internal paths, never issued as HTTP requests. **Harmless.**

## AUDIT 4 — index.html — PASS (proven from built output)

Source uses root-absolute favicon/apple-touch-icon hrefs; **Vite rewrites all of them** in the built HTML: `href="/OpenOb/favicon.ico"`, `/OpenOb/favicon-32x32.png`, `/OpenOb/favicon-16x16.png`, `/OpenOb/apple-touch-icon.png`. Script/CSS → `/OpenOb/assets/…`. No `<base>` emitted (so `base-uri 'self'` is trivially satisfied). No root-host assumption.

## AUDIT 5 — CSP — PASS (one MINOR)

Meta CSP permits everything the Pages app needs: `script-src 'self'` (all scripts are built assets), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `font-src 'self' data:`, `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*`. The full boot test produced **zero CSP violations**. MINOR: `frame-ancestors 'none'` is **ignored when delivered via a `<meta>` element** (Chromium console warning) — it only takes effect as an HTTP header, which GitHub Pages static hosting cannot set. Dead directive; no Pages feature blocked; no weakening recommended.

## AUDIT 6 — Standalone browser mode — PASS

No hard dependency on `window.openobDesktop` (all usages guarded with `?.`; standalone branch at `useVault.ts:717` when no bridge). Plain-Chromium boot of the Pages build rendered the full app (title, root content, logo) with no bridge, no Node FS, no preload, no gateway-served dist. Usable within intended limitations.

## AUDIT 7 — Gateway mode from Pages — FALSE ALARM (loopback), empirically proven

Chromium (141) permits an **HTTPS origin to connect to loopback HTTP/WebSocket** — loopback is a "potentially trustworthy" origin, exempt from mixed-content blocking, and current PNA enforcement does **not** preflight public→loopback. Executable evidence (real Chromium): `fetch('http://127.0.0.1:<port>/api/...')` from an https page with the gateway's exact CORS headers → **200 OK** (no `Access-Control-Allow-Private-Network` needed); `new WebSocket('ws://127.0.0.1:<port>/ws')` → **opened**, zero blocking logs. CSP already permits both. Caveat (non-blocking): the standalone Pages app does not auto-connect a gateway (no token source in browser mode); gateway use from Pages is opt-in via the connect modal and remains a desktop/gateway-served capability.

## AUDIT 8 — pages.yml — PASS

Trigger `push: [main]` + `workflow_dispatch`; permissions `contents: read / pages: write / id-token: write` (minimal); concurrency group `pages` (no cancel — safe for deploy); ubuntu-latest, node 22, `npm ci`; runs `format:check`, `lint`, `typecheck`, `npm test` (no gate removal); `VITE_BASE_PATH=/OpenOb/ npm run build:web`; `configure-pages@v5` → `upload-pages-artifact@v3 (path: apps/web/dist)` → `deploy-pages@v4` (`needs: build`). Artifact = static web output only; no secrets in the workflow; no brittle cwd assumptions (commands run from repo root).

## AUDIT 9 — Existing CI regression — PASS

`e3b6da9..HEAD` touches no `ci.yml`, no `electron-builder.json`, no `verify-desktop-release.mjs`. Node 20/22 matrix, browser E2E, Electron E2E, Windows release gate, screenshot-harness routing all untouched.

## AUDIT 10 — Production build proof — PASS (local simulation; live site 404)

Built with `VITE_BASE_PATH=/OpenOb/` and served under an `/OpenOb/` subpath (exact Pages semantics, static `python http.server`): **`GET /OpenOb/` → 200**, title `OpenOb`, React app rendered, brand logo loaded (`/OpenOb/brand/openob-mark.png`), **zero failed requests** (all JS/CSS/favicon/assets resolve), **refresh works** (no router → no subpath-404), screenshot captured. Favicon requested at `/OpenOb/favicon.ico` (correct).

## AUDIT 11 — Pages status — **MATERIAL**

Distinguish the five claims: (1) code ready — **yes** (committed `f3b75c1`); (2) workflow green — **unverifiable** (private repo, Actions API 404); (3) Pages deployment green — **unverifiable**; (4) site actually reachable — **NO**: `https://sumosizedginger.github.io/OpenOb/` returns **404** (root and favicon); (5) app actually booting — proven by local simulation, not remotely. Root cause: `api.github.com/repos/sumosizedginger/OpenOb` → **404 = repository is not publicly visible**; GitHub Free does not publish Pages from private repositories. **The site cannot be publicly reachable in the current repo state.** This is a repo-visibility/ownership action, not a code defect.

## AUDIT 12 — Security / data truth — PASS

Pages artifact scanned: no `sk-*`, bearer-token, AWS, or API-key patterns; **no source maps** (`.map` absent — Vite emits none by default); no `.env`/secret/token files; artifact contains only static web output (favicons, brand, assets, index.html).

---

## FINDING REGISTER

| #   | Class        | Finding                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1 | **MATERIAL** | Live deployment not reachable — `https://sumosizedginger.github.io/OpenOb/` 404; repo not publicly visible (API 404) → GitHub Free cannot publish Pages from a private repo. Code/CI correct; publication blocked by repo visibility. Fix: make the repo public (or enable private Pages on a paid plan), then confirm the workflow + site live. |
| F-2 | **MINOR**    | `frame-ancestors 'none'` in the meta CSP is ignored by Chromium (only honored via HTTP header, impossible on static Pages). Remove the directive from the meta or accept it as documentation-only.                                                                                                                                               |
| F-3 | **MINOR**    | Windows/git-bash builds mangle `VITE_BASE_PATH=/OpenOb/` into `/Program Files/Git/OpenOb/` (MSYS path conversion). Harmless for CI (Ubuntu) but worth `MSYS2_ARG_CONV_EXCL="VITE_BASE_PATH"` documentation for local Windows verification builds.                                                                                                |

## VERDICT

# GITHUB PAGES VERIFIED WITH NON-BLOCKING FINDINGS

The implementation is correct and proven: base path `/OpenOb/` applied to every asset, favicons rewritten by Vite, CSP compatible (only a dead `frame-ancestors` meta directive), standalone browser mode fully functional under a subpath (boot, logo, refresh, zero 404s), loopback gateway connectivity is browser-permitted (empirically tested fetch+WebSocket), no CI/gate regression, no secrets in the artifact. **The single MATERIAL item is not a code defect**: the deployed site is unreachable because the repository is not publicly visible — publishability is an ownership action (make repo public / paid Pages), after which the committed workflow deploys the verified artifact. No further code change required for the app itself.
