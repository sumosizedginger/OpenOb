# OpenOb — Gemini Final Remediation

Source: `FINAL_CLOSURE_AUDIT.md` (HEAD `5ec3cd0`, audit pass read/test/analyze only).
This document contains ONLY unresolved findings from the closure audit, as a specific engineering order. Do not rediscover the problems; execute the tasks.

**Handoff rules (mandatory):**
- Electron is deferred. Do not add Electron as part of remediation (no IPC, preload, packaging, installers, or Electron dependencies).
- Do not begin new roadmap features.
- Do not perform unrelated refactors.
- Fix P0/P1 before P2 before P3.
- Preserve canonical Markdown ownership (files remain authoritative; derived state rebuilds from them).
- Preserve browser-local File System Access support.
- Do not trade correctness for benchmark numbers (the T6 hash-verify behavior must not be silently weakened).
- Do not weaken tests.
- Do not claim completion without reproducible evidence (state the command + result for each acceptance criterion).

---

### Task F1

**Task ID:** F1 · **Severity:** P1
**Problem:** Autosave opportunity is permanently consumed when an in-flight save is active: typing during a slow save leaves the tab dirty with a lying `saveStatus: 'saved'` and no further autosave ever fires — silent edit loss on app close.
**Exact evidence/reproduction:** Browser probe A (real hook, 3.2 s slow storage): manual save of v1; typed v2 at +0.8 s; completion → editor v2, disk v1, `isDirty` true, `saveStatus 'saved'`, no autosave re-arm in 7 s of polling.
**Files involved:** `apps/web/src/hooks/useVault.ts` (saveActiveNote :333-384, autosave effect :528-536).
**Required change:** (1) When `saveActiveNote` early-returns because `isSavingRef.current` is true, DO NOT consume the opportunity — re-arm the autosave timer (defer, or set a pending-save flag). (2) After a save completes, if the tab is still dirty (`isStillMatching === false`), explicitly re-trigger the autosave effect (e.g., a save-generation counter in the effect deps). (3) `setSaveStatus('saved')` only when the saved content matches the current buffer.
**Architectural constraints:** Keep SafeWriter as the only write path; keep autosave debounce; do not make saves synchronous.
**Required regression tests:** slow-storage test (delay write ≥ 2× debounce): type during save → assert isDirty stays true, a second autosave fires, disk eventually equals the editor buffer, and saveStatus is truthful. This test must run in a real DOM/browser (Playwright or jsdom with real timers) — a mock that does not overlap operations is not acceptable.
**Acceptance criteria:** probe A passes: editor == disk eventually, isDirty false only when content matches, saveStatus never 'saved' while dirty.
**Dependencies:** none.
**What not to do:** Do not remove the isSavingRef guard; do not drop the debounce; do not auto-save on every keystroke.

### Task F2

**Task ID:** F2 · **Severity:** P1
**Problem:** The tab-switch guard is a self-comparison no-op: `if (activeTabPath === savingPath)` compares a closure variable to itself (both from the same render) so it always passes. A save completing for tab A while tab B is active clobbers B's preview, backlinks, and save-status and can mark a dirty B as 'saved' (falsely claimed fixed in the previous remediation).
**Exact evidence/reproduction:** Browser probe B: saved Welcome.md slowly, switched to Kaelen.md and typed; on completion `parsedDoc.path === 'Welcome.md'`, B's backlinks replaced, `saveStatus 'saved'` while B isDirty.
**Files involved:** `apps/web/src/hooks/useVault.ts` (:363 guard; post-save bookkeeping :360-376).
**Required change:** Track the live active tab via a ref (`activeTabPathRef` updated on every render) or a per-save generation token; guard the post-save `setParsedDoc/setBacklinks/setSaveStatus/setConflictData` with the actual current tab identity at completion time.
**Architectural constraints:** none beyond correctness of the existing state shape.
**Required regression tests:** slow-storage tab-switch test: assert completion of A never writes B's preview/backlinks/status; B's dirty state preserved.
**Acceptance criteria:** probe B passes: after A completes, `parsedDoc.path === 'Characters/Kaelen.md'`, B's backlinks intact, B `isDirty` true, `saveStatus` not 'saved'.
**Dependencies:** F1 (same hook; do together).
**What not to do:** Do not remove the parsedDoc/backlinks updates for the correct tab; do not make the guard a string compare of the same value.

### Task F3

**Task ID:** F3 · **Severity:** P1
**Problem:** No post-await commit point: `updateNoteProperty` and `applyAIProposedEdit` run the divergence check BEFORE the async save, then unconditionally replace the buffer afterwards. Human keystrokes typed during the save are lost from state AND never reach disk, and the tab is falsely marked clean (no conflict surfaced).
**Exact evidence/reproduction:** Browser probes D (property) and E (AI): typed during the slow save → buffer replaced by property-updated/AI content, `isDirty:false`, human text absent from buffer and disk, `conflictData` null.
**Files involved:** `apps/web/src/hooks/useVault.ts` (updateNoteProperty :539-570, applyAIProposedEdit :614-691).
**Required change:** After the await, re-check the current buffer still equals the pre-operation content (the `originalContent`/captured text). If the user typed during the save: do not replace the buffer; set `isDirty` accordingly; surface a conflict (reuse the ConflictError path) instead of clobbering. Keep the disk-level expectedVersion protection exactly as-is.
**Architectural constraints:** F-028/F-029 ("human work wins over stale AI output") is the contract; SafeWriter remains the only write path.
**Required regression tests:** slow-storage tests for both functions: type during the apply → assert the human text survives in state, the tab is dirty, and a conflict is surfaced (or the operation aborts); same for property mutation.
**Acceptance criteria:** probes D/E pass: human text not lost, not falsely clean; disk content reflects the winning side with a visible conflict.
**Dependencies:** F1/F2 (same file; do together).
**What not to do:** Do not bypass SafeWriter/expectedVersion to 'fix' the race; do not auto-dismiss conflicts.

### Task F4

**Task ID:** F4 · **Severity:** P1 (deferred desktop-runtime scope)
**Scope note:** This defect blocks future Electron/desktop delivery, not the current browser-local GitHub Pages product (Electron is deliberately deferred). It remains P1, the code already exists, and it MUST still be executed in this remediation pass (Wave B) — but the web feature-unfreeze decision must not depend on it. Do not dismiss or delete this task.
**Problem:** `setSecret` reports success when persistence failed: injected temp-write (ENOSPC) and rename (EPERM) failures resolve normally, the secret exists only in memory, and a fresh store sees null — a durable write silently became ephemeral. `getLoadError()` is never surfaced by any runtime/UI code, so a corrupt secrets file or wrong passphrase still looks like "no saved keys".
**Exact evidence/reproduction:** vitest probe (vi.mock on `node:fs`): `writeFileSync` throw → `setSecret` resolved, memory secret present, file absent, fresh store `null`; `renameSync` throw → resolved; mkdir failure → throws (inconsistent). `grep getLoadError` → only secure-storage.test.ts.
**Files involved:** `packages/desktop/src/secure-storage.ts` (persistToDisk :159-188, setSecret :61-71), `packages/desktop/src/desktop-runtime.ts` or the web settings surface that consumes secrets.
**Required change:** (1) `persistToDisk` must throw (or `setSecret`/`clearSecret` must reject) on write/rename failure — the API must not convert a durable write into an ephemeral one silently. (2) Surface `getLoadError()` (corrupt file / wrong passphrase) in the UI: settings view shows "secrets file failed to load/decrypt" rather than an empty key list. (3) Make failure semantics consistent across mkdir/temp-write/rename (all throw).
**Architectural constraints:** SecretStore interface shape may gain a typed error but must keep `getSecret` returning null on wrong passphrase (no plaintext leaks); masterSecret fail-closed wiring unchanged.
**Required regression tests:** injected ENOSPC/EPERM on write and rename → `setSecret` rejects and the in-memory cache is not silently treated as persisted; corrupt-file load → load error surfaced through the runtime; wrong-passphrase load → distinguishable from empty store.
**Acceptance criteria:** no silent ephemeral writes; load/persist failures are observable by the user; probe from this audit fails (setSecret rejects).
**Dependencies:** none.
**What not to do:** Do not log secrets; do not return plaintext on corrupt records; do not remove the write lock.

### Task F5

**Task ID:** F5 · **Severity:** P2
**Problem:** T6's hash-verify-everything reconciliation regressed warm start ~10×: 100k persistent restart 4.8 s → 46.6 s (0 changed), 50.7 s (1 changed), 104.6 s (100 changed); 10k 451 ms → 3.9 s. Correct, but an operational regression. These numbers remain the baseline in `FINAL_CLOSURE_AUDIT.md` (sections 9/10) — do not rewrite that history after optimizing.
**Exact evidence/reproduction:** closure benchmark (section 9/10 of FINAL_CLOSURE_AUDIT.md), warm0/warm1/warm100 columns.
**Files involved:** `packages/desktop/src/desktop-runtime.ts` (reconcile :124-207), plus whatever surface exposes reconciliation state.
**Required change — two-stage reconciliation model (do NOT make filesystem timestamps the ultimate correctness boundary):**

**Stage A — Fast synchronous reconciliation (before the app becomes interactive):**
1. enumerate canonical Markdown paths;
2. detect added paths;
3. detect deleted paths;
4. detect obvious changes from persisted stat metadata;
5. immediately reconcile the obvious changes;
6. establish that the existing persistent index is structurally usable.

Persist filesystem metadata (size, mtime, ctime where available) and use it to identify likely-unchanged files efficiently. These values are optimization hints only — NOT the final integrity guarantee.

Target: `100k unchanged vault: time-to-interactive < 15 s` (prefer substantially lower). Do not weaken canonical-file authority to hit this target.

**Stage B — Background integrity verification (after the app is interactive):**
- bounded-concurrency hash verification of canonical files;
- must not block the UI;
- must not mutate canonical Markdown;
- compare canonical file hash against the persisted index hash;
- reconcile any mismatch discovered;
- update metadata when contents are unchanged but stats differ;
- expose reconciliation state to the application (recommended state model: `ready | verifying | degraded | verified`, or equivalent). While verification runs, the UI must truthfully indicate the derived index is being verified; do not claim full verification until Stage B finishes.

**Correctness contract (all must remain detectable):** same-size change; same-mtime change; same-size + same-mtime change; externally replaced file; git/sync restoration behavior; offline rename; offline add; offline delete. Do NOT restore the old `(size,mtime)`-only skip logic. Do NOT make ctime the sole proof of equality. Canonical Markdown remains authoritative.
**Architectural constraints:** same-size + same-mtime detection must keep passing (the SQLite suite case from this audit is the regression guard); no canonical write performed by reconciliation; the index state must be exposed truthfully.
**Required regression tests:** same-size+same-mtime hostile case PASS; offline add/delete/rename PASS; canonical-wins PASS; background verification completes correctly; index state exposed truthfully while verification is active; no canonical write performed by reconciliation.
**New measurements (record separately, do not merge):** time-to-interactive AND time-to-complete-verification, at 10k / 50k / 100k, each with 0 changed / 1 changed / 100 changed. Do NOT require complete 100k hash verification itself to finish within the interactive-startup budget — those are separate metrics.
**Acceptance criteria:**
```text
same-size + same-mtime hostile case: PASS
offline add/delete/rename: PASS
canonical-wins: PASS
100k time-to-interactive: < 15 s
background verification completes correctly
index state exposed truthfully while verification is active
no canonical write performed by reconciliation
```
**Dependencies:** none (orthogonal to F1-F4).
**What not to do:** Do not revert to stat-only skip; do not drop hash verification for changed files; do not make ctime the sole proof of equality; do not claim the index is verified while Stage B is still running; do not block the UI on Stage B.

### Task F6

**Task ID:** F6 · **Severity:** P2
**Problem:** No `base` in `apps/web/vite.config.ts` → production build emits absolute asset paths; GitHub Pages under `/OpenOb/` 404s all assets.
**Exact evidence/reproduction:** `apps/web/dist/index.html` contains `src="/assets/index-*.js"`; vite.config.ts has no `base`.
**Files involved:** `apps/web/vite.config.ts` (+ a subpath deployment config for Pages, e.g., `.github/workflows/deploy.yml` or repo Pages settings).
**Required change — portable base (do NOT hardcode `/OpenOb/`):** OpenOb is open source; forks, renamed repositories, custom domains, and alternate static hosts must not require editing application source merely to load assets. Prefer one of: (1) a relative Vite asset base (`base: './'`) where compatible with the current router-free SPA, or (2) an environment/config-driven base supplied during build (conceptually `base: process.env.VITE_BASE_PATH || './'`, or the equivalent supported Vite mechanism — do not blindly use this snippet if the repo config requires another mechanism).
**Architectural constraints:** the browser app must remain backend-free; do not add Electron as the workaround; local development must keep working.
**Required regression tests:** serve the production build mounted under at least `/OpenOb/` AND one differently named subpath (e.g. `/fork-name/`) — both must load ALL assets successfully (no 404s); local `npm run dev` still works.
**Acceptance criteria:** GitHub Pages `/OpenOb/` works; repository forks work; local development works; custom static hosting remains possible; zero 404s under both tested subpaths; no backend introduced.
**Dependencies:** none.
**What not to do:** Do not hardcode `/OpenOb/` in source; do not hardcode absolute CDN paths; do not introduce a server.

### Task F7

**Task ID:** F7 · **Severity:** P3
**Problem:** (1) VERIFIED — `atomicWrites` getter checks `FileSystemHandle.prototype.move`, but in Chromium `move()` lives on `FileSystemFileHandle.prototype` → the flag reports false on a fully capable browser (conservative direction; writes are still atomic via the subclass method). (2) The no-`move()` fallback direct-write provides no atomic replacement guarantee and only emits a console.warn (no UI notice). **Scope of the truncation claim:** whether an interrupted/failed fallback `createWritable()` actually leaves canonical content damaged was NOT empirically reproduced in this audit (the fallback is unreachable in Chromium 1228, where `move()` exists on the subclass). The limitation must be described as "atomic replacement guarantee unavailable or unverified" until reproduced — not as demonstrated corruption.
**Exact evidence/reproduction:** browser probe: `FileSystemHandle.prototype.move` undefined, `FileSystemFileHandle.prototype.move` function, `storage.atomicWrites` false; fallback write works with `atomicWrites=false`.
**Files involved:** `packages/vault/src/browser-fsa-storage.ts` (getter, fallback path :220-247).
**Required change (in order):**
1. fix capability detection (check `FileSystemFileHandle.prototype.move ?? FileSystemHandle.prototype.move`, or probe an instance);
2. surface the non-atomic/degraded capability state to the user (banner/status, not console-only); consider gating saves behind explicit user acceptance on no-`move()` browsers;
3. TEST fallback failure behavior: inject a failed/interrupted direct write on a no-`move()` browser (or an equivalent simulation) and inspect whether canonical content is damaged;
4. determine, based on the empirical result, whether interrupted/failed `createWritable()` leaves canonical content damaged in the target browser implementation.

Classification rule: if canonical truncation/corruption is empirically reproduced → reclassify the fallback as a data-safety defect (reopen as P1/P2); if not reproduced → describe the limitation accurately as "atomic replacement guarantee unavailable or unverified". Do not claim demonstrated corruption without reproduction.
**Architectural constraints:** preserve FSA support; the flag must truthfully reflect capability; do not weaken the existing temp+move path.
**Required regression tests:** getter returns true in Chromium without tampering; with move removed from both prototypes, fallback engages with flag false + notice; fallback failure-injection test asserting the actual outcome (damaged-or-intact) rather than assuming truncation.
**Acceptance criteria:** flag truthful on Chromium; users are informed when atomicity is unavailable; fallback failure behavior is measured, not assumed.
**Dependencies:** none.
**What not to do:** Do not remove the temp+move path; do not claim atomicity where unavailable; do not assert fallback truncation without empirical reproduction.

### Task F8

**Task ID:** F8 · **Severity:** P3
**Problem:** Carry-over: metadata contract uses `(doc as any).modifiedAt/size/hash` (sqlite-index.ts:264-269, rebuilder.ts:41-42) — data is correct in the desktop path but untyped; plugin/parity callers silently store 0.
**Files involved:** `packages/index/src/sqlite-index.ts`, `packages/index/src/rebuilder.ts`, `packages/core/src/document.ts` (ParsedDocument type).
**Required change:** Add optional `modifiedAt?: number; size?: number` to `ParsedDocument` (typed contract), populate from the storage snapshot in the rebuild path, drop the `as any` casts.
**Required regression tests:** upsert with and without metadata typed (manifest carries fs stat; no 0 fallback for typed callers).
**Acceptance criteria:** no `(doc as any).modifiedAt`/`.size`/`.hash` remains; typecheck passes.
**Dependencies:** none.
**What not to do:** Do not remove the metadata from the manifest (reconciliation depends on it).

### Task F9

**Task ID:** F9 · **Severity:** P3
**Problem:** No permanent regression coverage for the three P1 concurrency races, no browser tests at all, the scale harness is not wired into CI, and no browser smoke job exists (T11 unmet).
**Files involved:** `tests/` + `.github/workflows/ci.yml` (+ Playwright as a devDependency if the team accepts it).
**Required change:** (1) Promote the slow-storage browser tests for F1/F2/F3 into the permanent suite (Playwright or jsdom with real overlap — the tests must actually overlap operations; a mock that doesn't is not acceptable). (2) Add a browser smoke job (open vault → edit → save → reload → verify; hostile-payload preview smoke). (3) Wire the scale harness per measured runtimes: per-commit = fast correctness + 1k/10k gates; scheduled/manual = 50k/100k + real-browser integration.
**Architectural constraints:** keep `npm test` fast (< ~60 s); benchmark opt-in flag preserved.
**Required regression tests:** the promoted probes themselves (A/B/D/E scenarios).
**Acceptance criteria:** `npm test` fails if any of the three concurrency races regresses; CI runs the smoke job; 50k/100k run on schedule.
**Dependencies:** F1/F2/F3 (tests prove the fixes).
**What not to do:** Do not add flaky timing assertions with meaningless thresholds; do not put 100k on every push.

### Task F10

**Task ID:** F10 · **Severity:** P3
**Problem:** Node `write()` returned snapshot omits `hasBom` (read() sets it); `readText()` still strips BOM via default decode.
**Files involved:** `packages/vault/src/node-fs-storage.ts` (write snapshot :302-309, readText :175).
**Required change:** Set `hasBom` on the write snapshot (content already carries the BOM char when present); use `ignoreBOM:true` decode in readText or document the difference.
**Required regression tests:** write → snapshot.hasBom matches the input's BOM state.
**Acceptance criteria:** snapshot metadata consistent between read and write.
**Dependencies:** none.
**What not to do:** Do not double-emit BOMs.

---

## Execution order

```text
Wave A — Browser state integrity
F1 + F2 + F3
```
Land F1+F2+F3 together (one change set in `useVault.ts`) WITH their permanent overlapping-operation regression tests (real slow-storage overlap — a mock that does not actually overlap operations is not acceptable). Then **STOP**. Re-run probes A, B, D, E — they must ALL pass.

```text
Wave B — Existing desktop-runtime correctness
F4
```

```text
Wave C — Startup architecture / Pages
F5
F6
```

```text
Wave D — Remaining hardening
F7
F8
F10
```

```text
Wave E — Permanent verification infrastructure
F9
```
F9 must incorporate the FINAL F1-F3 behavior (it proves the fixed implementation, not the old one).

## Re-audit gate

After Wave A: probes A/B/D/E must pass; `npm test`; `npm run build`. After Wave B: the secret persistence-failure probe (setSecret must reject). After Wave C: closure benchmark time-to-interactive + time-to-complete-verification at 10k/50k/100k (baselines 46.6 s / 50.7 s / 104.6 s at 100k remain in the audit report) and a subpath asset check under `/OpenOb/` + `/fork-name/`. Then one independent DeepSeek re-audit.

**Web feature-unfreeze standard:** web/local-first feature development may resume only when: no web-scope P0 exists; no web-scope P1 exists; P1-CONC-001, P1-CONC-002, P1-CONC-003 each pass independent re-probe; browser local save passes a real integration test; filesystem containment passes; Markdown hostile corpus passes; CI is green; GitHub Pages subpath build works; 10k performance gates remain green (upsert < 500 ms, graph < 10 s); 50k/100k testing shows no catastrophic scalability failure. F4 (P1-SEC-001) remains required before future Electron work and should be fixed now (Wave B), but an isolated desktop secret-store defect must not be mislabeled as a browser-alpha failure.

```
NEXT ACTION FOR GEMINI:
Fix only the outstanding findings in this handoff (F1-F10).
Do not begin new roadmap features until all P0/P1 findings pass independent re-audit.
```
