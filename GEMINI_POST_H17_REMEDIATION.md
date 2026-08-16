# GEMINI_POST_H17_REMEDIATION.md

Handoff from `POST_H17_CLOSURE_AUDIT.md` (HEAD `dcf822d2d824c84c866b0ebaef4df7fa966d2a1d`). **Only unresolved work.** H9/H10/H11/H13/H14/H15 verified done; H12/H16/H17 mostly done with residuals below. Correctness blockers first (R1-R3 are P1 data-loss paths), then P2 derived-index, then test plumbing.

---

## R1 — FSA no-move fallback `write()` has no pre-commit protection: silent overwrite, resurrection, destroyed external create

- **ID:** R1
- **Severity:** P1 (silent data loss / resurrection — reachable in every runtime without `FileSystemHandle.move()`, e.g. older Safari / embedded webviews)
- **Scope:** SHARED (`packages/vault/src/browser-fsa-storage.ts`)
- **Problem:** The H9-H11 pre-commit recheck lives only inside the `move()`-capable branch. The fallback (`typeof tempHandle.move !== 'function'`) deletes the temp file and does a direct `getFileHandle(filename, {create:true})` + `createWritable()` with zero recheck, so any external change/deletion/creation in the validation→write window is silently clobbered.
- **Empirical evidence:** deterministic no-move mock probes (removed): A) external X after validation → `outcome=committed finalDisk="BBBB"` (X lost); B) delete after validation → `outcome=committed existsAfter=true disk="BBBB"` (resurrection); C) external create X → `outcome=committed` (X destroyed). Real Chromium 151 always has `move()` (verified: `FileSystemFileHandle.prototype.move === 'function'`), so the branch is dormant there but live in non-Chromium runtimes.
- **Exact reproduction:** any handle without `move()`; `storage.write(p, version, B)`; external writer replaces/deletes/creates `p` after the initial read-validation; the direct write commits B over it.
- **Root cause:** `browser-fsa-storage.ts:343-355` — the fallback skips the recheck entirely; a direct in-place `createWritable` is not an atomic swap and cannot distinguish "file was deleted/created externally" from "adapter opened it".
- **Affected files:** `packages/vault/src/browser-fsa-storage.ts`.
- **Required change:** make the fallback **fail closed** — when `move()` is unavailable, `write()` must not silently commit: surface a truthful `StorageError` ("atomic save unsupported; move() unavailable") before any in-place write, OR implement a genuinely safe non-move strategy (e.g. recheck canonical immediately before the direct write AND verify-after + abort+restore on mismatch) only if it provably cannot resurrect a deletion or overwrite a concurrent external change. Given the probe evidence (a pre-check alone still leaves the createWritable window open), fail-closed is the defensible default; treat "no safe atomic primitive" as "no save", never as "unsafe save".
- **Required regression test:** permanent test with a no-move mock (spec-faithful: external action fires in the validation→target-acquire window; `createWritable()` on a removed handle throws `NotFoundError`): A) update + external X → X survives and OpenOb aborts; B) delete → file not recreated; C) create + external X → X survives and OpenOb conflicts. All three must pass only after the fix.
- **Acceptance criteria:** no code path can silently overwrite an external edit, resurrect a deletion, or destroy an external create in the fallback; the fallback either commits safely or aborts truthfully.
- **Dependencies:** none.
- **What NOT to do:** do not "fix" by only re-checking once before the direct write (probe 1B shows the createWritable window still resurrects); do not treat the mock-with-move tests as covering the fallback; do not remove the fallback warning/`console.warn`.

---

## R2 — Discard restores the pre-session baseline when the user typed during the previous save: last durable save destroyed

- **ID:** R2
- **Severity:** P1 (silent loss of the last durable save — reachable on every backend)
- **Scope:** SHARED (`packages/vault/src/note-coordinator.ts`)
- **Problem:** `baselineSnapshot` advances only when `stillDirty === false` at commit. If the user typed C while B's write was in flight, B's commit sees `stillDirty=true` and the baseline stays A. A later discard (during C's in-flight write) then restores A, destroying the durably saved B.
- **Empirical evidence:** coordinator probe (removed), exact mandated interleaving: disk=A → `setBuffer(B)` → `save(B)` slow → `setBuffer(C)` → `save(B)` resolves with disk==B → C write in flight → `removeNote(path, discard=true)` → settle → `final disk = "A-initial"` (required `"B-durable"`). After the B commit: `saveStatus=saving committed=B-durable` — baseline was not advanced because the buffer already contained C.
- **Exact reproduction:** coordinator: initNote(A); setBuffer(B); save(); +30 ms setBuffer(C); await save() (disk==B); +30 ms removeNote(path, true); settle 600 ms; `readText == A-initial`.
- **Root cause:** `note-coordinator.ts:306-313` — the baseline-advance condition is coupled to buffer cleanliness instead of to durable-commit success.
- **Affected files:** `packages/vault/src/note-coordinator.ts`.
- **Required change:** advance `baselineSnapshot` to the committed snapshot on **every successful durable write when not discarded**, regardless of `stillDirty` (i.e. drop the `!stillDirty` gate; keep the `!current.isDiscarded` guard). The pump already re-reads/writes C next, so the baseline tracks the last durably committed state, and H14's discard restoration then writes B — not A.
- **Required regression test:** permanent coordinator test preserving the **exact interleaving** above (B write in flight → setBuffer(C) → assert disk==B at save(B) resolution → discard during C write → assert final disk==B, and that it is neither A nor C). Keep the existing e2e H12 test green.
- **Acceptance criteria:** discard always restores the most recent DURABLE state of the note, never an older baseline, even when the buffer changed during the previous save.
- **Dependencies:** none (H12/H14 already correct for the clean-buffer case; this closes the dirty-buffer case).
- **What NOT to do:** do not restore from React tab state; do not use `committedSnapshot` as the restore source (it may hold the discarded C); do not add sleeps; do not advance the baseline while `isDiscarded` is set.

---

## R3 — `deletePath()` does not wait for the per-note coordinator: OpenOb's own in-flight save resurrects the deleted file

- **ID:** R3
- **Severity:** P1 (own-delete race: deleted file resurrected by own save; ghost state — disk has file, coordinator/index gone)
- **Scope:** WEB (`apps/web/src/hooks/useVault.ts`)
- **Problem:** `deletePath()` (useVault.ts:570-582) calls `storage.remove` without `coordinator.waitForIdle(path)`. If OpenOb's own save is parked at the storage recheck→rename/move commit, the delete lands and the commit then recreates the file.
- **Empirical evidence:** coordinator + real `NodeFsVaultStorage` probes (removed): with the write parked at the post-recheck rename, production-order delete → `existsAfter=true disk="B-slow-save" coordAbsent=true` (resurrection). Same delete with `waitForIdle → removeNote → storage.remove` → `existsAfter=false`. With the delay seam at write start (the common interleaving) both orders are safe — the defect is the commit-window interleaving, which is real but narrow.
- **Exact reproduction:** slow save of note (delay seam > 0); park the write at the storage rename; run production `deletePath` (storage.remove + index.remove + removeNote + closeTab + refreshVault); release the write; file reappears with the saved content while coordinator/index are empty.
- **Root cause:** `deletePath()` is not sequenced against the coordinator pump; the pump cannot cancel an already-started physical write, and `removeNote`'s epoch bump only stops *future* iterations, not the parked commit.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (`deletePath`; also consider `renameNote` already does waitForIdle at line 536 — delete should match).
- **Required change:** sequence the delete: `await coordinator.waitForIdle(path)` → `coordinator.removeNote(path)` → `indexGenerationMapRef.set(path, …)` (tombstone) → `storage.remove(path)` → `index.remove(path)` → `closeTab(path, true)` → `refreshVault()`. After `waitForIdle` no physical write is in flight; after `removeNote` no new save can start (`save()` returns null for absent notes), so OpenOb's own delete deterministically wins.
- **Required regression test:** coordinator+storage test forcing the post-recheck commit window (delegating `fs/promises` mock parking `rename`): in-flight save + `deletePath` production order → resurrection (red on current code); with the sequenced order → file absent, coordinator absent, no resurrection after settle. Also keep the existing delay-seam variant green.
- **Acceptance criteria:** OpenOb's own delete + active save never leaves the note present on disk after settle (file absent, coordinator absent, index absent).
- **Dependencies:** none.
- **What NOT to do:** do not delete while a pump is mid-`safeSave` without `waitForIdle`; do not rely on the epoch bump alone to cancel a parked write; do not claim external-process races are closed (they are best-effort, see R8).

---

## R4 — Eternal `Infinity` tombstone blocks legitimate path reuse after delete/rename

- **ID:** R4
- **Severity:** P2 (derived index stale — search/backlinks/graph miss edits to a recreated note)
- **Scope:** WEB (`apps/web/src/hooks/useVault.ts`)
- **Problem:** rename/delete tombstone the path with `Infinity` (lines 542, 573). Nothing ever resets it: `openNote`, `createNote`, `refreshVault`, external recreation, and vault switches (`setStorage`) all leave it. `currentSeq > Infinity` is always false, so every subsequent `saveActiveNote`/`updateNoteProperty`/`applyAIProposedEdit` upsert for the reused path is dropped.
- **Empirical evidence:** verbatim-guard probes (removed) with real `MemoryDocumentIndex`/parser: CASE A delete→create NEW Foo.md→edit→save → `dropped=true finalIndex="# Foo NEW\n\nnew body"` (edit lost); CASE B rename→create new Foo.md→edit→save → `dropped=true finalIndex="# Foo BRAND NEW"` (edit lost).
- **Exact reproduction:** create Foo.md; save; deletePath(Foo.md); createNote(Foo.md); edit; Ctrl+S; search/backlinks/graph still show the initial createNote content.
- **Root cause:** a numeric sentinel (`Infinity`) is used as a tombstone; it is indistinguishable from "this path must never index again" and can never be superseded by a new legitimate lifecycle.
- **Affected files:** `apps/web/src/hooks/useVault.ts`.
- **Required change:** replace the eternal sentinel with explicit lifecycle state that a NEW legitimate lifecycle can supersede, e.g. a per-path lifecycle epoch: `initNote`/`createNote`/`openNote` bump a path lifecycle epoch and clear the tombstone; the guard compares `(lifecycleEpoch, seq)` pairs or stores `{ epoch, seq }`; rename/delete tombstone with `{ epoch: currentEpoch, seq: Infinity }` so a later `initNote` at the same path starts a fresh epoch whose seqs are comparable. Ensure `refreshVault`/`setStorage` semantics are defined (rebuild is a full-reset event, see R5).
- **Required regression test:** permanent tests for CASE A and CASE B (delete→recreate→edit→save and rename→recreate→edit→save) asserting `index.get(path).textContent` contains the edited content, plus the existing H16 resurrection tests (delayed upsert after rename/delete dropped) staying green.
- **Acceptance criteria:** a NEW legitimate lifecycle at a reused path indexes normally; delayed upserts from the REMOVED lifecycle are still dropped.
- **Dependencies:** R5 (both touch the guard/rebuild interaction).
- **What NOT to do:** do not clear the whole map on every lifecycle event (loses H15/H16 concurrency protection); do not keep `Infinity` in any form that outlives a path's lifecycle; do not add sleeps.

---

## R5 — `refreshVault` full rebuild can be regressed by an outstanding pre-rebuild delayed upsert

- **ID:** R5
- **Severity:** P2 (derived-index regression; canonical files not at risk)
- **Scope:** WEB (`apps/web/src/hooks/useVault.ts`)
- **Problem:** `refreshVault()` rebuilds the index from canonical disk via `rebuildVaultIndex`→`index.rebuild()`, but does not bump `saveSequenceRef`/`indexGenerationMapRef`. A delayed parse/upsert that started before the rebuild still passes `currentSeq > lastIndexed` and lands after the rebuild, regressing the index to the older content.
- **Empirical evidence:** verbatim-guard probe (removed): v1 save parse parked → disk advances to v2 → `rebuildVaultIndex` (`after rebuild="# Note v2\n\nnew body"`) → release v1 upsert → `v1Landed=YES finalIndex="# Note v1\n\nold body"`. `createFolder() → refreshVault()` shares the same mechanism.
- **Exact reproduction:** save v1 (parse+upsert delayed); canonical advances to v2; `refreshVault()`; release the v1 upsert; index shows v1 while disk is v2.
- **Root cause:** the rebuild is a full-reset event but the guard treats it as if nothing happened; outstanding per-path seqs remain valid.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (`refreshVault`/`saveActiveNote`/`updateNoteProperty`/`applyAIProposedEdit`).
- **Required change:** make a full rebuild invalidate outstanding upserts — e.g. in `refreshVault`, after the rebuild completes, advance `saveSequenceRef.current` beyond every outstanding seq AND set each rebuilt path's map entry to the new baseline (or clear per-path entries for paths absent from the new index); with R4's lifecycle epochs, a rebuild can bump the global epoch so any pre-rebuild upsert fails the guard. Ensure the rebuild result (v2) is the floor: a post-rebuild save still indexes normally.
- **Required regression test:** permanent test with a gated parse: v1 delayed upsert released after a full rebuild of v2 → final index == v2 (exact probe-5 interleaving), plus the createFolder variant.
- **Acceptance criteria:** a full canonical rebuild always wins over any pre-rebuild delayed upsert; final index equals the newest canonical content.
- **Dependencies:** R4 (epoch design shared).
- **What NOT to do:** do not serialize all upserts with global locks; do not drop the monotonic guard; do not rely on parse ordering; do not clear the map unconditionally without also fixing R4's reuse semantics.

---

## R6 — `__setStorageWriteDelay` nests wrappers: `set(0)` never restores zero delay, delays accumulate

- **ID:** R6
- **Severity:** P3 (TEST plumbing)
- **Scope:** TEST (`apps/web/src/hooks/useVault.ts:240-248`)
- **Problem:** each call wraps the *current* `storage.write`, so old delay closures persist and accumulate.
- **Empirical evidence:** verbatim-logic probe (removed): `set(200)`→205 ms; then `set(0)`→214 ms (required ~0); `set(100);set(200);set(0)`→318 ms (accumulated 300 ms).
- **Exact reproduction:** `__setStorageWriteDelay(200)`; `__setStorageWriteDelay(0)`; measure `storage.write` latency — still ~200 ms.
- **Root cause:** the seam stores the pre-wrapped `write` inside each new closure instead of replacing a single indirection.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (DEV-only seam).
- **Required change:** single-level indirection: keep the original `write` once and have `setDelay(d)` only change the delay value used by that one wrapper (e.g. a module-level `delayMs` read inside a wrapper installed once, or store `storage.write` original and re-bind the wrapper to it each time).
- **Required regression test:** permanent test: set(200)→~200 ms; set(0)→<50 ms; set(100);set(200);set(0)→<50 ms.
- **Acceptance criteria:** the last call's delay is the only effective delay; no accumulation.
- **Dependencies:** none.
- **What NOT to do:** do not remove the seam (the e2e latency tests depend on it); do not fix only the e2e tests to compensate.

---

## R7 — Permanent regression coverage for the residual windows (H17 gaps)

- **ID:** R7
- **Severity:** P2 (release-gate-adjacent; the failing paths above are CI-invisible today)
- **Scope:** tests
- **Problem:** no committed test covers: no-move fallback (R1 A/B/C); typing-during-save discard (R2); recheck→rename/move delete window, Node + FSA (R3, plus the unclosable external variant documented); own-delete vs own-save (R3); path reuse after delete/rename (R4); rebuild vs delayed upsert (R5); delay-seam reset (R6); real-OPFS create/update/no-false-conflict (verified only via a temporary probe).
- **Required change:** permanent tests: (1) no-move mock suite for R1 (spec-faithful mock without `move()`); (2) coordinator discard suite for R2 (exact interleaving, disk assertions); (3) delegating `fs/promises` mock for R3 Node recheck→rename window + sequenced deletePath; (4) FSA mock (move-capable) for the recheck→move window; (5) verbatim-guard index tests for R4/R5 (reuse + rebuild); (6) delay-seam reset test; (7) a real-OPFS Playwright case (Chromium-only, gated) exercising create/update/no-false-conflict through the real `BrowserFSAVaultStorage`.
- **Acceptance criteria:** each R1-R6 has a red-on-current-code permanent test that goes green after the fix; the fast CI gate stays reasonable.
- **Dependencies:** R1-R6 (the tests encode their acceptance).
- **What NOT to do:** do not add browser-FSA tests against `MemoryVaultStorage`; do not gate on wall-clock sleeps alone; do not copy storage-adapter logic into jsdom.

---

## R8 — Document the unclosable external-process TOCTOU window

- **ID:** R8
- **Severity:** P3 (documentation / risk disclosure)
- **Scope:** docs + storage adapters
- **Problem:** an external process that deletes/changes the canonical in the final recheck→`fs.rename` (Node) or recheck→`FileSystemHandle.move` (FSA) window wins: the commit recreates/overwrites. The storage primitives cannot fully eliminate this; probes prove both backends resurrect a deletion in that window.
- **Empirical evidence:** Node probe: `outcome=committed existsAfter=true disk="BBBB"` after an external delete between recheck-pass and rename; FSA probe: `outcome=committed existsAfter=true` after delete between recheck-pass and move.
- **Exact reproduction:** park `fs.rename` (or the mock `move`) after the recheck passes; external `unlink`/`removeEntry` of the canonical; release; file reappears.
- **Root cause:** TOCTOU between the last consistency check and the atomic commit; `rename`/`move` create the destination when missing.
- **Affected files:** `packages/vault/src/node-fs-storage.ts`, `packages/vault/src/browser-fsa-storage.ts` (comment), `FAILURE_REGISTRY.md`/`ARCHITECTURE.md`.
- **Required change:** record the limitation explicitly (FAILURE_REGISTRY entry + inline comments): external-process delete-during-commit is best-effort, not guaranteed; OpenOb's own writes are fully serialized via the coordinator (R3). If a future milestone needs hard guarantees, specify `renameat2(RENAME_NOREPLACE)`-class or lock-based coordination for the Node backend.
- **Required regression test:** n/a (the window is inherent; the permanent tests from R3/R7 document the boundary — the *own-delete* variant must pass, the *external* variant is recorded as a known limit).
- **Acceptance criteria:** the repo's docs and failure registry state the exact residual race and why it is not closable with the current primitives; no doc claims external-process delete-during-write is fully prevented.
- **Dependencies:** R3 (own-delete closure makes the statement precise).
- **What NOT to do:** do not claim complete external-race safety; do not attempt fragile post-commit "detect and delete" heuristics that could delete a NEW external file.

---

## Execution order

1. **R1, R2, R3** (P1 data-loss paths) — storage fallback fail-closed; baseline advance; delete sequencing.
2. **R4, R5** (P2 index lifecycle/rebuild) — shared epoch design, do together.
3. **R6** (P3 test plumbing) — trivial.
4. **R7** (permanent regression coverage) — encodes 1-3 and 4-6.
5. **R8** (documentation of the inherent TOCTOU limit) — alongside R3.

Web feature freeze stays in place until R1, R2, R3 are closed with their regression tests green (per `POST_H17_CLOSURE_AUDIT.md` §5). The P2/P3 items (R4-R6) alone would not block feature work, but the freeze is held by the P1 data-loss paths.
