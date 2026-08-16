# POST_H17_CLOSURE_AUDIT.md

Audit type: **read / test / analyze only**. No production code modified. Temporary deterministic probes (vitest + real `NoteWriteCoordinator`/`SafeWriter`/`NodeFsVaultStorage`/`MemoryDocumentIndex`/`rebuildVaultIndex`; Playwright + real Chromium + real OPFS + real `BrowserFSAVaultStorage`) were used and **removed afterward**. Working tree is clean except the pre-existing local `reasonix.toml` modification.

## 1. Exact audited SHA

- **HEAD:** `dcf822d2d824c84c866b0ebaef4df7fa966d2a1d` — **matches the expected HEAD**; audited as-is.
- Remediation under audit: commit `dcf822d` "fix(foundation): resolve H9-H17 remediation directives with permanent concurrency hardening" (the H9-H17 remediation from `GEMINI_FINAL_FOUNDATION_REMEDIATION_2.md`).
- Working tree: clean (only `reasonix.toml` local config, pre-existing).

## 2. Baseline / gates (replayed at this HEAD)

| Gate                      | Result                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `npx vitest run`          | **45 files / 173 tests PASS** (23.6 s)                                                     |
| `npx playwright test`     | **8/8 permanent e2e PASS** (H1 rename, H12 discard, H13 reopen, A1-A4, B, hostile preview) |
| `npm run typecheck`       | PASS                                                                                       |
| `npm run build`           | PASS (chunk-size warning only)                                                             |
| `npm run lint`            | PASS — 0 errors, 4 pre-existing react-hooks warnings                                       |
| Chromium under Playwright | **151.0.7922.34**                                                                          |

CI is green, but **6 of the 8 residual classes reproduce** (1, 2, 3, 4, 5, 6). The previous H9-H17 remediation genuinely fixed the earlier H9/H10/H11/H13/H14/H15 defects; the residual failures are _new/uncovered interleavings_ the remediation did not close.

## 3. Results by audit item

### Item 1 — FSA no-move fallback `write()`: **P1 (all three sub-cases broken)**

**Code fact:** in `packages/vault/src/browser-fsa-storage.ts`, the H9-H11 pre-commit recheck (lines 259-341) exists **only inside the `typeof tempHandle.move === 'function'` branch**. The fallback (lines 343-355) removes the temp file and does a direct `getFileHandle(filename, {create:true})` + `createWritable()` with **zero recheck** — only the initial read-time validation (lines 193-239) protects it.

Forced the fallback with a spec-faithful no-move mock (external action fires in the validation→direct-write window; `createWritable()` on a removed handle throws `NotFoundError` per the FSA spec):

| Case | Scenario                                                                | Probe result                                     | Required                      | Verdict                         |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- | ------------------------------- |
| A    | update: external writes X after validation                              | `outcome=committed finalDisk="BBBB"`             | X survives; truthful conflict | **P1 — X silently overwritten** |
| B    | delete after validation                                                 | `outcome=committed existsAfter=true disk="BBBB"` | deleted note not recreated    | **P1 — resurrection**           |
| C    | create (`expectedVersion=null`): external creates X after initial check | `outcome=committed existsAfter=true disk="BBBB"` | X survives; OpenOb conflicts  | **P1 — X destroyed**            |

**Reachability in the Chromium under test:** NOT reachable. Real-browser probe in Chromium 151: `FileSystemFileHandle.prototype.move === 'function'`, `showDirectoryPicker === 'function'`, `navigator.storage.getDirectory === 'function'`. Both OPFS handles and user-picked-directory handles are instances of the same `FileSystemFileHandle`/`FileSystemDirectoryHandle` classes in Chromium, so **real user-picked handles DO provide working `move()` in Chromium 151** — OPFS behavior is not being used as proof here; it is prototype-level identity plus the direct `move()` presence check. (The native picker dialog itself cannot be automated headless.) The fallback therefore triggers only in runtimes lacking `move()` (older Safari, embedded webviews) — and in those runtimes it silently destroys data.

### Item 2 — Discard baseline, type during previous save: **P1**

**Code fact:** `packages/vault/src/note-coordinator.ts:306-313` — `baselineSnapshot` advances only when `stillDirty === false` (buffer unchanged at commit) and not discarded.

**Probe (exact mandated interleaving):** disk=A → `setBuffer(B)` → `save(B)` (150 ms physical write) → while in flight `setBuffer(C)` → `save(B)` resolves, **disk == B** ✓ → while C write in flight `removeNote(path, discard=true)` → settle.

- `[probe2] after B commit: saveStatus=saving committed=B-durable` — baseline was **not** advanced at the B commit (buffer already contained C).
- `[probe2] final disk = "A-initial" (required: "B-durable")` — the H14 discard restoration wrote baseline A over the durable B.

**Classification per the audit rule:** "If baseline remains A merely because the editor already contains C, classify P1." → **P1. The last durable save is destroyed on discard whenever the user typed during the previous save.** This is reachable in the real app on every backend (memory/FSA/Node). The permanent e2e H12 test stays green only because it types B, waits for `Saved`, and _then_ types C — it never exercises typing-during-save before discard.

### Item 3 — Delete after pre-commit recheck: **external race unclosable; OpenOb's own delete race real**

**Node (probe 3a, delegating `fs/promises` mock):** delete canonical between recheck-pass and `fs.rename` → `outcome=committed, existsAfter=true, disk="BBBB"`. **The file silently reappears.** POSIX `rename()` creates the target when missing; the recheck→rename window cannot be closed with `fs.rename`.

**FSA move-capable (probe 3b):** delete canonical between recheck-pass and `tempHandle.move()` → `outcome=committed, existsAfter=true`. **Same resurrection.**

**Explicit statement:** the storage primitives **cannot completely eliminate an external-process race in the recheck→commit window** on either backend. This is an inherent TOCTOU limit of `fs.rename`/`FileSystemHandle.move()`; closing it requires OS-level primitives (e.g. `renameat2(RENAME_NOREPLACE)`-style CAS, hard-link swap, or lock-based coordination) that Node/browser APIs do not expose. External-process deletes in that window are **best-effort** and cannot be fully guaranteed — stated, not silently papered over.

**OpenOb's OWN `deletePath()` (probe 3c):** production order (useVault.ts:570-582, no `waitForIdle`) —

- With the realistic delay seam (delay at write start): delete lands before validation → `ConflictError` → no resurrection (`probe3c-1 existsAfter=false`). Safe under that interleaving.
- Parked exactly at the post-recheck rename (own save vs own delete): `probe3c-3 existsAfter=true disk="B-slow-save" coordAbsent=true` — **the deleted file is resurrected by OpenOb's own in-flight save while the coordinator/index already consider it gone (ghost state).**
- Proposed sequencing `waitForIdle → removeNote → storage.remove` closes OpenOb's own race deterministically (`probe3c-2 existsAfter=false`).

**Determination:** OpenOb **should** sequence its own delete against the per-note coordinator. Its own delete-vs-own-save race is fully closable (unlike arbitrary external-process races) and is currently open.

### Item 4 — Path tombstone `Infinity` reuse: **P2**

**Code fact:** `useVault.ts:542` (rename old path) and `:573` (delete) set `indexGenerationMapRef.set(path, Infinity)`. Nothing ever resets it: `openNote` (329-368), `createNote` (447-500), `refreshVault` (278-293), external recreation + refresh — none touch the map. The guard `currentSeq > lastIndexed` (431-434, 642-644, 686-688) can never beat `Infinity`. The tombstone also leaks across vault switches (`setStorage` doesn't clear the map).

**Probe (verbatim guard + real index/parser):**

- CASE A (delete → create NEW Foo.md → edit → save): `saveActiveNote dropped=true finalIndex="# Foo NEW\n\nnew body"` — the **edit never re-indexes**; search/backlinks/graph see stale initial content.
- CASE B (rename → create new Foo.md → edit → save): `dropped=true finalIndex="# Foo BRAND NEW"` — same.

**P2 (audit pre-classification confirmed).** Fix direction: explicit lifecycle epochs/tombstones that a NEW legitimate lifecycle can supersede, not an eternal numeric sentinel.

### Item 5 — refreshVault vs delayed upsert: **P2**

**Code fact:** `refreshVault` (useVault.ts:278-293) → `rebuildVaultIndex` → `index.rebuild()` replaces the whole index but does **not** bump `saveSequenceRef`/`indexGenerationMapRef`. An outstanding pre-rebuild `saveActiveNote`/`updateNoteProperty`/`applyAIProposedEdit` upsert (431-434 etc.) therefore still passes the guard and lands **after** the rebuild.

**Probe:** v1 save with parse parked → disk advances to v2 → `rebuildVaultIndex` → `[probe5] after rebuild="# Note v2\n\nnew body"` → release v1 upsert → `v1Landed=YES finalIndex="# Note v1\n\nold body"`. **The full canonical rebuild is regressed by the older delayed upsert.** `createFolder() → refreshVault()` variant: same mechanism (canonical files are not at risk; this is derived-index wrongness). **P2.**

### Item 6 — Test delay seam `__setStorageWriteDelay`: **P3 / TEST (reproduced)**

**Code fact:** `useVault.ts:240-248` captures `storage.write.bind(storage)` (the **current** write) on every invocation and replaces `storage.write` with a wrapper — so each call nests another wrapper and old delays never clear.

**Probe (verbatim logic):** `set(200)` → 205 ms; `set(0)` → **214 ms** (still delayed — required ~0); `set(100), set(200), set(0)` → **318 ms** (full accumulation). Fix test plumbing: replace (not wrap) or single-level indirection.

### Item 7 — Permanent FSA coverage truthfulness

`packages/vault/src/__tests__/browser-fsa-storage.test.ts` uses `MockFileHandle`/`MockDirectoryHandle`. Determine exactly what it proves:

- **MOCK UNIT COVERAGE (move-capable branch only):** H9 create-new succeeds; H9 update with matching version succeeds; H9/H2 delete-during-write aborts `ConflictError` and no resurrection; H10 same-size+same-mtime replacement detected; H11 fail-closed on unexpected recheck error.
- It must **NOT** be described as proof of real browser File System Access behavior: the mock's `move()` is **always present**, timings are synthetic, and the **no-move fallback branch has zero coverage**.
- **REAL BROWSER COVERAGE (verified by temporary probe, not committed):** real Chromium 151 + real OPFS + real `BrowserFSAVaultStorage` — create/update/no-false-conflict **all pass** (atomicWrites=true). User-picked-directory save cannot be automated headless (native picker); closest deterministic native-handle integration is the OPFS test above, which shares the same handle class and `move()` support.

**Gap list for permanent coverage (all currently missing):** real-OPFS create/update/no-false-conflict in committed CI; no-move fallback (A/B/C races); external change during fallback; delete during fallback; Node delete-between-recheck-and-rename; FSA delete-between-recheck-and-move; type-during-save discard interleaving (item 2); own-delete vs own-save window (item 3); path reuse after delete/rename (item 4); rebuild vs delayed upsert (item 5); delay-seam reset (item 6).

### Item 8 — H9-H17 targeted re-verification (not a full re-audit)

| Directive                     | Verdict               | Evidence                                                                                                                                                                                                                               |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H9 FSA correct canonical hash | **VERIFIED COMPLETE** | recheck builds token from current canonical bytes (browser-fsa-storage.ts:261-307); real-OPFS create/update/no-false-conflict pass; mock tests 1-2 pass                                                                                |
| H10 Node current hash         | **VERIFIED COMPLETE** | recheck re-reads canonical (node-fs-storage.ts:297-301); node-fs-storage-audit test 12 (same-stat) passes                                                                                                                              |
| H11 fail closed               | **VERIFIED COMPLETE** | StorageError on unexpected recheck error in both adapters (302-306, 331-337, 333-337); audit test 13 passes                                                                                                                            |
| H12 baseline semantics        | **MOSTLY COMPLETE**   | baseline advances after clean-buffer durable writes (307-313); e2e H12 green; **residual P1 = item 2** (typing-during-save leaves baseline stale)                                                                                      |
| H13 reopen protection         | **VERIFIED COMPLETE** | epoch guard (`pathEpochMap` vs `pumpEpoch`) aborts old pump write/restore on reopen; e2e H13 green. Note: an already-started physical write still lands (known C5 limitation) but becomes the reopened baseline rather than clobbering |
| H14 version-protected restore | **VERIFIED COMPLETE** | restore uses `expectedVersion: committedSnapshot.version`, no `force` (260-262, 370-372)                                                                                                                                               |
| H15 sequence ordering         | **VERIFIED COMPLETE** | strict monotonic `++saveSequenceRef` + strict `>`; index-guard-lifecycle test 1 (equal modifiedAt) passes                                                                                                                              |
| H16 lifecycle tombstones      | **MOSTLY COMPLETE**   | rename/delete resurrection fixed (index-guard-lifecycle tests 2-3 pass); **residual P2 = item 4** (eternal Infinity blocks path reuse)                                                                                                 |
| H17 permanent coverage        | **PARTIAL**           | committed suite covers H9/H10/H11 (mock, move-only), H12/H13 (e2e), H15/H16 (guard tests); missing all gaps in item 7                                                                                                                  |

## 4. Why CI is green despite the residual failures

Every gate passes because the failing interleavings are not exercised:

- Fallback branch: no test uses a handle without `move()`.
- Item 2: e2e H12 types B, waits for `Saved`, then types C — never types during the in-flight save before discard; the coordinator C5 test never asserts disk.
- Item 3: no test forces the recheck→commit window (onBeforeCommit runs **before** the recheck, leaving recheck→rename/→move untested); deletePath is not exercised against an in-flight save.
- Item 4/5: no test reuses a tombstoned path or delays an upsert across a full rebuild.

## 5. Unfreeze decision

**KEEP THE WEB FEATURE FREEZE.**

Criteria check:

| Criterion                                                         | Status                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| no WEB/SHARED P0/P1 remains                                       | **FAIL** — items 1 (P1 fallback), 2 (P1 discard), 3 (P1 own-delete race)                                   |
| real Browser FSA create/update works                              | **PASS** (verified in real Chromium 151 + OPFS)                                                            |
| fallback path cannot silently overwrite an external edit          | **FAIL** (item 1A)                                                                                         |
| fallback path cannot resurrect a deletion                         | **FAIL** (item 1B)                                                                                         |
| discard always restores the most recent DURABLE state             | **FAIL** (item 2)                                                                                          |
| delete + active save cannot resurrect the note                    | **FAIL for OpenOb's own delete** (item 3c-3; external-process window documented as unclosable best-effort) |
| path reuse after delete/rename indexes correctly                  | **FAIL** (item 4, P2)                                                                                      |
| full index rebuild cannot be regressed by an older delayed upsert | **FAIL** (item 5, P2)                                                                                      |
| existing save/property/AI races remain green                      | **PASS** (173 unit tests green)                                                                            |
| CI remains green                                                  | **PASS**                                                                                                   |

The P2/P3 items (4, 5, 6) alone would not block feature work, but items 1-3 are reproducible data-loss paths (silent overwrite, destroyed last-durable-save, resurrected deletion) and the freeze stays until they are remediated. Do not unfreeze on cosmetic grounds; also do not unfreeze with a reproducible data-loss path.

## 6. Probe hygiene

All temporary probes removed (`tests/_posth17-tmp/`, `tests/e2e/_posth17-fsa.spec.ts`, `apps/web/src/_posth17-fsa-probe.ts`). Final `npx vitest run`: 45 files / 173 tests PASS. Working tree: clean except pre-existing `reasonix.toml`.
