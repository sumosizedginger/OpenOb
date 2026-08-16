# FINAL_FOUNDATION_CLOSURE_AUDIT.md

Audit type: **read / test / analyze only**. No production code modified. Temporary probes (vitest + real `NoteWriteCoordinator`/`SafeWriter`/`NodeFsVaultStorage`; Playwright against the real app + real `useVault`) were used and **removed afterward**. Working tree is clean (only the pre-existing local `reasonix.toml` modification remains).

---

## 1. Exact audited SHA

- **HEAD:** `40c12c3cac74003a38f2b26f9d0cd9f3112aff80` — **matches the expected HEAD**; audited as-is.
- Previous audit: `WRITE_COORDINATOR_REAUDIT.md` at `8ac85eaf258129792cc56c625054de60b8690231`.
- Remediation under audit: the single commit `40c12c3` "fix(coordinator): truthful save durability, rename sequencing, latency seams, and dev quality gates (C1-C7, DEV-QUALITY-GATES)" — 115 files, +4304/−987.
- Working tree: clean except `reasonix.toml` (local tool config, not production code).

## 2. Baseline

| Gate                           | Result            | Notes                                                                                                                                                  |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node / npm                     | v22.23.1 / 11.4.2 | within `engines >=20 <23`                                                                                                                              |
| `npm ci`                       | PASS              | 0 vulnerabilities                                                                                                                                      |
| `npm run format:check`         | PASS              | 6.1 s                                                                                                                                                  |
| `npm run lint`                 | PASS              | 0 errors, **4 warnings** (react-hooks/exhaustive-deps, warn-level) — 25.9 s                                                                            |
| `npm run typecheck`            | PASS              | 0.6 s                                                                                                                                                  |
| `npm test`                     | PASS              | **43 files / 158 tests** (21.7 s); up from 43/153 at 8ac85ea (+5 C1/C2/C5 tests)                                                                       |
| `npm run build`                | PASS              | 2.4 s; one chunk-size warning (codemirror-vendor 506 kB)                                                                                               |
| `npm run test:e2e`             | PASS              | **6/6** Playwright, real Chromium (25.2 s)                                                                                                             |
| `npm run test:coverage`        | PASS              | 158 tests; **38.89 % stmts** overall; no thresholds                                                                                                    |
| `npm run verify`               | PASS              | 18.2 s                                                                                                                                                 |
| `npm run verify:full`          | PASS              | verify + e2e                                                                                                                                           |
| CI boundary greps              | PASS              | cross-package imports, `dangerouslySetInnerHTML`, secret patterns — all clean                                                                          |
| **GitHub Actions for the SHA** | **UNAVAILABLE**   | `api.github.com` returns 404 for the repo (private/renamed) — CI could not be confirmed remotely; verified locally by replaying `ci.yml` step-for-step |

Test file count: 43 (vitest) + 1 (Playwright spec, 6 tests). Skipped: 0. Lint: 0 errors / 4 warnings. Formatting failures: 0. Coverage summary: 38.89 % stmts / 74.93 % branch / 79.45 % funcs. Build warnings: 1 (chunk size, informational).

## 3. C1–C7 verification matrix

| Task                                  | Verdict                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C1** save-promise durability        | **MOSTLY COMPLETE**                                           | Exact W1 hostile sequence (3200 ms, real `NoteWriteCoordinator`): `save(v2)` resolves **only when v2 is durable**, snapshot == v2, disk == v2. Same-generation multi-waiters, waiter-during-second-iteration, force-mixing, error-in-later-generation (truthful rejection, disk stays v1, retry works, no unhandled rejection) all pass. **Residual:** `removeNote(path, discard=false)` while a later-generation waiter is queued leaves that waiter **permanently pending** (never settles in 4 s+) — a waiter leak, P3 (reachable via `deletePath`/force-close when a second save generation is queued).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **C2** rename sequencing              | **PARTIAL / FALSELY CLAIMED COMPLETE in the production path** | The W4 **old-path ghost is genuinely fixed**: `useVault.renameNote` now `waitForIdle`s before `renameDocument`, verified through the real `renameDocument` (coordinator probe: exactly one canonical file, no `Welcome.md` recreation, latest content, path re-bound; A→B→C passes). **But the ACTUAL production UI rename is broken differently:** FileTree passes the raw name (`Renamed` — the edit input strips `.md`); `renameDocument` normalizes to `Renamed.md` on disk, while `coordinator.renameNote` and `setOpenTabs` keep the **unnormalized** key. In-session: coordinator key `Renamed`, tab path `Renamed`, disk/index `Renamed.md`. With "rename while autosave pending but write not begun", the pending edit never lands on the canonical file and the UI shows **"External Conflict!"** against a nonexistent path (verified in the real browser). The permanent e2e C2 test passes only because it calls `coord.waitForIdle`/`storage.write`/`storage.remove`/`coord.renameNote` directly with `.md`-suffixed paths, bypassing `useVault.renameNote` and the FileTree flow. |
| **C3** watcher/verifier ordering      | **VERIFIED COMPLETE**                                         | `pathWriteTimestamps.set(...)` moved to after successful `index.remove`/`index.upsert` (diff). Deterministic regression test covers the exact W3 ordering (watcher read fails twice → verifier must NOT stand down → index == X3, `reconciliationState == 'verified'`) plus the G5 watcher-precedence ordering. All four orderings implied by the two permanent tests; suite 9/9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **C4** index hash/content consistency | **MOSTLY COMPLETE**                                           | Primary fix verified under forced interleaving: after overlapping v1/v2 saves settle, `index.textContent == disk` AND `index.sourceHash == disk hash` (the old W2 persistent mismatch is gone; `saveActiveNote` now parses the returned snapshot's `savedText`). **Residual (P2):** an older async `parse`+`index.upsert` finishing **after** a newer one regresses the index (injected 5000 ms parse delay on the v1 save → final index holds `# v1 old` while disk is `# v2 new`). The index is not serialized against save order; self-heals only on the next save.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **C5** discard semantics              | **FALSELY CLAIMED COMPLETE**                                  | `removeNote(path, discard=true)` sets `isDiscarded` and nulls waiters, but an **already-started physical write cannot be cancelled by that flag and still commits**. Verified at 3200 ms with the real coordinator: manual discard → disk gets the discarded edit; AI apply + discard → AI content lands **and `applyAI` returns `{success:true}`**; property mutation + discard → property lands; and through the real browser UI (close tab, confirm dialog accepted) → the discarded edit is on disk. The permanent C5 unit test asserts only that the waiter resolves `null` and **never checks disk** — it is falsely green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **C6** rename/AI no-silent-abort      | **MOSTLY COMPLETE**                                           | Rename failures now surface via `alert('Rename failed: …')` instead of a silent `console.error` (the E5 silent-abort is gone), and `waitForIdle` sequencing means a rename during an AI write succeeds rather than aborting. Subsumed by the C2 path defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **C7** real latency browser coverage  | **PARTIAL**                                                   | The latency seam (`__setStorageWriteDelay`) and disk read-back assertions are **real** and the product behavior at **3200 ms and 5000 ms** (write overlapping the 2000 ms debounce) passes 5/5 with storage verification, plus 1500 ms and 750 ms-class cases. **But** the permanent A2/A3 test injects **1200 ms**, which does **not** exceed the 2000 ms production autosave debounce (useVault.ts:591) — its title "exceeding debounce" is false. The permanent C2 e2e case bypasses the production rename. No permanent property/AI/delete/vault-switch race cases exist. Per the directive's explicit rule, C7 = **PARTIAL**.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 4. Save-promise durability (C1 detail)

Hostile sequence, exact directive form, real `NoteWriteCoordinator` + 3200 ms physical write delay:

```
buffer=v1 → save(v1) → (pending) → buffer=v2 → save(v2)
```

- At `save(v1)` resolution: snapshot == v1, disk == v1. `save(v2)` **not** yet resolved (no early resolution).
- At `save(v2)` resolution: snapshot.textContent == v2, disk == v2. ✓
- v1→v2→v3→v4 chain: every promise resolves against a durable snapshot whose content is **at least** the requested generation, disk == that snapshot at resolution. Coalescing may skip intermediate generations (v2/v3 waiters resolve with the v4 snapshot once v4 is durable) — compliant with the directive's "at least" wording; a strict "==" interpretation would flag it, so it is recorded as a semantic nuance, not a defect.
- Force waiter mixed with normal waiter: force applies only to its own operation; a subsequent normal save against a _new_ external modification still conflicts truthfully (no poisoning). ✓
- Error during a later generation: the later waiter rejects; the earlier waiter resolved with its own durable snapshot; disk stays v1; `isWriting` resets; the next save restarts cleanly; no unhandled rejection. ✓
- **Permanent-waiter leak:** note removed (no discard) while a later-generation waiter exists → that waiter never settles. This is the one C1 edge case that fails ("no permanent waiter" not satisfied).

## 5. Index consistency (C4 detail)

- After full settlement of overlapping v1/v2 saves (real `saveActiveNote` sequence): `index.textContent == disk content` and `index.sourceHash == canonical disk hash`. ✓
- Older `index.upsert` finishing after a newer one regresses the derived index (forced via injected parse delay). ✗ — the derived index can represent a version older than the newest canonical commit, and nothing re-indexes until the next save.

## 6. Real Playwright race credibility (C7 detail)

- Seam: real (`window.__setStorageWriteDelay` wraps the production `storage.write` used by the real app; the coordinator's `SafeWriter` writes through it). Disk assertions: real (`__readStorage` reads back the actual storage).
- 3200 ms (5 iterations) and 5000 ms writes genuinely overlap the 2000 ms autosave debounce; both converge to `Saved` with v1+v2 on disk. 1500 ms (< debounce) also converges.
- **Permanent A2/A3 = 1200 ms < 2000 ms debounce** → per the directive, C7 is **PARTIAL** even though it passes.

## 7. Rename concurrency (C2 detail)

- Old-path ghost recreation (W4): **fixed** — `waitForIdle` before `renameDocument` prevents the in-flight old-path write from landing after the rename; verified with the real `renameDocument` (no `Welcome.md` ghost, one canonical file, latest content).
- **New production-path defect (P1, web):** the UI rename passes the unnormalized name; `coordinator.renameNote` and the tab are keyed without `.md` while disk and index use `.md`. Consequences verified in the real browser:
  - rename mid-write → coordinator state keyed `Renamed` (no `.md`), `getNoteState('Renamed.md')` undefined;
  - rename while autosave pending (no physical write started) → the pending edit **never lands on the canonical file**; UI shows "External Conflict!" against a nonexistent path; on reload the edit is gone;
  - subsequent saves target the extensionless path and conflict (version check: file does not exist).
- Permanent tests that claim C2 coverage bypass the production path: the e2e test drives `coord.waitForIdle`/`storage.write`/`storage.remove`/`coord.renameNote` manually with `.md` paths; the unit test does the same without `renameDocument`.

## 8. Discard semantics (C5 detail)

All four variants (3200 ms, discard AFTER the physical write entered `storage.write`):

| Variant                                                       | Disk after discard                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Manual "Discard and close" (coordinator)                      | `dirty-edit-to-discard` **landed**                                      |
| Manual "Discard and close" (real browser UI, dialog accepted) | **landed** (assertion failed)                                           |
| AI apply in flight → discard                                  | `# AI replaced content` **landed**; `applyAI` returned `{success:true}` |
| Property mutation in flight → discard                         | `status: published` **landed**                                          |

Root cause: `isDiscarded` only stops new pump iterations and nulls waiter resolution; an already-started `SafeWriter.safeSave → storage.write` completes and commits. The permanent regression test is falsely green (waiter-only assertion, no disk check). Severity P2 (silent commit after explicit discard; user-visible "the edit you discarded is still there when you reopen/refresh").

## 9. Delete-resurrection test

- Memory vault (coordinator path): **PASS** — deleting the file during an in-flight write causes the write-time version check to reject; no resurrection.
- **Real `NodeFsVaultStorage`:** delete forced between version-validation and temp→canonical rename → **the deleted note is RECREATED** (resurrection). Deterministic via a delegating `fs/promises` mock that deletes exactly in that window. This was the previously "not reproduced" s.10 window; now reproduced.
- Browser FSA: structurally identical temp→`move()` window in `BrowserFSAVaultStorage.write` — same risk class (not browser-probed in this pass).
- Classification: **P1 (desktop/Node)**; shared risk for web-FSA; memory vault safe.

## 10. Vault-switch safety

**PASS** (coordinator probe): write begun in vault A lands only in A; vault B uncontaminated; the old waiter settles with the A snapshot; the new coordinator map contains no old state; no stale listener state leaks into B.

## 11. Property concurrency

Coordinator-level: human text + property converge (permanent "D" rebase test passes; re-verified). Property + typing, property + autosave, two rapid mutations: covered by the permanent suite and the previous re-audit's real-hook matrix — no regression in this pass. **Property + discard fails (C5 class).** Property + rename inherits the C2 path defect.

## 12. AI concurrency

`applyAI` human-precedence (buffer-divergence → `success:false`, human work wins) passes at the coordinator level (permanent tests + code review of the unchanged divergence checks). **AI + discard fails** (content lands, `success:true` reported after losing commit authority — C5 class, contradicts "AI never returns success after losing commit authority"). AI + rename inherits the C2 path defect. AI + delete: write-time version check rejects (no resurrection in memory) per prior E7 verification; unchanged by this remediation.

## 13. Watcher/verifier ordering (C3)

VERIFIED. Timestamp recorded only after successful index commit; the deterministic W3 ordering is a passing permanent test; the G5 precedence ordering also passes. No configuration was found that yields `verified` with an index differing from canonical disk.

## 14. Reconciliation

Covered by the passing desktop suite: `degraded` reachable on read failures; `verified` requires zero errors; verification errors reset per cycle; canonical deletion is treated as a legitimate delete (not corruption) — the runtime's deleted-path reconciliation path is unchanged by this remediation and its tests pass.

## 15. Secrets

Secret-store queue matrix re-verified via the permanent suite (9/9): A-fails→B-succeeds; v1-ok→v2-fails ⇒ memory==disk==v1; set-ok→clear-fails→next-set-ok; clear-ok→set-fails→next-set-ok; fresh store equals in-memory state after every settled operation. No queue poisoning, no stale rollback.

## 16. Test-hook production exposure

**FINDING (P2, design/security-hygiene):** the production bundle (`dist/assets/index-*.js`) unconditionally executes:

```js
window.__vaultStorage = …; window.__coordinator = …;
window.__readStorage = …; window.__setStorageWriteDelay = …;
```

No test/dev guard (`useVault.ts` effect keyed on `[storage]`). In production, a same-origin script can mutate `storage.write` (freeze/redirect all saves), read/write/remove any vault file via the raw storage, and drive the coordinator directly — bypassing the intended version-check/capability boundaries. Do not overstate the threat (a same-origin attacker with script execution already has app-level capabilities), but this is test-only plumbing that must not ship. Recommended contract: expose hooks only under `import.meta.env.DEV` (or a build define) so production bundling eliminates them.

## 17. ESLint / async static analysis

- Current config is **NOT type-aware** (`typescript-eslint` `recommended`, no `parserOptions.project`/projectService) — `no-floating-promises` / `no-misused-promises` **cannot run** today.
- Type-aware trial (projectService, temp config, removed): **57 errors** — 27 `no-floating-promises` + 29 `no-misused-promises` (+1 parse error in a config file) — plus the 4 `exhaustive-deps` warnings; runtime ~8.7 s (cheaper than the current 26 s non-type-aware run over tests).
- Real defects among them (not noise): `useVault.ts:590` autosave effect calls `saveActiveNote()` un-awaited/uncaught — the exact historical bug class; `desktop-runtime.ts:131` watcher listener and `:353` checkpoint timer floating promises; `note-coordinator.ts:196` `this.pump()` floating (fire-and-forget, should be `void`); `App.tsx` `openNote(path)` in handlers. The remaining `no-misused-promises` items are mostly React event-handler noise (App.tsx, AIChatDrawer, PluginManagerModal).
- `exhaustive-deps` warnings (Editor.tsx:128, useVault.ts:299/584/594) were inspected: debounce/seed/parse patterns with controlled dependencies — **not** stale-closure defects; safe to keep as warnings.
- Verdict: `no-floating-promises` **MUST HAVE**; `no-misused-promises` **USEFUL** (consider `checksVoidReturn` configuration to cut event-handler noise).

## 18. Formatting / dev tooling

- Prettier: real, `format:check` green on clean checkout; `.prettierignore` covers `node_modules`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `.vitest`, `*.tmp`, `tests/_reaudit-tmp/`. No generated-output CI failures.
- EditorConfig: present (utf-8, LF, final newline, 2-space). Node consistency: `engines >=20 <23` + `.nvmrc` (22) match the CI matrix (Node 20.x/22.x). `packageManager` not pinned — optional; npm-only repo, `npm ci` + lockfile is reproducible today. Not recommended unless churn appears.
- Husky/lint-staged: absent. Evaluation: **OPTIONAL** — a pre-commit running only staged-file Prettier check + ESLint (<10 s) would help agents/contributors, but CI is the enforcement boundary and nothing here is a release blocker.

## 19. Coverage

`npm run test:coverage` works (v8, text/json/html, no thresholds). Per critical module: `NoteWriteCoordinator` 74.35 % / 59.67 % branch; `SafeWriter` 89.74 % (dangerous uncovered: 77–80 — the post-write hash-verification throw); `NodeFsVaultStorage` 76.68 %; `BrowserFSAVaultStorage` — low; `DesktopVaultRuntime` 88.95 %; `DesktopSecretStore` 85.14 %; `SqliteDocumentIndex` 88.98 %; markdown parser 96.42 %; renderer/security boundary — component coverage is near-zero in vitest (0 % for `apps/web`) because the environment is `node`; the Playwright suite is the real web coverage. Dangerous uncovered branches: `SafeWriter` verification-failure path, coordinator `updateProperty`/`applyAI` error paths, storage error paths. No global threshold is appropriate; a per-critical-module floor (e.g. ≥75 % on `NoteWriteCoordinator`/`SafeWriter`/storage adapters) would be defensible but not required.

## 20. CI credibility

`ci.yml` runs, in the test job: boundary greps → format:check → lint → typecheck → test → build (Node 20/22 matrix), plus a separate Playwright job (Node 22, `playwright install --with-deps chromium`, `test:e2e`). All steps are real and were replayed locally green. `npm run verify` == format+lint+typecheck+test+build — matches the CI test job except the **boundary greps are CI-only** (small parity gap; `verify` does not include them). `verify:full` adds e2e. GitHub Actions status for the audited SHA could **not** be confirmed (repo returns 404 from the API). The Playwright job exercises the real critical _rendering_ and _typing_ races but, as audited, the permanent concurrency cases do not reproduce the timing cases at >debounce latency and the rename case bypasses the production path.

## 21. Performance

`scale-benchmark` (in `npm test`): 1k real pipeline ≈ 2.7–4.9 s (gate <10 s); 10k engine rebuild/search/backlinks/graph ≈ 0.9 s total with asserted budgets: single upsert <500 ms @10k ✓, graph <10 s @10k ✓, rebuild <5 s ✓. No benchmark gaming observed; no material regression from the remediation.

## 22. Regression sweep

13 targeted files / 38 tests green: filesystem containment/symlink escape, atomic Node write, BOM preservation (bom-torture), Browser-FSA save/reload (previous passes), SQLite persistence/rebuild parity, same-size+same-mtime reconciliation (crash-injection/desktop), Markdown hostile-XSS (preview-security + parser), plugin sandbox/live context, GitHub-Pages build (web build), BYOK secret isolation (secure-storage). No regression in the untouched foundations.

## 23. Remaining P0/P1

- **P1 (web) — C2 production rename path:** every UI rename leaves coordinator/tab on the unnormalized path while disk/index use `.md`; pending dirty content is stranded in a false conflict and never lands on the canonical file; subsequent saves conflict against a nonexistent path. (Permanent tests bypass the production path and are falsely green.)
- **P1 (desktop/Node, shared) — delete-during-write resurrection:** deterministic reproduction in `NodeFsVaultStorage`; structurally identical window in browser FSA. Memory vault safe.

## 24. Remaining P2/P3

- P2 (web) — C5 discard: explicit discard still commits an already-started physical write (all variants incl. AI reporting `success:true`); permanent test falsely green.
- P2 (web) — C4: older async `index.upsert` can land after a newer one and regress the derived index.
- P2 (web) — production bundle exposes mutable `window.__vaultStorage/__coordinator/__readStorage/__setStorageWriteDelay` with no guard.
- P2/P3 (web) — permanent-waiter leak: `removeNote(discard=false)` with a queued later-generation waiter never settles.
- P2 (tooling) — ESLint not type-aware; `no-floating-promises` must be enabled; fix the ~6 real findings (autosave effect, watcher listener, checkpoint timer, pump `void`, App handlers).
- P3 (tooling/taxonomy) — `coordinator-concurrency-probes.test.ts` does not use `NoteWriteCoordinator` at all (still a hand-rolled logic copy; the "coordinator" name is a lie); permanent C5 unit test never checks disk; permanent C2 unit test bypasses `renameDocument`; permanent A2/A3 latency (1200 ms) does not exceed the debounce; permanent e2e C2 bypasses `useVault.renameNote`; no permanent property/AI/delete/vault-switch e2e cases; `verify` omits the CI boundary greps.

## 25. Web feature-unfreeze recommendation

**KEEP FEATURE FREEZE.** Against the directive's unfreeze standard:

| Condition                                                         | Status                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| No WEB/SHARED P0                                                  | ✓ (none found)                                                            |
| No WEB/SHARED P1                                                  | **✗ — C2 production rename path (content-stranding, path inconsistency)** |
| Real >2000 ms write/debounce race passes repeatedly               | ✓ (3200/5000 ms, 5/5, disk-verified)                                      |
| Save-promise durability truthful                                  | ✓ (C1 core; one P3 waiter-leak edge)                                      |
| Index content/hash matches canonical version                      | ~ (verified for the main flow; stale-upsert race remains, P2)             |
| Production rename race passes through ACTUAL `renameNote()`       | **✗**                                                                     |
| Rename cannot create ghost old-path files                         | ✓ (W4 fixed)                                                              |
| Delete cannot resurrect notes                                     | ~ (memory ✓; Node/FSA ✗)                                                  |
| Vault switch cannot cross-write                                   | ✓                                                                         |
| Explicit discard semantics truthful                               | **✗ (C5)**                                                                |
| Property mutation races preserve human work                       | ✓                                                                         |
| AI races preserve human work + truthful result state              | ~ (AI+discard reports `success:true` after losing commit authority — ✗)   |
| Browser FSA local save/reload                                     | ✓ (prior passes; not re-broken)                                           |
| Containment / Markdown hostile XSS / Pages subpaths               | ✓                                                                         |
| CI green                                                          | ✓ locally (remote status unavailable)                                     |
| Permanent Playwright coverage genuinely reproduces critical races | **✗ (C7 PARTIAL)**                                                        |

The coordinator's C1 core fix is real and the >2000 ms race class is genuinely handled; that progress is credited. But the production rename path (P1) and the discard contract (P2) plus the C7 coverage gap keep the freeze in place.

## 26. Desktop/Electron prerequisite status

**NOT READY.** C3 is verified (watcher/verifier ordering) and the secret queue is verified, but:

- delete-during-write **resurrection is now reproduced** in real `NodeFsVaultStorage` (P1 desktop blocker),
- the C2 path defect is shared (desktop will use the same coordinator/rename flow),
- the C5 discard semantics are shared.

Electron itself remains deferred.

## 27. Dev-quality recommendation

Keep the tooling that was added (real ESLint, Prettier, coverage, `verify`, Node pinning, CI greps) — it is genuine and non-blocking to fix. Next steps in order: (1) enable type-aware ESLint with `no-floating-promises` and fix its ~6 real findings (cheap, ~9 s); (2) fix the test-taxonomy lies (`coordinator-concurrency-probes`, C5 disk assertion, C2 via `renameDocument`, A2/A3 at 3200 ms, e2e C2 via the real UI); (3) Husky/lint-staged is OPTIONAL (staged Prettier+ESLint only, <10 s) — not a release blocker; (4) commitlint: DO NOT ADD.

---

## FINAL VERDICT

The remediation is **partially real and partially falsely claimed**. C1's core save-durability contract and C3's watcher/verifier ordering are genuinely fixed and verified. The old-path rename ghost (W4) is fixed. The >2000 ms debounce race class passes in the real browser. **However:** the production rename path is broken in a new way (P1, content-stranding + path mismatch), discard-during-write still silently commits (C5 falsely green), delete-during-write resurrects on Node/FSA (P1 desktop), the index can regress via a stale upsert (P2), the permanent test suite does not exercise the production paths it claims to cover, and mutable test hooks ship in the production bundle.

**WEB FEATURE DEVELOPMENT: FROZEN (do not unfreeze).**
**DESKTOP/ELECTRON PREREQUISITES: NOT READY.**
