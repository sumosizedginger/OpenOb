# GEMINI_FINAL_FOUNDATION_REMEDIATION.md

Handoff from `FINAL_FOUNDATION_CLOSURE_AUDIT.md` (HEAD `40c12c3cac74003a38f2b26f9d0cd9f3112aff80`). **Only unresolved work.** Correctness blockers first; tooling/ergonomics last. The audit was read/test/analyze-only; temporary probes were removed.

---

## H1 — C2: production rename path leaves coordinator/tab on the unnormalized path and strands dirty content

- **ID:** H1
- **Severity:** P1
- **Scope:** WEB / SHARED
- **Problem:** Every UI rename (FileTree → `useVault.renameNote`) passes the raw name (the edit input strips `.md`). `renameDocument` normalizes to `Renamed.md` on disk and index, but `coordinatorRef.current.renameNote(oldPath, newPath)` and `setOpenTabs` keep the unnormalized key. Verified in the real browser:
  - coordinator key becomes `Renamed` (no `.md`); `getNoteState('Renamed.md')` is `undefined`;
  - rename while autosave is pending (physical write not begun): the pending edit never lands on the canonical file; the UI shows `External Conflict!` against a nonexistent path; on reload the edit is gone;
  - subsequent saves target the extensionless path and conflict (version check: file does not exist).
- **Evidence:** temp browser probes (removed): after UI rename, `coordKeys=['GhostTest']`, `tabPath='GhostTest'`, disk has `GhostTest.md`; pending-content marker absent from the canonical file after settle.
- **Exact reproduction:** real app, `__setStorageWriteDelay(500)`; type `\n\n- PENDING-CONTENT-MARKER`; wait 300 ms; FileTree "Rename Note" → rename to `EarlyRename`; wait 7 s; read `EarlyRename.md` — marker absent; `.save-status` shows `External Conflict!`.
- **Root cause:** `apps/web/src/hooks/useVault.ts` `renameNote` (line ~507) passes `newPath` through to `coordinator.renameNote` and `setOpenTabs` without the normalization that `renameDocument` applies (`normalizeVaultPath(newPath.endsWith('.md') ? newPath : `${newPath}.md`)`).
- **Affected files:** `apps/web/src/hooks/useVault.ts` (renameNote), optionally `packages/vault/src/note-coordinator.ts` (defensive normalize in `renameNote`).
- **Required change:** normalize the target path ONCE at the top of `useVault.renameNote` (same rule as `renameDocument`: append `.md` if missing, `normalizeVaultPath`) and use the normalized path for `renameDocument`, `coordinator.renameNote`, `setOpenTabs`, and `setActiveTabPath`. (Do not double-normalize inside `renameDocument`.)
- **Required regression tests:** a Playwright test that drives the REAL UI rename (FileTree "Rename Note") with a raw name, asserting: `Welcome.md` gone; `Renamed.md` exists; `Renamed.md` contains the latest dirty content even when the rename happens while autosave is pending and no write has started; `coordinator.getNoteState('Renamed.md')` defined; tab path == `Renamed.md`; `index.get('Renamed.md')` present; no extensionless file. Include the mid-write (3200 ms) variant and rename-twice A→B→C via the UI.
- **Acceptance criteria:** the directive's required final holds through the ACTUAL `renameNote()` path: one canonical file, correct filename, correct latest content, no ghost, coordinator/tab/index paths all == the canonical path; pending dirty content survives the rename.
- **Dependencies:** none (do first).
- **What NOT to do:** do not "fix" by making the coordinator append `.md` while `setOpenTabs` keeps the raw name (paths must agree everywhere); do not make the rename wait longer or add sleeps; do not remove the FileTree `.md`-stripping without normalizing downstream.

---

## H2 — delete-during-write resurrects notes on Node/FSA storage

- **ID:** H2
- **Severity:** P1 (desktop/Node; shared risk for browser FSA)
- **Scope:** SHARED (`packages/vault`)
- **Problem:** With real `NodeFsVaultStorage`, a delete between version prevalidation and the temp→canonical rename recreates the deleted file. The audit reproduced it deterministically (delegating `fs/promises` mock that deletes in that window): after the write completes, `Target.md` exists again (resurrection). `BrowserFSAVaultStorage.write` has the structurally identical temp→`move()` window.
- **Evidence:** temp vitest probe (removed): `NODE-FS RESURRECTION: existsNow=true, deletionRan=true, error=null`.
- **Exact reproduction:** see `tests/_tmp-audit/delete-resurrection.probe.test.ts` pattern (removed): seed file; hook `fs.rename`; start `SafeWriter.safeSave` with the file's version; in the hook (between validation and rename) call `storage.remove(path)`; observe the file exists afterward.
- **Root cause:** `packages/vault/src/node-fs-storage.ts` `write()` (line ~293 `fs.rename(tmpDiskPath, diskPath)`) and `browser-fsa-storage.ts` `write()` (`tempHandle.move(filename)`) commit without re-checking that the canonical target still exists (and still matches the validated version) at commit time.
- **Affected files:** `packages/vault/src/node-fs-storage.ts`, `packages/vault/src/browser-fsa-storage.ts`.
- **Required change:** before the final rename/move, re-stat (Node) / re-check existence (FSA) of the canonical target and abort (throw ConflictError, delete the temp) if it was removed or its version changed since prevalidation. Keep the atomicity and fsync guarantees.
- **Required regression tests:** the deterministic probe (delete in the validation→rename window) as a permanent test for NodeFsVaultStorage; a browser-FSA equivalent (or a documented structural test) for the move window; the memory-vault no-resurrection case must stay green.
- **Acceptance criteria:** no deleted note can be recreated by an in-flight write on any storage adapter.
- **Dependencies:** none.
- **What NOT to do:** do not globally serialize deletes and writes; do not remove the version checks; do not add sleeps.

---

## H3 — C5: discard during an already-started physical write still commits

- **ID:** H3
- **Severity:** P2 (silent commit after explicit discard; user-visible)
- **Scope:** WEB
- **Problem:** `removeNote(path, discard=true)` sets `isDiscarded` and resolves waiters with `null`, but an already-started `SafeWriter.safeSave → storage.write` completes and commits. Verified (3200 ms, real coordinator + real browser UI): manual discard, AI apply + discard (disk gets AI content, `applyAI` returns `{success:true}`), property mutation + discard — the write lands in all cases. The permanent C5 unit test is falsely green (asserts only `res === null`, never checks disk).
- **Evidence:** temp probes (removed): `C5 DISK AFTER DISCARD: "dirty-edit-to-discard"`, `C5c DISK AFTER AI DISCARD: "# AI replaced content"`, `C5d DISK AFTER PROP DISCARD: "...status: published..."`; e2e discard test failed on the disk assertion.
- **Exact reproduction:** coordinator: init note; `setBuffer('dirty')`; `save()`; wait 100 ms (write in flight); `removeNote(path, true)`; await 3.5 s; `readText` → the dirty content is on disk.
- **Root cause:** `packages/vault/src/note-coordinator.ts` — `isDiscarded` cannot cancel an in-flight `storage.write`; the write's commit is not dropped.
- **Affected files:** `packages/vault/src/note-coordinator.ts`; `apps/web/src/hooks/useVault.ts` (`closeTab`).
- **Required change:** pick one explicit contract and implement it truthfully: (a) storage-level cancellation (abortable write) and/or the coordinator suppresses the commit result before it reaches disk is not possible with the current storage API — so either (i) the UI refuses/delays "Discard and close" while a write is in flight (e.g. await the in-flight write, then discard requires restoring the previous committed content — or show a truthful dialog), or (ii) the close dialog explicitly states the write may still land. Whichever is chosen must be reflected in the dialog text and tests.
- **Required regression tests:** the coordinator-level probe asserting disk does NOT contain the discarded edit after discard mid-write; the same through the real browser UI (dialog accepted); AI-apply + discard; property + discard; no waiter hangs (waiters must still settle).
- **Acceptance criteria:** either the discarded edit never lands on disk, or the UI truthfully documents that it may land; no waiter hangs; no `success:true` from `applyAI` after the user discarded.
- **Dependencies:** none.
- **What NOT to do:** do not just delete the file after the write (racing); do not resolve the waiter as "saved"; do not remove the version checks; do not claim C5 fixed while the permanent test never checks disk.

---

## H4 — C4: an older async index.upsert can land after a newer one and regress the index

- **ID:** H4
- **Severity:** P2
- **Scope:** WEB / SHARED
- **Problem:** `saveActiveNote`'s `parse`+`index.upsert` runs outside the coordinator's serialization. With two overlapping `saveActiveNote` calls where the earlier one's parse is slower, the older upsert finishes after the newer one and the derived index regresses (verified: injected 5000 ms parse delay on v1 → final `index.textContent == '# v1 old'` while disk is `# v2 new`). Nothing re-indexes until the next save.
- **Evidence:** temp vitest probe (removed): `→ expected '# v1 old' to be '# v2 new'`.
- **Exact reproduction:** mirror `saveActiveNote` (save → parse(savedText, snapshot.hash) → upsert) twice, with a 5000 ms delay injected into the first parse; assert final index == disk content.
- **Root cause:** `apps/web/src/hooks/useVault.ts` `saveActiveNote`/`updateNoteProperty`/`applyAIProposedEdit` run parse/upsert concurrently without ordering against the save chain.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (and/or a serialization seam in the index or coordinator).
- **Required change:** serialize index updates per path against the coordinator (e.g. tag each upsert with the buffer generation it was computed from and drop upserts older than the latest committed generation, or await `coordinator.waitForIdle(path)` and re-read the latest committed snapshot before upserting).
- **Required regression tests:** the interleaving probe (older parse finishes after newer) asserting the final index == newest canonical disk version; the existing settlement test (index == disk, sourceHash == disk hash) must stay green.
- **Acceptance criteria:** the derived index always ends at the newest canonical committed version after any interleaving; no in-session stale sourceHash/content pair.
- **Dependencies:** H1 (same files); C1 semantics are the base.
- **What NOT to do:** do not move the whole index inside the coordinator; do not add sleeps; do not drop upserts based on wall-clock.

---

## H5 — permanent-waiter leak on note removal with a queued later-generation waiter

- **ID:** H5
- **Severity:** P3
- **Scope:** WEB
- **Problem:** `removeNote(path, discard=false)` (used by `deletePath` and force-close paths) deletes the note while a later-generation waiter may still be queued; the pump's loop-top `notes.get(path)` then returns undefined and the waiter is never drained — it hangs forever (verified: p2 never settles within 4 s+). Reachable when a second save generation is queued (e.g. debounce fired) and the note is then deleted/force-closed.
- **Evidence:** temp vitest probe (removed): watchdog timed out — `didSettle=false`.
- **Exact reproduction:** coordinator: init; `setBuffer(v1)`; `save()`; +100 ms `setBuffer(v2)`; `save()`; +100 ms `removeNote(path, false)`; await p1 (resolves with v1 snapshot); p2 never settles.
- **Root cause:** `packages/vault/src/note-coordinator.ts` `removeNote` (discard=false branch) and `pump` loop-top break leave queued waiters stranded.
- **Affected files:** `packages/vault/src/note-coordinator.ts`.
- **Required change:** on note removal (with or without discard), settle all remaining waiters truthfully (resolve `null` for a removed note, or reject with a clear "note removed" error) so no promise hangs.
- **Required regression tests:** the reproduction above asserting p2 settles (resolve or reject) within a bounded time; the discard=true path (waiters resolve `null`) stays green.
- **Acceptance criteria:** no permanently pending save promise after any note-removal interleaving.
- **Dependencies:** H1 (same file).
- **What NOT to do:** do not resolve waiters as "saved" with a snapshot for a removed note.

---

## H6 — test-only hooks ship in the production bundle

- **ID:** H6
- **Severity:** P2 (security-hygiene/design)
- **Scope:** WEB
- **Problem:** `window.__vaultStorage`, `__coordinator`, `__readStorage`, `__setStorageWriteDelay` are assigned unconditionally in the production build (verified in `dist/assets/index-*.js`). Any same-origin script can bypass the coordinator's version checks, mutate `storage.write`, or read/write/remove any vault file. Do not overstate the threat model (same-origin script execution already has app-level capability), but test plumbing must not ship.
- **Evidence:** `grep` of the production bundle shows all four globals; minified source has no DEV guard.
- **Exact reproduction:** `npm run build`; serve `dist/`; `window.__vaultStorage` is defined.
- **Root cause:** `apps/web/src/hooks/useVault.ts` effect (line ~224) has no environment guard.
- **Affected files:** `apps/web/src/hooks/useVault.ts`.
- **Required change:** expose the hooks only under an explicit test/dev configuration (e.g. `if (import.meta.env.DEV || import.meta.env.MODE === 'test')`), so the production bundle eliminates them; keep the Playwright suite working against the dev server.
- **Required regression tests:** a build-time assertion that the production bundle does not contain `__vaultStorage` (CI grep or a small check script); the existing e2e suite must remain green against dev.
- **Acceptance criteria:** production builds contain no mutable testing seams.
- **Dependencies:** none.
- **What NOT to do:** do not move the hooks into a separate always-included chunk; do not gate on a runtime-visible global the app sets itself.

---

## H7 — type-aware ESLint: enable no-floating-promises and fix its real findings

- **ID:** H7
- **Severity:** P2 (tooling; the historical bug class)
- **Scope:** repo-wide
- **Problem:** `eslint.config.js` uses `typescript-eslint` `recommended` (non-type-checked); `no-floating-promises`/`no-misused-promises` cannot run. A type-aware trial found 27 floating-promise findings, ~6 real: `useVault.ts:590` (autosave effect calls `saveActiveNote()` un-awaited), `desktop-runtime.ts:131` (watcher listener) and `:353` (checkpoint timer), `note-coordinator.ts:196` (`this.pump()` — add `void`), `App.tsx` `openNote(path)` handlers. Runtime ~9 s.
- **Evidence:** temp type-aware config run (removed): `✖ 61 problems (57 errors, 4 warnings)`.
- **Exact reproduction:** run `npx eslint packages apps` with `parserOptions.projectService` + `no-floating-promises:error`.
- **Root cause:** `eslint.config.js` — no `parserOptions.project`/projectService; rules not enabled.
- **Affected files:** `eslint.config.js`, plus the ~6 production sites.
- **Required change:** add projectService to the config and enable `@typescript-eslint/no-floating-promises` (error); fix or explicitly `void`/`.catch` the real findings; optionally enable `no-misused-promises` with `checksVoidReturn` to limit event-handler noise.
- **Required regression tests:** `npm run lint` stays green; a CI grep or lint rule prevents new floating promises in the persistence/AI/watcher paths.
- **Acceptance criteria:** type-aware lint green in CI; the autosave effect, watcher listener, checkpoint timer, and pump are no longer floating.
- **Dependencies:** none.
- **What NOT to do:** do not enable a giant strict ruleset; do not disable the rules after enabling; do not add `ts-ignore`.

---

## H8 — test taxonomy / coverage truthfulness (C7 completion)

- **ID:** H8
- **Severity:** P3 (release-gate-adjacent: C7 stays PARTIAL until this is done)
- **Scope:** tests
- **Problem:** several permanent tests do not exercise what their names claim:
  1. `tests/integrity/coordinator-concurrency-probes.test.ts` does not import or use `NoteWriteCoordinator` at all — it is a hand-rolled logic copy (Probes A/B/D/E); the "coordinator" name is a lie.
  2. `note-coordinator.test.ts` "C5: removeNote with discard…" asserts only `res === null` and never checks disk (falsely green against the H3 defect).
  3. `note-coordinator.test.ts` "C2: waitForIdle synchronizes rename…" and the e2e C2 test bypass `renameDocument`/`useVault.renameNote` (H1).
  4. `browser-concurrency.spec.ts` A2/A3 uses 1200 ms < 2000 ms debounce ("exceeding debounce" title is false).
  5. No permanent e2e cases for property/AI/delete/vault-switch races.
- **Evidence:** file reads; the permanent suite passes while the corresponding defects (H1, H3) are reproducible.
- **Required change:** (1) rewrite `coordinator-concurrency-probes.test.ts` to drive the real `NoteWriteCoordinator` (or delete it); (2) add the disk assertion to the C5 unit test; (3) make the C2 unit test call `renameDocument` and add a UI-driven e2e rename case; (4) raise the permanent A2/A3 latency to 3200 ms (keep 750/1500 ms cases); (5) add permanent e2e cases for property+typing, AI+typing, delete-during-write (memory, no-resurrection), and vault-switch, all with disk read-back.
- **Acceptance criteria:** every test that claims to cover a race actually reproduces the race (latency > debounce where claimed, production functions invoked, disk asserted); C7 becomes VERIFIED.
- **Dependencies:** H1–H4 (the tests encode their acceptance).
- **What NOT to do:** do not rename files and call it coverage; do not add jsdom logic copies; do not gate on wall-clock sleeps alone.

---

## Execution order

1. **H1** (C2 production rename, P1) — first; same machinery as H5.
2. **H2** (delete-resurrection, P1 shared) — independent.
3. **H3** (C5 discard contract) + **H4** (index serialization) — P2 correctness.
4. **H5** (waiter leak) + **H6** (prod hooks) — P2/P3 hygiene.
5. **H7** (type-aware lint) — cheap, high signal.
6. **H8** (test truthfulness / C7 completion) — encodes 1–5.

Web feature freeze stays in place until H1 is fixed and verified through the ACTUAL `renameNote()` path, H3's contract is truthful, and H8's permanent coverage exists. Desktop/Electron additionally requires H2 (and the browser-FSA variant) before readiness.
