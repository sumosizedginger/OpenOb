# OPENOB PUBLIC-RELEASE HARDENING ADVERSARIAL AUDIT

**BASELINE:** `bbfcd696121df765c444085701705a7466dd0817`
**HEAD:** `247415949f12deae3336e6741c8ab62b21da5138` (== origin/main)
**COMMITS AUDITED:** `5c6e4df` (security/contributing/changelog docs), `d0b526c` (release pipeline + CodeQL + cross-platform smoke), `2474159` (libfuse deps for Linux smoke)
**TREE STATE:** clean (0) + this report; no production code changed in the pass (docs/workflows/electron-builder.json only).

---

## ACCESS AUTHORITY

**HUMAN WRITE ACCESS:** Single author per observable history (100 commits, one identity). Collaborator/team list **unverified** (auth-required endpoints; unauthenticated API rate-limited).
**MACHINE WRITE ACCESS:** No GitHub Apps/deploy keys observable. Workflows declare explicit least privilege (below).
**WORKFLOW WRITE ACCESS:** `ci.yml`: workflow-level `permissions: contents: read` (new). `pages.yml`: `contents: read`, `pages: write`, `id-token: write`. `codeql.yml`: `contents: read`, `security-events: write`. `release.yml`: `contents: read` + publish job `contents: write` (tag-guarded). Every write has a concrete purpose; no workflow-wide `contents: write`.
**BYPASS ACCESS:** Rulesets/admin bypass **unverified** (auth-required).
**WHO CAN PUSH TO MAIN:** The repository owner (sole author in history). Public users get read/fork/issue/PR access only — no push rights. Collaborator/ruleset state unverified from this environment.

## MAIN PROTECTION

**FORCE-PUSH BLOCKED / DELETION BLOCKED:** **UNVERIFIED** (branch-protection/ruleset APIs auth-required). No in-repo document claims protection was applied, so there is no false-closure claim to break.
**OWNER DIRECT PUSH PRESERVED:** YES — all 100 commits pushed directly; Pages deploy and CI still trigger on push (nothing broken by any setting).
**PR REQUIRED / APPROVAL:** No PR workflow in history (solo direct-push); no corporate ceremony introduced.

## ACTIONS

**DEFAULT TOKEN:** repo setting unverified (auth), but every workflow declares least privilege — the practical requirement.
**CREATE/APPROVE PR PERMISSION:** No workflow requests it (setting unverified).
**CI / PAGES / RELEASE / CODEQL PERMISSIONS:** read-only / read+pages+id-token / read(+tag-guarded publish write) / read+security-events — all correct.

## SECRET HISTORY (Audit 5)

**COMMITS SCANNED:** 100 (full `git log --all -p`, 134,981 lines).
**CANDIDATES:** ~15 credential-shaped strings — all **test fixtures** (`SECRET_OPENOB_TOKEN`, `sk-test-ai-key-12345678`, `test-token-*`, `wrong-token-invalid`, `mcp-*-token`, redaction-test fake keys `sk-proj-verysecretkey…`, `AIzaSyD-1234567890…`) + 2 scanner-pattern hits (the repo's own security grep).
**REAL SECRETS:** **0**.
**RESULT:** CLEAN. No rotation/history-remediation required.

## PRIVACY (Audit 6)

**PUBLIC AUTHOR EMAIL EXPOSED:** YES — personal address `Donttouchmyshit420@gmail.com` in all 100 commits (public cloneable history). GitHub UI masks it, raw git does not.
**FUTURE NOREPLY CONFIGURED/RECOMMENDED:** not configured, not documented — **MINOR** (recommend future commits use the GitHub noreply identity; no history rewrite required or recommended).
**HISTORY REWRITTEN:** NO.

## RELEASE HISTORY (Audit 7)

**REAL v0.1.0 RELEASE PREEXISTED:** NO. **REAL v0.1.0 TAG PREEXISTED:** NO (0 tags in the repo, `git ls-remote --tags`).
**CHANGELOG FABRICATION:** NO — `CHANGELOG.md` contains only `## [Unreleased]` with capabilities; no `[0.1.0]` section, no fake dates. Package version 0.1.0 is correctly not treated as release evidence.

## PUBLICATION (Audits 8/44/49)

**NEW TAG / NEW GITHUB RELEASE / NPM PUBLISH:** NONE (0 tags; releases page empty; no `npm publish`/`pnpm publish` anywhere in workflows).
**MANUAL DISPATCH CAN PUBLISH ARBITRARY HEAD:** **NO** — `release.yml` publish job is guarded by `if: startsWith(github.ref, 'refs/tags/v')`; a `workflow_dispatch` on a branch runs build+verify only (dry run) and cannot create a Release.
**PUBLIC RELEASE CREATED DURING TASK:** NO.

## PLATFORM SUPPORT (Audit 11/39)

**WINDOWS:** Release-Verified — truthful (NSIS + Portable release gate previously executed; job green).
**MACOS:** "CI Build-Verified" — truthful: `package-macos-smoke` (macos-latest, Node 24, `electron-builder --mac dmg zip -c.mac.identity=null`, artifact validation) is **GREEN** remotely.
**LINUX:** README claims **"CI Build-Verified"** but `package-linux-smoke` is **RED** (fails at `Package Linux Distributable (AppImage & tar.gz)`; the `2474159` libfuse fix did not resolve it) → **FALSE CLAIM** (MATERIAL).

## SIGNING (Audit 12)

**WINDOWS AUTHENTICODE:** **UNSIGNED** — truthfully disclosed in README ("unsigned; SmartScreen may show unknown publisher").
**MACOS SIGNED:** NO. **NOTARIZED:** NO — truthfully disclosed ("unsigned and unnotarized in developer preview").

## RELEASE PIPELINE (Audits 9/24/25/26/30)

Tag trigger `v*` ✓; manual dispatch = dry-run ✓; Node 24 + clean `npm ci` ✓; `verify:desktop:release` in-gate ✓; SHA-256SUMS generated and attached ✓ (Get-FileHash in build job, uploaded with artifacts); Windows installer + portable from the gate ✓; `--prerelease` releases, `--generate-notes` ✓; failure propagates ✓; no npm publish ✓; no silent tag creation ✓; least privilege ✓; version extraction `v0.1.0 → 0.1.0` semantics sane ✓; all package versions consistent `0.1.0` (12 manifests) ✓. Pages deploy unaffected (green). Structurally ready; **blocked from "ready" only by the red Linux smoke + red Node 22 lane.**

## SECURITY

**SECURITY.md:** covers vault integrity/OCC, gateway loopback+scopes, MCP sandboxing, path traversal, credential encryption, plugin capability gating ✓; supported-version table honest (main pre-release only).
**PRIVATE VULNERABILITY REPORTING:** **ENABLED** — observed on the live security page ("Report a vulnerability" present); SECURITY.md instructions match the real feature (not a fake mailbox).
**CODEQL:** enabled (push main / PR main / weekly), JS/TS, least-privilege, **GREEN** remotely.
**DEPENDENCY VULNERABILITIES:** `npm audit` → **0 vulnerabilities**.

## OSS HYGIENE (Audits 15/16/17/31/32/33/34/41)

**CONTRIBUTING.md:** prerequisites (Node 24 LTS, 22 compat), fork→clone→`npm ci`→verify→PR path, architectural invariants, security expectations, inbound license "contributions licensed under the project's MIT License" (MIT-compatible), tests-required expectation. No CLA/DCO/signing.
**TEMPLATES:** bug form (version, OS, reproduction, expected/actual, logs, security-routing note — reasonable field count), feature form, PR template (summary, tests/`verify:full`, data-safety, no secrets) — no ceremony.
**DEPENDABOT:** valid syntax, npm + github-actions weekly, dev-deps grouped, `open-pull-requests-limit: 5`, no auto-merge ✓.
**LICENSE:** `LICENSE` untouched (canonical MIT, byte-identical to prior verified state); no contradictory terms introduced in any new file.
**NO** CLA, DCO, Code-of-Conduct, semantic-release, merge queue, telemetry, or other overengineering introduced.

## README (Audits 20/45/48)

Live demo link real (200) ✓; CI/Pages badges ✓; Windows/macOS truthful; **Linux claim false (job red)**; no fake download links (no Downloads section; install-from-source only) ✓; signing disclosed ✓; security/contributing/changelog/constitution links ✓; documented commands all exist (`verify:full`, `test:desktop`, `verify:desktop:release`, `test:e2e`, `test:e2e:electron` verified in package.json) ✓.

## CLEAN ROOM (Audit 22) — **MATERIAL FAILURE**

Fresh `git clone` (HEAD 2474159) on Windows → `npm ci` OK → **`verify:full` FAILS at format:check: "Code style issues found in 393 files"** (`tsconfig.json`, `vitest.config.ts`, etc.). Root cause proven by byte analysis: default Git-for-Windows `core.autocrlf=true` checks out **CRLF**; prettier (LF default) rejects every file; `core.autocrlf=false` → LF → format:check passes. The repo has **no `.gitattributes`** and CONTRIBUTING documents no workaround → a Windows contributor following the documented path cannot pass `verify:full` without undocumented local state.

## AUDIT DOCUMENTS

Not relocated; all links resolve (README/docs/AGENTS untouched by the pass); no unnecessary churn. ✓

## CLOSED SYSTEMS (no new regression evidence except noted)

Node 24 ✓ green · **Node 22 ✗ RED (recurring — 4th failure across commits; green on `bbfcd69`, red again on `2474159` without any related change → unobserved flake recurrence)** · Windows Node 24 gate ✓ green · Windows Electron ✓ · Playwright ✓ · Pages ✓ live (200) · Benchmark: unchanged (`median-of-5`, 10,000 docs, 500 ms budget, measured locally 198.5 ms median) ✓ not weakened · MIT ✓ · Gateway lifecycle ✓ unchanged (bin files untouched since `ca7e370`).

## REMOTE CI (observed via API, run for HEAD `2474159`, attempt 1)

| Job                                      | Conclusion                    |
| ---------------------------------------- | ----------------------------- |
| Node 24.x — Typecheck, Test & Build      | success                       |
| **Node 22.x compatibility**              | **failure** (Run Test Suites) |
| Windows Node 24 Gateway Runtime Tests    | success                       |
| macOS Desktop Packaging Smoke Test       | success                       |
| Electron Desktop Packaging & Windows E2E | success                       |
| Playwright Browser E2E                   | success                       |
| **Linux Desktop Packaging Smoke Test**   | **failure** (Package step)    |
| GitHub Pages build/deploy                | success                       |
| CodeQL                                   | success                       |

---

## FINDINGS

| #   | Class        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | **MATERIAL** | **Linux packaging smoke job is RED** (`ci.yml` `package-linux-smoke`, step "Package Linux Distributable") — the `2474159` libfuse fix did not fix it, and the README simultaneously claims "Linux: **CI Build-Verified**" — a false platform claim (Audit 11/42). Impact: cross-platform claim unsupported; release gate not fully green. Fix: obtain the failing log (AppImage tool/deps), make the job green (e.g., correct libfuse handling or build-only validation), and only then keep the README wording. |
| F-2 | **MATERIAL** | **Node 22 compatibility lane RED at HEAD** ("Run Test Suites") — 4th recurrence across commits despite the benchmark stabilization (green on `bbfcd69`; red again with no Node-22-related change). Exact assertion unobservable (logs 403). Impact: required preexisting CI not green. Fix: capture the actual failing assertion with log access; if it is benchmark variance, confine the perf gate to the Node 24 lane or further stabilize Node 22 sampling.                                                  |
| F-3 | **MATERIAL** | **Windows clean-room `verify:full` fails out of the box** (393 prettier failures from CRLF checkout; no `.gitattributes`; CONTRIBUTING silent). Impact: documented contributor path broken on the primary platform. Fix: add `.gitattributes` (`* text=auto eol=lf`), verify a fresh Windows clone passes format:check, and note it in CONTRIBUTING if any environment nuance remains.                                                                                                                           |
| F-4 | MINOR        | Personal email exposed in all public commits; no noreply guidance added (Audit 6). Fix: document/configure GitHub noreply for future commits; no rewrite.                                                                                                                                                                                                                                                                                                                                                        |

---

## VERDICT

# OPENOB PUBLIC-RELEASE HARDENING NOT CLOSED — FIX REQUIRED

Governance, documentation, security reporting, release-pipeline design, secret hygiene, licensing, and scope are all verified sound — but three MATERIAL items block closure: the **Linux packaging smoke job is red while README claims it is CI build-verified** (F-1), the **Node 22 compatibility lane is red again** (F-2), and the **Windows clean-room contributor path fails `verify:full`** (F-3). A stranger following the documented path cannot currently verify the project on Windows, and two required CI lanes are not green.

**UNEXPECTED HUMAN WRITE ACCESS: NO** · **UNEXPECTED MACHINE WRITE ACCESS: NO** · **WHO CAN PUSH TO MAIN: owner (single-author history; collaborator/ruleset unverified — auth-required)** · **MAIN FORCE-PUSH PROTECTED: UNVERIFIED** · **MAIN DELETION PROTECTED: UNVERIFIED** · **OWNER DIRECT PUSH PRESERVED: YES** · **ACTIONS DEFAULT READ-ONLY: unverified setting, all workflows least-privilege** · **ACTIONS CAN CREATE/APPROVE PRS: NO** · **PRIVATE VULNERABILITY REPORTING WORKS: YES** · **FULL-HISTORY SECRET SCAN CLEAN: YES** · **REAL v0.1.0 RELEASE PREEXISTED: NO** · **FAKE RELEASE HISTORY INTRODUCED: NO** · **ACCIDENTAL RELEASE/TAG CREATED: NO** · **MANUAL DISPATCH CAN PUBLISH ARBITRARY HEAD: NO** · **WINDOWS RELEASE VERIFIED: YES** · **MACOS BUILD VERIFIED: YES** · **LINUX BUILD VERIFIED: NO** · **WINDOWS SIGNED: NO** (disclosed) · **MACOS SIGNED: NO** · **MACOS NOTARIZED: NO** · **TAGGED RELEASE PIPELINE READY: YES (structurally; Linux/Node 22 lanes red)** · **PUBLIC RELEASE CREATED DURING TASK: NO** · **SECURITY REPORTING READY: YES** · **CONTRIBUTOR PATH READY: NO** (F-3) · **DEPENDENCY AUTOMATION READY: YES** · **CODEQL GREEN: YES** · **PAGES LIVE: YES** · **NODE 24 PRIMARY GREEN: YES** · **NODE 22 COMPATIBILITY GREEN: NO** · **WINDOWS NODE 24 GATE GREEN: YES** · **WINDOWS ELECTRON GREEN: YES** · **PLAYWRIGHT GREEN: YES** · **PERFORMANCE BUDGET: 198.5 ms median (local, < 500 ms)** · **PERFORMANCE GATE WEAKENED: NO** · **MIT LICENSE UNCHANGED: YES** · **ALL PREEXISTING REQUIRED CI GREEN: NO** (Node 22) · **ALL NEW REQUIRED HARDENING CI GREEN: NO** (Linux smoke)
