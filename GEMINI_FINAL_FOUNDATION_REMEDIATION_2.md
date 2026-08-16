# GEMINI_FINAL_FOUNDATION_REMEDIATION_2.md

Handoff from `FINAL_FOUNDATION_CLOSURE_AUDIT_2.md` (HEAD `51d7d22cdc69a3402edab268c5cf8a3a8bfbcc8e`). **Only unresolved work.** The previous H1/H6/H7/H8 items are verified done (rename normalization, prod-hook removal, type-aware lint, coordinator-driven probes). H2's storage rechecks and H3's discard restoration are NOT done correctly — they introduced new P1s. Correctness blockers first.

---

## H9 — FSA recheck builds the canonical token from the written content's hash: every FSA create AND update fails

- **ID:** H9
- **Severity:** P1 (WEB regression — FSA mode fully broken)
- **Scope:** SHARED (`packages/vault/src/browser-fsa-storage.ts`)
- **Problem:** In the pre-move recheck (added for H2), `checkToken = createVersionToken(newHash, checkFile.lastModified, checkFile.size)` — `newHash` is the hash of the content **being written**, not of the current canonical file. Verified with real OPFS in Chromium: normal update where `expectedVersion.token === canonical token` (identical hash/mtime/size, no external change) throws `ConflictError: File version modified externally during write`. Additionally the `expectedVersion === null` branch throws `Cannot create: file was created externally during write` on **every** create, because `getHandleForPath(norm, true, false)` materializes an empty canonical file before the temp write, and the null-recheck then sees it exists. Observed: `files=["New.md"]` (empty) after a failed create.
- **Evidence:** temp OPFS probes (removed): T1a `outcome=conflict … Cannot create: file was created externally during write`; T1b `expToken == canonicalToken == "01fee60d…"` yet `ConflictError … modified externally`.
- **Exact reproduction:** real Chromium + OPFS: `new BrowserFSAVaultStorage(dirHandle, 'v')`; `storage.write('Note.md', null, 'H1')` → ConflictError; raw-write H1, `storage.write('Note.md', snap.version, 'H2')` → ConflictError.
- **Root cause:** `browser-fsa-storage.ts` write(): (a) update-recheck token uses `newHash`; (b) create-path recheck cannot distinguish "file created by getHandleForPath" from "file created externally". Also `getHandleForPath(norm, true, false)` should not materialize the canonical file for a create.
- **Affected files:** `packages/vault/src/browser-fsa-storage.ts`.
- **Required change:** the recheck must hash/read the CURRENT canonical content (`checkFile.arrayBuffer()` → `computeContentHash`) and build the token from THAT hash + current mtime/size; compare against `expectedVersion`. For create (`expectedVersion === null`), recheck existence without creating (or create the temp first, then `getFileHandle(filename)` without create and require NotFoundError); the pre-move check must not be defeated by the adapter's own file materialization.
- **Required regression tests:** real-OPFS (or FileSystemFileHandle.move-capable) permanent tests: create-new-note succeeds; update-existing-note (H1→H2, expectedVersion H1, no external change) succeeds; delete-during-write (removeEntry between validation and move) still aborts with ConflictError and no resurrection; same-stat external change between validation and move detected. MemoryVaultStorage does not count.
- **Acceptance criteria:** FSA create and update both work; the H2 delete/resurrection protection still holds with truthful hashes; no false conflict when `expectedVersion` matches the canonical file.
- **Dependencies:** H10 (same file, same recheck).
- **What NOT to do:** do not drop the recheck; do not compare only token strings from stale fields; do not special-case by textContent equality.

---

## H10 — Node recheck uses the pre-validation hash with a fresh stat: same-size+same-mtime external replacement is silently overwritten

- **ID:** H10
- **Severity:** P1 (silent data loss of an external change)
- **Scope:** SHARED (`packages/vault/src/node-fs-storage.ts`)
- **Problem:** The commit-time recheck computes `currentToken = createVersionToken(existingHash!, currentStat.mtimeMs, currentStat.size)` where `existingHash` was captured at write-entry pre-validation. If the canonical file is externally replaced between validation and rename with content of identical byte length and identical mtime, `currentToken === expectedVersion.token` and the write **commits over the external change** (no ConflictError). Verified: disk ends as the OpenOb content; the external content C is destroyed. Also, the recheck never re-reads the current content, so it cannot detect same-stat hash changes at all.
- **Evidence:** temp Node probe (removed): `T2 outcome= committed … disk= EEEEFFFF` (required: conflict, disk stays `CCCCDDDD`).
- **Exact reproduction:** real `NodeFsVaultStorage` + `fs` hook: seed `AAAABBBB`; read version; hook `fs.rename` to first `writeFile('CCCCDDDD')` + `utimes` to the original mtime; `safeSave('Note.md','EEEEFFFF',{expectedVersion})` → resolves; disk == `EEEEFFFF`.
- **Root cause:** `node-fs-storage.ts` write() recheck uses the stale pre-validation hash instead of re-reading the canonical file.
- **Affected files:** `packages/vault/src/node-fs-storage.ts`.
- **Required change:** at commit time, re-read the canonical file's bytes and compute the CURRENT hash; build the token from the current hash + current mtime/size; conflict if it does not match `expectedVersion` (and abort if the file is missing).
- **Required regression tests:** permanent Node test: same-size+same-mtime replacement between validation and rename → ConflictError, disk stays C; delete between validation and rename → ConflictError, no resurrection (keep the existing H2 resurrection test green); different-size/mtime replacement → ConflictError.
- **Acceptance criteria:** no external change made after validation can be silently overwritten at commit time on Node storage.
- **Dependencies:** none.
- **What NOT to do:** do not compare hashes from the pre-validation read; do not treat "stat unchanged" as proof of content unchanged.

---

## H11 — Commit-time recheck failures are swallowed (fail-open): EACCES/EPERM/EIO during the recheck still commits

- **ID:** H11
- **Severity:** P1 (safety check cannot fail closed)
- **Scope:** SHARED (`packages/vault/src/node-fs-storage.ts`, `browser-fsa-storage.ts`)
- **Problem:** Node: injecting `EACCES` into the commit-time recheck `fs.stat` results in **commit anyway** (the `catch` only rethrows `ConflictError`/`ENOENT`; everything else falls through to `fs.rename`; the temp is consumed, canonical replaced). FSA: the pre-move recheck `catch` swallows all errors except `ConflictError`/`NotFoundError` and proceeds to `move`. A recheck that cannot fail closed provides no safety.
- **Evidence:** temp Node probe (removed): `T3 outcome= committed … disk= # REPLACEMENT` (required: aborted, canonical untouched, temp cleaned).
- **Exact reproduction:** hook `fs.stat` to throw `EACCES` once the temp file exists; `safeSave` with a valid expectedVersion → resolves and replaces the canonical file.
- **Root cause:** both recheck `catch` blocks are written to swallow non-conflict errors and continue to the commit step.
- **Affected files:** `packages/vault/src/node-fs-storage.ts`, `packages/vault/src/browser-fsa-storage.ts`.
- **Required change:** any unexpected error during the commit-time recheck must abort the write (delete the temp, leave the canonical untouched, surface a `StorageError`); only a clean "recheck passed" may proceed to rename/move.
- **Required regression tests:** Node: EACCES during recheck → aborted, temp cleaned, canonical untouched; FSA: `getFile`/`getFileHandle` error during recheck → aborted, temp removed, canonical untouched (requires the H9 fix first so the token check itself passes).
- **Acceptance criteria:** a failed or indeterminate recheck never results in a commit.
- **Dependencies:** H9 (FSA half unreachable until the false-conflict is fixed).
- **What NOT to do:** do not log-and-continue; do not treat "error" as "conflict" and surface the wrong error type; do not retry the rename blindly.

---

## H12 — Discard restores the initial snapshot, not the last durable save: baselineSnapshot is never advanced

- **ID:** H12
- **Severity:** P1 (silent loss of the last saved state)
- **Scope:** WEB (`packages/vault/src/note-coordinator.ts`)
- **Problem:** `baselineSnapshot` is assigned only at `initNote` (and `null` in the default state). After a successful durable save, only `committedSnapshot` advances. On discard mid-write, the H3 restoration writes `baselineSnapshot.textContent` (the INITIAL content) to disk. Verified: A → save B → dirty C → slow write → discard → final disk == **A**; required **B**.
- **Evidence:** temp coordinator probe (removed): `T4 … baselineSnapshot= null … final disk= "A-initial"` (getNoteState strips the field; the write-trace probe showed the restore write carries 'A-initial').
- **Exact reproduction:** coordinator: initNote(A); setBuffer(B); save() (wait for durable); setBuffer(C); save(); +100 ms removeNote(path, true); wait for the pump + restore to finish; readText == A.
- **Root cause:** `note-coordinator.ts` — `baselineSnapshot` is never updated on successful writes.
- **Affected files:** `packages/vault/src/note-coordinator.ts`.
- **Required change:** advance `baselineSnapshot` to the newly committed snapshot after every successful durable write (i.e., `baselineSnapshot = committedSnapshot` after a write whose buffer was clean at completion). Discard then restores the last durable state.
- **Required regression tests:** the saved-B → dirty-C → discard → disk == B sequence (coordinator-level with a slow write, and e2e through the real UI with a prior Ctrl+S); baseline must NOT regress to the pre-session content.
- **Acceptance criteria:** after discard, disk equals the last durably saved content of that note, never an older baseline.
- **Dependencies:** none (do before H13/H14).
- **What NOT to do:** do not restore from the tab's React state; do not use `committedSnapshot` for restoration before the restore decision is made; do not add sleeps.

---

## H13 — Discard + immediate reopen: the old discarded pump force-restores the initial content over the reopened session

- **ID:** H13
- **Severity:** P1
- **Scope:** WEB (`packages/vault/src/note-coordinator.ts`, `apps/web/src/hooks/useVault.ts`)
- **Problem:** After `removeNote(path, discard=true)` and an immediate reopen of the same path, the old pump's in-flight write lands mid-session (the reopened session's save throws ConflictError) and the old pump's baseline restoration then **force-writes** the initial content over the reopened session. Verified: reopen → edit D → save D → D conflicts; final disk == A; required D.
- **Evidence:** temp coordinator probe (removed): `T5 dSaveOutcome= ConflictError final disk= "A-initial"`.
- **Exact reproduction:** coordinator: A → save B → dirty C → slow save → discard → immediately `initNote` same path from disk → setBuffer(D) → save → wait → readText == A, D's save rejected.
- **Root cause:** the old pump's orphaned state has no tombstone/generation binding to the path; its write and restore are not invalidated when the path is re-opened.
- **Affected files:** `packages/vault/src/note-coordinator.ts` (pump/removeNote), `apps/web/src/hooks/useVault.ts` (closeTab/reopen).
- **Required change:** the coordinator must invalidate any in-flight pump for a path when that path is re-initialized (e.g., a per-path generation/tombstone token: `initNote` bumps a path epoch; the pump captures the epoch at iteration start and aborts its write/restore if the epoch changed). Discard must not be able to affect a later session on the same path.
- **Required regression tests:** the exact reopen race (coordinator-level and e2e): final disk == D; the old pump neither conflicts with nor overwrites the reopened session; no waiter hangs.
- **Acceptance criteria:** a discarded session can never write to or restore over a subsequently reopened session of the same path.
- **Dependencies:** H12 (restore content correctness), H14 (restore must be version-protected).
- **What NOT to do:** do not globally serialize reopens with pumps; do not cancel the write by removing the note from the map alone (already proven insufficient).

---

## H14 — Discard restoration uses `{ force: true }`: an external edit during restoration is silently overwritten

- **ID:** H14
- **Severity:** P1
- **Scope:** WEB (`packages/vault/src/note-coordinator.ts`)
- **Problem:** The H3 restoration `safeSave(current.path, baseline, { force: true })` bypasses all version checks. If an external process writes X between the dirty write's commit and the restoration, the restoration overwrites X. Verified: final disk == A; required X preserved (or a truthful conflict).
- **Evidence:** temp coordinator probe (removed): `T6 final disk= "A-initial"` (X written mid-window destroyed).
- **Exact reproduction:** coordinator with the restore write delayed: dirty C → discard → after C commits, externally write X → restoration force-writes A.
- **Root cause:** `note-coordinator.ts` restore path uses `force: true` without a version anchor.
- **Affected files:** `packages/vault/src/note-coordinator.ts`.
- **Required change:** the restoration must be version-protected: write the baseline only against the version the dirty write itself committed (the version observed right after the dirty write), so a concurrent external change aborts the restoration instead of being overwritten. If the restoration conflicts, surface a truthful conflict rather than force.
- **Required regression tests:** external X between dirty-commit and restore → X survives (restore aborts/conflicts); normal discard still restores the baseline; no waiter hangs.
- **Acceptance criteria:** no restore path may force-overwrite a concurrent external change.
- **Dependencies:** H12, H13.
- **What NOT to do:** do not keep `force: true`; do not restore by deleting the file and recreating it.

---

## H15 — Index guard uses wall-clock `modifiedAt` as a monotonic generation: same-timestamp generations can land stale upserts

- **ID:** H15
- **Severity:** P2
- **Scope:** WEB (`apps/web/src/hooks/useVault.ts`)
- **Problem:** `savedGen = snapshot.version.modifiedAt || Date.now()` is used as the commit generation. Two saves whose writes share the same `modifiedAt` (same millisecond, coarse FS timestamps, or restored mtimes) have equal `savedGen`, so the `savedGen >= lastIndexed` guard lets an older delayed parse/upsert land AFTER a newer one. Verified with the verbatim guard + real index: final index == v1 while disk == v2.
- **Evidence:** temp logic probe (removed): `T7 index textContent= "# v1 old" sourceHash= hash-v1`.
- **Exact reproduction:** replicate `saveActiveNote`'s guard; two snapshots with equal `version.modifiedAt`; delay the older parse; final index holds the stale content.
- **Root cause:** `apps/web/src/hooks/useVault.ts` (saveActiveNote/updateNoteProperty/applyAIProposedEdit) — wall-clock `modifiedAt` is not a unique monotonic commit generation.
- **Affected files:** `apps/web/src/hooks/useVault.ts`.
- **Required change:** use a strictly monotonic per-path generation that cannot collide (e.g., the coordinator exposes a monotonically increasing commit sequence per path, or a composite of the write counter + modifiedAt), and make the guard strictly `>` against the last-indexed generation.
- **Required regression tests:** the equal-modifiedAt interleaving (final index == newest disk version); the existing settlement invariant (index == disk, sourceHash == disk hash) stays green.
- **Acceptance criteria:** no two canonical save generations can be treated as equal by the index guard; final index always represents the newest committed version.
- **Dependencies:** none.
- **What NOT to do:** do not use `Date.now()` fallbacks; do not compare by textContent; do not drop upserts based on sleeps.

---

## H16 — Index guard has no path lifecycle: rename/delete while an old-path upsert is outstanding resurrects the old/deleted entry

- **ID:** H16
- **Severity:** P2
- **Scope:** WEB (`apps/web/src/hooks/useVault.ts`)
- **Problem:** `indexGenerationMapRef` is keyed by path and is neither cleared nor tombstoned on rename/delete. A delayed parse/upsert for a path that was renamed or deleted while in flight passes the guard and re-adds the old path to the index. Verified with the verbatim guard + real `renameDocument`: after the rename, `index.get('Old.md')` reappears; after delete + `index.remove`, `Gone.md` reappears (search/backlinks/graph would also see it).
- **Evidence:** temp logic probe (removed): `T8a oldDoc= "# Old note with link v2"`, `T8b goneDoc= "# Gone v2"`.
- **Exact reproduction:** saveActiveNote-style delayed upsert for path P; concurrently `renameDocument(P → Q)` or `deletePath(P)`; release the delay; index contains P again.
- **Root cause:** `apps/web/src/hooks/useVault.ts` — the generation map has no path-lifecycle semantics (no tombstone on rename/delete; the renamed path's generation is not migrated).
- **Affected files:** `apps/web/src/hooks/useVault.ts` (renameNote/deletePath must invalidate or migrate the map entry; the guard must reject upserts for paths no longer present in the canonical index after a lifecycle event).
- **Required change:** on rename, migrate (or drop) the old path's map entry and invalidate outstanding upserts for the old path; on delete, tombstone the path so any delayed upsert for it is dropped.
- **Required regression tests:** rename with delayed old-path upsert → no `Old.md` entry; delete with delayed upsert → no `Gone.md` entry; search/backlinks/graph queries return nothing for the removed paths.
- **Acceptance criteria:** a lifecycle event (rename/delete) always wins over an outstanding derived-index update for the removed path.
- **Dependencies:** H15 (same guard).
- **What NOT to do:** do not clear the whole map on every event (loses concurrency protection); do not add sleeps; do not rely on parse ordering.

---

## H17 — Permanent regression coverage for the storage race windows (target 9)

- **ID:** H17
- **Severity:** P2 (release-gate-adjacent; the storage race windows are CI-invisible today)
- **Scope:** tests
- **Problem:** No committed test covers: real-FSA changed-existing-file save (no FSA test file exists at all; e2e runs on the memory vault); Node delete/change between validation and rename; same-size/same-mtime commit race; saved-B → dirty-C → discard; discard + immediate reopen with an in-flight write; delayed index upsert after rename/delete. Every defect in H9-H16 is invisible to the current CI.
- **Required change:** add permanent tests: (1) a real-FSA suite (OPFS via `navigator.storage.getDirectory()` in Playwright, or an equivalent real `FileSystemFileHandle.move` path) covering create, update, delete-during-write, same-stat-change-during-write, fail-closed recheck; (2) Node validation→rename window tests (delegating `fs/promises` mock) for delete, same-stat change, EACCES recheck; (3) coordinator discard tests with a prior durable save, reopen race, and external-edit-during-restore; (4) index-guard interleaving tests (equal generations; rename/delete with delayed upsert) against the real index.
- **Acceptance criteria:** each of H9-H16 has a red-on-current-code permanent test that goes green after the fix; the fast CI gate still runs in reasonable time.
- **Dependencies:** H9-H16 (the tests encode their acceptance).
- **What NOT to do:** do not add browser-FSA tests that run against `MemoryVaultStorage`; do not gate on wall-clock sleeps alone; do not add jsdom logic copies of the storage adapters.

---

## Execution order

1. **H9** (FSA create+update fully broken — P1 regression) and **H10** (same-stat silent overwrite — P1) — the two storage recheck defects, first.
2. **H11** (fail-open recheck — P1) — same two files.
3. **H12 → H13 → H14** (discard baseline: advance → tombstone reopen → version-protect restore) — the discard data-loss class.
4. **H15 → H16** (index generation/lifecycle — P2).
5. **H17** (permanent regression coverage) — encodes 1-4.

Web feature freeze stays in place: FSA mode must save again (H9), the same-stat overwrite must be impossible (H10), recheck must fail closed (H11), and discard must restore the last durable state without clobbering reopens or external edits (H12-H14). Desktop/Electron readiness additionally requires H10/H11 before the shared storage layer is trustworthy.
