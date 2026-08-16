# OpenOb — Post-Write-Coordinator Adversarial Audit

Repository: https://github.com/sumosizedginger/OpenOb
Audit type: read / test / analyze only. **No production code modified.** Temporary probes (Playwright + Chromium 1228 against the real `useVault` + real `NoteWriteCoordinator` with prototype-patched write latency; vitest probes with real modules and mocked `fs`) were used and removed. The user-supplied parallel probes (`tests/_reaudit-tmp/{lifecycle,waiter,indexmismatch}.test.ts`) were inspected; they corroborate the findings below (their 3 failures are test bugs — uncaught `ConflictError` rejections and an undefined variable — not production defects).

---

## 1. Exact audited SHA

- **HEAD:** `8ac85eaf258129792cc56c625054de60b8690231` (matches the expected SHA).
- Remediation commit under audit: `8ac85ea` "fix(persistence): implement NoteWriteCoordinator, Playwright E2E suite, degraded reconciliation state, and secret queue unpoisoning (G1-G8)" — 20 files, +1566/−389 vs the previously audited `4f573aa`.

## 2. Baseline / CI

- Working tree clean (only the two audit outputs + `tests/_reaudit-tmp` untracked). Node v22.23.1, npm 11.4.2.
- `npm ci`: 0 vulnerabilities. `npm run typecheck`: PASS. `npm run build`: PASS (main 200.32 kB + react-vendor 168.30 kB gzip 60.90/50.91 — the 874 kB chunk split landed).
- `npm test` (permanent suite, `_reaudit-tmp` excluded): **43 files / 153 tests, all passing** (7.5 s).
- `npm run test:e2e`: **5 Playwright tests passing** (19.1 s) — real Chromium, real app.
- CI (`ci.yml`): Node 20/22 test job (npm ci → boundary greps → typecheck → npm test → build) + a real **Playwright e2e job** (`npx playwright install --with-deps chromium` + `npm run test:e2e`).

## 3. Coordinator architecture assessment

`NoteWriteCoordinator` (packages/vault/src/note-coordinator.ts, 359 lines) is per-note state (`bufferContent`, `bufferGeneration`, `committedSnapshot`, `saveStatus`, `waiters`) + a per-note `pump` loop: reads the current buffer, writes via `SafeWriter` with `expectedVersion = committedSnapshot.version` (or force), updates `committedSnapshot` from the write result, drains waiters, loops if the buffer changed. React state is decoupled (listeners mirror coordinator state). The design is sound and fixes the previous F1/F3 classes: **A1, A2/A3 (5/5), A4 all pass on the real hook with real latency** — the old false-conflict/silent-edit-loss bugs are genuinely gone.

Two remaining design defects (detailed below): the **waiter-drain semantics** (save promise resolves before the requested state is durable) and the **index-update consequence** (parse/upsert with a stale hash).

## 4. Playwright credibility assessment

The e2e job is REAL (Chromium, real app, real hook). But the concurrency tests **do not reproduce the targeted races**:

- No controlled storage latency anywhere — `tests/e2e/browser-concurrency.spec.ts` "A2 & A3: Slow save exceeding debounce" types v1, presses Ctrl+S, types v2, waits 3 s. The production write completes in milliseconds; the save never overlaps the 2000 ms debounce. This test would pass on the pre-coordinator buggy code.
- No disk read-back assertions — tests assert DOM text + `.save-status` only; nothing verifies the actual storage content.
- Verdict: **insufficient as race coverage** (A1-A4, B/B2, property, AI cases need the latency seam + disk assertions). Per-commit/scheduled split recommended below.

## 5. A1–A4 (real hook, real latency)

Via a temporary prototype-patched slow-write seam (750/1500/3200 ms) on the real `useVault` + real `NoteWriteCoordinator`, asserting DISK state:

- **A1 (750 ms < debounce): PASS** — disk == v2, buffer == v2, clean only when disk == buffer, no false conflict.
- **A2/A3 (3200 ms > debounce): PASS 5/5** — disk EXACTLY == v2, `saveStatus == saved`, `dirty == false`, no false ConflictError. The version-chain pump works.
- **A4 (v1→v2→v3→v4 overlapping): PASS** — disk EXACTLY == v4, clean, saved, no conflict; no intermediate completion falsely marks clean.

## 6. Waiter semantics (s.3)

**FINDING W1 (P1, web) — save(v2) resolves with snapshot(v1) before v2 is durable.** The pump drains ALL queued waiters after each physical write with THAT write's snapshot. Forced sequence (buffer=v1, `save(v1)` pending, buffer=v2, `save(v2)` queued): both promises resolve when v1's write completes, **both with the v1 snapshot**; disk is still v1 at that moment; the pump's second iteration writes v2 with **no waiter attached**. Proven: `p2 resolved with v1-snapshot? true | disk is v2 at p2-resolution time? false`.

- `save()` currently means **(A) "at least one save cycle completed"**, not **(B) "the buffer state associated with this request has been durably committed"**.
- Production callers expect ~B. The caller-visible consequence is W2 below.

## 7. Save-promise completion contract (s.5)

- `save(path)`: resolves when the first physical write covering the request window completes — but a later-queued request resolves with an EARLIER write's snapshot (W1). The resolved snapshot is always a DURABLE snapshot, but not necessarily the one for the caller's buffer state.
- `updateProperty(path, key, value)`: awaits `save()` then a possible rebase-save; resolves after the rebased save's first physical write. Works, but inherits W1's snapshot semantics.
- `applyAI(proposal)`: resolves `{success:true}` only after the generation check passes; returns `success:false` when the buffer generation changed (verified in E3: second proposal → `success:false`).
- **Caller consequence:** `saveActiveNote` treats the resolved snapshot's hash as the index hash for the CURRENT buffer (W2).

## 8. Snapshot / buffer / index consistency (s.4)

**FINDING W2 (P2, web) — persistent index sourceHash/content mismatch.** `saveActiveNote` (useVault.ts) does `const snapshot = await coordinator.save(path)` then `parse(currentBuffer, snapshot.version.hash)` + `index.upsert`. With W1's snapshot, this produces `parse(v2, hashOfV1)` + `index.upsert(v2 tagged with v1 hash)`. Proven: after full settlement (disk=v2, `status=saved`), the index still holds sourceHash `944a4668…` (v1) with content v2 while disk hash is `974a4b21…` — **PERSISTENT MISMATCH=true**; the pump's silent v2 write has no caller → no re-index → the mismatch does NOT self-heal in-session (repairs on the next save or a restart reconciliation). Search/backlinks/graph/manifest read the wrong version identity during that time.

## 9. Property concurrency (s.6)

All four scenarios with the REAL `updateNoteProperty` + latency:

- **P1** (manual save running → buffer changes → property requested): PASS — human text + property both on disk, clean, saved.
- **P2** (property starts → human types → autosave fires): PASS — both preserved, clean, saved, no conflict.
- **P3** (autosave queued → property requested): PASS.
- **P4** (two rapid mutations while typing): PASS — `status: draft` AND `priority: low` AND the human body text all on disk, clean, saved.
  The rebase in `updateProperty` preserves BOTH the latest frontmatter and the latest human body. **The previous audit's D-silent property loss is fixed.**

## 10. AI concurrency (s.7)

Real `applyAIProposedEdit`:

- **E1 (AI starts → human types during save): PASS** — human text wins on disk AND editor; AI result superseded (generation check → `success:false`).
- **E2 (autosave running → AI accepted): PASS** — AI content on disk, clean, saved.
- **E3 (two proposals back-to-back): PASS** — first `success:true` (disk=E3-AI-ONE), second `success:false` ("buffer modified").
- **E4 (AI + property overlap): PASS** — AI content AND `status: done` both on disk.
- **E5 (target renamed during apply): FAIL-soft (P2)** — the rename is silently ABORTED: Welcome.md remains, Renamed.md never created (`rExists:false`), only `console.error`. The user's rename is silently dropped (no ghost, no data corruption).
- **E6 (target closed during apply): P2** — the AI edit commits after the tab is closed (`disk=E6-AI, tabs:0`) — same silent-commit-after-discard family as s.8.
- **E7 (target deleted during apply): PASS** — no resurrection.

## 11. Close / rename / delete races (s.8, 9, 10)

- **s.8 close + confirmed discard mid-write: P2 — silent commit after explicit discard.** `closeTab` shows "Discard and close?" confirm; accepting it calls `coordinator.removeNote` — but the in-flight pump write continues and commits (`disk contains s8b-dirty`, tabs=0). The user's explicit discard is silently ignored; the save promise resolves. The UI contract is violated (the discard did not discard).
- **s.9 rename mid-write: P1 — GHOST RECREATION + duplicate canonical files.** With the slow write in flight: Welcome.md is recreated with the dirty edit (`s9-dirty`) AND Renamed.md exists with the renamed original. Root cause: `renameDocument` (refactor.ts) creates the new path, then version-checks before removing the old path; the pump's in-flight write to the old path passes the check (file still present) and lands — the rename's pre-delete check then fails and the old file is never removed. Result: **two canonical files; the dirty edit landed in the WRONG path**. The directive's required final ("one canonical file, correct filename, correct latest content, no ghost recreation") is violated.
- **s.10 delete mid-write: PASS (memory path) — no resurrection.** `deletePath` removes the file first; the in-flight write's write-time version check fails ("file was deleted externally") → the write rejects. The **Node/FSA window remains a risk** (SafeWriter pre-validates at t=0; a delete between pre-validation and the commit rename could resurrect) — not reproduced in this pass; requires a deterministic Node probe before desktop work.

## 12. Vault-switch race (s.11)

**PASS — no cross-vault contamination.** Forced: slow write of Welcome.md in the memory vault → `openDirectoryVault()` (real `setStorage` to an OPFS-backed vault) mid-write. Result: the old write landed in the OLD memory vault (`s11-dirty` ✓), the NEW OPFS vault is NOT contaminated, and the old waiter resolved. The pump's in-flight write used the old writer (captured at call time) and the loop-top `notes.get(path)` check breaks the pump after `setStorage` clears the map. Structurally protected.

## 13. Multi-note concurrency (s.12)

**PASS — per-note independence.** B's save resolved in 16 ms while A's 5 s write was in flight. Per-note `isWriting`/pump states do not globally serialize; no cross-note snapshot/status/waiter/conflict contamination observed.

## 14. Coordinator error recovery (s.14)

- **Generic storage failure (ENOSPC): PASS** — the pump breaks on error, `isWriting` resets, the next `save()` restarts the pump cleanly (disk=v1, status=saved).
- **Real ConflictError: PASS (by design)** — the conflict is surfaced (`status=conflict`, `conflictData` with the external disk content); subsequent saves keep conflicting until the user resolves (the `committedSnapshot` stays stale — the UI resolution path must update it; flagged for the browser-conflict-flow check).

## 15. Force-save semantics (s.15)

**PASS.** Force applies only to its own operation boundary: after a forced save wins over an external modification, a subsequent NORMAL save against a NEW external modification correctly rejects with ConflictError (force does not poison later version checks).

## 16. Waiter leak / hang (s.16)

No permanently-pending waiters found in any probed case: removeNote mid-write → resolves (with the in-flight write's snapshot — the silent-commit behavior, not a hang); setStorage mid-write → resolves; error paths reject or resolve. Repeated loops showed no growth. The leak concern is limited to the semantics in W1/s.8 (waiters resolving with stale-purpose snapshots), not hangs.

## 17. Secret queue (s.18)

**VERIFIED FIXED (G6).** The corrected pattern (`op = writeLock.catch(() => {}).then(op-internal); writeLock = op.catch(() => {}); return op`) with `previousValue` captured inside the serialized op:

- A fails → B succeeds (mem=disk=B).
- old → v1 ok → v2 fails → **memory == disk == v1** (EQ=true).
- set ok → clear fails → next set ok (mem=disk=y).
- fresh-store state equals in-memory state after every settled operation.

## 18. Reconciliation state (s.19)

**PASS.** `degraded` is reachable: verifier read failure → `state=degraded`, `getVerificationErrors()` returns 1 error with the path. `verified` requires zero errors. `verificationErrors` resets per reconciliation cycle (line 145) — no stale-forever errors (verified after the next healthy cycle).

## 19. Watcher / verifier ordering — NEW failure case (s.20, 21)

**FINDING W3 (P1, desktop-runtime) — timestamp-before-commit stand-down leaves a stale index with a false `verified`.** `pathWriteTimestamps.set(event.path, Date.now())` runs at the TOP of the watcher handler (line 299), BEFORE the read/parse/upsert. Deterministically forced (injected fs.watch callback + read-failure window + delayed verifier read):

- verifier read started (readStart t0) → external change → watcher event → timestamp recorded (t0+ε) → watcher read FAILS twice → handler returns "marked dirty" WITHOUT updating the index → verifier checks `lastWatcherUpdate > readStart` → TRUE → **stands down** → no upsert.

Final: `state=verified`, `errors=0`, **indexLen=3,000,008 (old X1) vs diskLen=4 (X3)** — the index is stale while the runtime claims `verified`. "A newer event started" is NOT "a newer version was successfully committed to the index." The correct contract: record the generation/timestamp on **successful index commit** (or maintain a separate committed-marker), not on event observation. All four orderings tested: watcher-succeeds-first (fine), verifier-first-watcher-succeeds (fine — stand-down is correct), watcher-fails (BROKEN — W3), watcher-retries-and-succeeds (fine).

## 20. Atomicity warning (s.22)

**PASS.** App.tsx renders the `.degraded-atomicity-banner` ("Atomic replacement guarantee unavailable in this browser — saves will write directly to open file") when `atomicWrites === false`; the hook computes `atomicWrites: (storage as any).atomicWrites ?? true` (memory vault → true, no banner; FSA → the move-capability getter, accurate); the value recomputes on storage switch. Plumbing verified; banner text is calibrated (not "known to corrupt").

## 21. Regression sweep (s.23)

Permanent suite 43/153 green, including: filesystem containment (symlink-security), BOM/unicode (unicode-torture), external-modification conflicts (crash-injection, concurrency-race), tab switching (multi-tab-isolation), backlinks/index/graph (graph-metadata, sqlite-memory-parity), property/AI (local-ai, cloud-ai-gateway), plugin live context (first-party-plugins), Pages build (web build), 10k performance gates (scale-benchmark: 1k real pipeline + 10k rebuild/upsert<500 ms/graph<10 s). Browser FSA local save verified in earlier passes and by the e2e suite. **No regression found in the untouched foundations**; the coordinator rewiring itself is the source of W1/W2/s.8/s.9.

## 22. Remaining P0/P1

- **P1-W1 (web) — save-promise contract:** `save(v2)` resolves with snapshot(v1) before v2 is durable; callers are told success before the requested state is committed. Foundation-level persistence-contract defect (the directive's "false successful durable commit" class).
- **P1-W4 (web) — rename-during-write ghost:** duplicate canonical files (old path recreated with the dirty edit + new path with the original); the edit lands in the wrong path; renameDocument's create-then-version-check + the pump's in-flight write interleave.
- **P1-W3 (desktop-runtime) — false `verified` + stale index:** timestamp-before-commit stand-down (s.20). Blocks desktop; does not affect the browser product.
- No P0 found.

## 23. Remaining P2/P3

- P2-W2 (web): persistent index sourceHash/content mismatch (self-heals on next save/reconcile; canonical files safe).
- P2 (web): silent commit after confirmed discard (s.8) and after AI apply to a closed tab (E6) — the discard contract is not honored.
- P2 (web): rename during an active write silently aborts (E5) — user intent dropped with only a console.error.
- P2 (web): current Playwright concurrency tests have no latency seam and no disk assertions (release-gate coverage gap — must exist before unfreeze, per the standard).
- P2 (desktop): delete-during-write resurrection window in Node/FSA (SafeWriter pre-validate → commit rename) — not reproduced; needs a deterministic probe before desktop work.
- P3: `browser-concurrency-probes.test.ts` still named "browser" in tests/integrity while being a fast logic copy; the 3 parallel probes in `tests/_reaudit-tmp` fail due to test bugs (uncaught rejections/undefined var) and pollute `npm test`; index conflict-resolution flow not verified end-to-end in the UI.

## 24. Web unfreeze recommendation

Per the directive's standard — all of: no web/shared P0; no web/shared P1; genuine delayed-write A1-A4 pass; rename-during-save cannot recreate the old path; delete-during-save cannot resurrect; vault-switch cannot cross-contaminate; property preserves typing; AI never falsely reports success; save promises truthful; final index matches the latest canonical commit; Playwright permanently reproduces the critical timing cases; FSA save passes; Pages works; containment intact; CI green — the following are **NOT satisfied**:

- No web/shared P1 → **false** (P1-W1 save-promise contract, P1-W4 rename ghost).
- Rename during save cannot recreate old path → **false** (ghost reproduced).
- Save promises have truthful durable semantics → **false** (W1).
- Playwright permanently reproduces the critical timing cases → **false** (no latency seam, no disk assertions).

**Recommendation: KEEP FEATURE FREEZE.** The coordinator genuinely fixed the previous silent-edit-loss class (A1-A4, property, AI all pass with real latency) — that progress must be credited — but the save-promise contract and the rename-during-write ghost are new web P1s, and the index-hash mismatch (P2) plus the e2e coverage gap remain.

## 25. Desktop prerequisite recommendation

**NOT READY.** W3 (false `verified` + stale index from timestamp-before-commit) is a desktop-runtime P1; the Node/FSA delete-resurrection window needs a deterministic probe; the index conflict-resolution path needs verification. Electron remains deferred.

---

## 26. Development tooling / code-quality gates (s.28)

### 26.1 Current inventory

| Practice                       | Current state                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| TypeScript typecheck           | `tsc --build` (tsconfig.base + root + per-package) — real                                           |
| Linting                        | **`lint` = `tsc --noEmit` — NOT linting** (a second typecheck; the directive's suspicion confirmed) |
| Formatting                     | None (no Prettier, no .editorconfig)                                                                |
| Unit tests                     | Vitest, `packages/**/__tests__`                                                                     |
| Integration/integrity          | `tests/integrity/` (cross-package + invariants + scale mixed together)                              |
| Browser/E2E                    | Playwright, `tests/e2e/` (real Chromium; CI job exists)                                             |
| Code coverage                  | None                                                                                                |
| Pre-commit / pre-push / staged | None (no Husky, no lint-staged)                                                                     |
| Dependency/security            | `npm audit` only (0 vulns)                                                                          |
| CI gates                       | Node 20/22 matrix + boundary greps + typecheck + test + build + e2e job                             |
| Node-version consistency       | None (no `engines`, `.nvmrc`, `packageManager`)                                                     |

### 26.2 ESLint — RECOMMEND (small flat-config baseline)

Real bug classes TypeScript does not catch are present and have caused or masked actual defects:

- **Floating promises:** `saveActiveNote()` invoked un-awaited (useVault.ts:544 in the autosave effect, App.tsx:218) — exactly the class behind the previous concurrency bugs.
- **Empty/swallowed catches:** the coordinator's `catch {}` and the runtime's pre-fix empty catches silently dropped failures (the `verified`-lies finding).
- **React Hooks rules not enforced:** no `exhaustive-deps`/`rules-of-hooks` anywhere.
- **`any` casts proliferate:** `(doc as any)`, `(storage as any)` in production paths.

Rule classification (flat config, `eslint.config.js`):

- **MUST HAVE:** `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps` (scoped to apps/web), `@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-misused-promises`, `@typescript-eslint/no-unnecessary-type-assertion`, `@typescript-eslint/no-unused-vars` (error on unused), `no-empty` (allow empty `catch {}` ONLY with a comment).
- **USEFUL:** `@typescript-eslint/consistent-type-imports`, `@typescript-eslint/no-unnecessary-condition`, `no-unreachable`.
- **NOISE / NOT WORTH IT:** stylistic rules (semi/quote enforcement belongs to Prettier), `no-console` (the app legitimately logs), maximalist `ts-expect-error` policing.

### 26.3 Prettier — RECOMMEND (canonical formatter)

Evidence: mixed quote styles across the tree (note-coordinator.ts 1 double vs 22 single; useVault.ts 6 vs 45; desktop-runtime.ts 5 vs 22) — the "different AI agents produce different styles" failure mode is already visible. Recommend `format: prettier --write .` / `format:check: prettier --check .` with `singleQuote: true, printWidth: 100, trailingComma: 'es5'` (matches the dominant existing style). Ignore: `dist`, `coverage`, `node_modules`, `playwright-report`, `test-results`, `tests/_reaudit-tmp` (temp probes). CI job CHECKS, never rewrites.

### 26.4 Husky + lint-staged — RECOMMEND (fast pre-commit only)

Pre-commit: staged files only — Prettier check + ESLint + `tsc --noEmit` on the changed files (tsc has no per-file mode; use `lint-staged` with the eslint/prettier commands; typecheck stays in CI). **Do NOT** run Playwright, scale benchmarks, or the full suite per commit. Target < 10 s. Note: hooks are bypassable with `--no-verify`; CI is the enforcement boundary.

### 26.5 Pre-push — OPTIONAL/SKIP

`npm run typecheck` + `npm test` measured at ~8 s total — a pre-push running both is cheap and useful early feedback, but CI remains authoritative. Given the 153-test suite runs in 7.5 s, recommend a pre-push running `npm run verify` (below) if Husky is adopted.

### 26.6 Test organization

Current structure is mostly sensible: `packages/**/__tests__` (unit), `tests/integrity/` (cross-package + invariants + performance mixed), `tests/e2e/` (real browser). Two fixes: (a) rename/repurpose `tests/integrity/browser-concurrency-probes.test.ts` — the "browser" name is still a lie (it is a fast logic copy) — either delete it or rename to `save-logic-unit.test.ts`; (b) move `scale-benchmark.test.ts` and `large-vault-benchmark.test.ts` into `tests/performance/` so `npm test` scope is honest (or keep in `integrity` but document that `npm test` includes the 10k gates). No aesthetic reorganization.

### 26.7 Code coverage — RECOMMEND (visibility first, per-module)

Add Vitest coverage (`@vitest/coverage-v8`) with **visibility-first** reporting, no global percentage gate. Target per-critical-module expectations: `NoteWriteCoordinator`, `SafeWriter`, `NodeFsVaultStorage`, `BrowserFSAVaultStorage`, `SqliteDocumentIndex`, `DesktopVaultRuntime`, `DesktopSecretStore`, link resolver, renderer/security boundary, AI mutation pathway. Do not force UI components into line-count quotas.

### 26.8 Mutation testing — FUTURE SCHEDULED/MANUAL (not now)

Would add meaningful value for `SafeWriter`, `NoteWriteCoordinator`, filesystem containment, and version-conflict detection — but only as a scheduled/manual hardening pass (Stryker runtime is not per-commit material).

### 26.9 CI parity — RECOMMEND `npm run verify`

Add `verify: format:check && lint && typecheck && test && build` (fast gates, ~20 s) and `verify:e2e` (`test:e2e`), `verify:full` (verify + e2e). One command before claiming "ready for CI". Do NOT fold 50k/100k benchmarks into `verify`.

### 26.10 Test command truthfulness

- `lint` = `tsc --noEmit` → **misleading name**; must become real ESLint (or be renamed `typecheck:noemit`).
- `test` = `vitest run` — scope not documented; it includes performance (scale-benchmark) and, while `tests/_reaudit-tmp` exists, the broken parallel probes. Document scope; keep 10k gates in a separate `test:perf`.
- `test:e2e` = `playwright test` — truthful.
- `build` = web workspace build — truthful (documented deliverable).

### 26.11 Node / package-manager consistency — RECOMMEND minimal

Add `"engines": { "node": ">=20 <23" }` + `.nvmrc` (`22`) to match the CI matrix (20.x, 22.x). Skip `packageManager` unless npm-version pinning proves necessary (single package manager today). Do not add both `.nvmrc` and `.node-version`.

### 26.12 Dependency hygiene

`npm audit`: 0 vulns. `npm ls`: clean (no invalid/extraneous/duplicates). `@playwright/test` + `playwright` both in devDependencies (needed). No production tooling shipped in the bundle (tree-shaken, verified earlier). No additional checker needed — the boundary greps in CI already guard cross-package/browser-unsafe imports.

### 26.13 Commit message tooling — SKIP (OPTIONAL)

History already uses `fix(...)`/`feat(...)` forms. Add commitlint ONLY if changelog/release automation is planned. Default: not worth it.

### 26.14 EditorConfig — RECOMMEND (minimal)

Add a minimal `.editorconfig` (charset utf-8, LF, final newline, 2-space indent) — complements Prettier for editors without plugin support; do not duplicate Prettier rules.

### 26.15 Generated artifact hygiene

`.gitignore` already covers `node_modules`, `dist`, `coverage`, `test-results`, `playwright-report`, `*.tmp`, `*.log`. Gaps: `tests/_reaudit-tmp/` (temp probes dirty the tree), `.env*` / local secret files. Playwright output does NOT dirty the repo (report dirs ignored) ✓.

### 26.16 Security / secrets protection

No `.env` committed; BYOK secrets are user-supplied at runtime (never stored as files in the repo). Recommend a cheap CI grep for common secret patterns (`BEGIN PRIVATE KEY`, `sk-`, `AKIA`, `api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]{16,}`) in the existing boundary-grep step — no heavyweight platform.

### 26.17 Recommended development gates

- **Tier 1 (editor/save):** Prettier formatting, TypeScript diagnostics (via the editor).
- **Tier 2 (pre-commit, <10 s):** lint-staged → Prettier check + ESLint on staged files.
- **Tier 3 (CI per commit/PR):** `format:check`, `lint`, `typecheck`, `npm test` (unit/integration/integrity), `build`, `test:e2e` (the existing Playwright job — extend with the latency-seam cases after G1/G2 fixes).
- **Tier 4 (scheduled/manual):** 50k/100k performance, long/adversarial race tests (A2/A3 ×10, property/AI timing matrix, rename/delete/vault-switch races), mutation testing if adopted.

### 26.18 Tooling verdict table

| Tool / Practice         | Current State                  | Recommended?                                     | Why                                                                               | Where Enforced        | Blocking or Advisory       |
| ----------------------- | ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------- | -------------------------- |
| TypeScript              | tsc --build                    | Yes (keep)                                       | Real typecheck                                                                    | CI                    | Blocking                   |
| ESLint                  | `lint` = `tsc --noEmit` (fake) | **Yes — flat config, small baseline**            | no-floating-promises/no-misused-promises/react-hooks catch the actual bug classes | CI + pre-commit       | Blocking (as release gate) |
| Prettier                | None                           | **Yes**                                          | Mixed quoting already visible; cuts review noise; canonical format                | CI check + pre-commit | Advisory (ergonomics)      |
| Husky                   | None                           | Yes (fast staged checks only)                    | Early feedback; bypassable, CI is the boundary                                    | Local                 | Advisory                   |
| lint-staged             | None                           | Yes (Prettier+ESLint on staged)                  | <10 s pre-commit                                                                  | Local                 | Advisory                   |
| Vitest                  | Present                        | Keep                                             | 43 files/153 tests                                                                | CI                    | Blocking                   |
| Playwright              | Present + CI job               | Keep, **extend**                                 | Real browser, but concurrency tests lack latency seam + disk assertions           | CI e2e job            | Blocking (release gate)    |
| Coverage                | None                           | Yes (visibility-first, per-module)               | Expose blind spots in persistence primitives                                      | CI (report)           | Advisory                   |
| commitlint              | None                           | No                                               | History already conventional; no release automation                               | —                     | Skip                       |
| EditorConfig            | None                           | Yes (minimal)                                    | Cross-editor consistency                                                          | Repo root             | Advisory                   |
| Dependency audit        | npm audit (0 vulns)            | Keep                                             | Sufficient today                                                                  | CI (manual)           | Advisory                   |
| Secret scanning         | None                           | Yes (cheap CI grep)                              | BYOK/API-key accident protection                                                  | CI boundary step      | Advisory                   |
| Performance/adversarial | scale-benchmark in `npm test`  | Split into `tests/performance/` + scheduled tier | Honest `test` scope; heavy runs stay scheduled                                    | CI + scheduled        | Advisory                   |

### 26.19 Gemini handoff ordering

Tooling work (`DEV-QUALITY-GATES`) comes AFTER the correctness blockers (W1, W4, W3), the real regression tests, and CI enforcement — per the directive's ordering (correctness/security → real regression tests → CI enforcement → developer ergonomics).

---

## FINAL STANDARD — verdict

The `NoteWriteCoordinator` did NOT simply move the bugs into a new abstraction — it genuinely fixed the previous A1-A4/property/AI classes (all pass with real latency). But it introduced/retains two web P1s of its own class (the save-promise contract W1 and the rename-during-write ghost W4), plus a desktop-runtime P1 (false `verified` from timestamp-before-commit, W3), a persistent index hash/content mismatch (W2), and an e2e coverage gap (no latency seam, no disk assertions). The persistence foundation is meaningfully better but is NOT yet trustworthy enough to build on.

**WEB RECOMMENDATION: KEEP FEATURE FREEZE**
**DESKTOP/ELECTRON PREREQUISITE STATUS: NOT YET READY**
