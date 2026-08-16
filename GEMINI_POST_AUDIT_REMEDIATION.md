# GEMINI_POST_AUDIT_REMEDIATION.md

Source: `POST_GEMINI_REAUDIT.md` (full report) — HEAD `4f573aa`, audit pass read/test/analyze only.
This file lists ONLY outstanding findings from the post-Gemini re-audit. Already-fixed work is not repeated (F2 clobber, F6 Pages, F7 capability detection, F8 rebuild metadata, F10 BOM, T3/T4 performance).

---

## Task G1 — F1: pending-save stale-version false conflict (silent edit loss)

- **Task ID:** G1
- **Severity:** P1
- **Scope:** WEB
- **Problem:** When a save takes longer than the autosave debounce (write ≥ ~2 s), the autosave that fires mid-save arms `pendingSaveRef`; when the first save completes, the `finally` block calls `saveActiveNote()` **synchronously, before React flushes the completed save's `setOpenTabs` update** — so `openTabsRef.current` still holds the PRE-EDIT `initialSnapshot`. The pending save uses that stale `expectedVersion` against the just-updated disk → SafeWriter pre-validates → instant false `ConflictError`. The edited content (v2) is **never written**; state stays `dirty:true` + `conflict` forever (polled to 14 s, no recovery). Silent human-edit loss.
- **Empirical evidence:** Playwright + real `useVault`, write=3200 ms, debounce=2000 ms: type v2 at +400 ms → instrumented `SafeWriter`/storage log shows `safeSave(v2, expectedVersion=fe786c16)` at t=3582 ms while disk was already `8ce26778` → `ConflictError`; disk remains `A2-v1`, status `conflict`, `isDirty` true, no further `safeSave` calls in 11 s. Probe A1 (write 750 ms < debounce) PASSES; probe A2/A3 FAILS.
- **Exact reproduction:** mount `useVault` with `MemoryVaultStorage.prototype.write` delayed 3200 ms; `updateContent(v1)`; manual `saveActiveNote()`; at +400 ms `updateContent(v2)`; wait 10 s. Assert disk == v2 (FAILS; disk == v1, status conflict).
- **Root cause:** `apps/web/src/hooks/useVault.ts` `saveActiveNote()` finally block:
  `finally { isSavingRef.current = false; if (pendingSaveRef.current) { pendingSaveRef.current = false; saveActiveNote(); } }`
  runs in the same microtask as the queued `setOpenTabs` state update; `openTabsRef.current.initialSnapshot` is still the pre-save version. The recovery path (`if (stillDirty) setSaveGeneration(g+1)`) reads `stillDirty` from inside a `setOpenTabs` updater — timing-dependent (works when the updater is eagerly evaluated, fails otherwise), and in the failing case the only armed recovery (`pendingSaveRef`) was already consumed by the false-conflict save.
- **Affected files:** `apps/web/src/hooks/useVault.ts` (`saveActiveNote`, the autosave effect deps).
- **Architectural requirement (applies to G1 and G2):** React state is UI state. React render timing must not determine canonical write ordering, `expectedVersion` selection, or operation commit correctness. Introduce a **per-note write coordinator / serialized persistence mechanism** (not a framework): deterministic serialization for writes affecting the same note, coordinating at minimum: manual save, autosave, property mutation, and accepted AI edit. Each note operation carries enough state to prove what it is committing, conceptually: `path`, `content`, `baseVersion`, `bufferGeneration`, `operationType` (equivalent names/designs are fine). Required invariant: **ONLY ONE canonical write for a given note commits at a time.** React may render progress, but the write chain must function correctly with zero dependency on React flushing.
- **Required change:** Remove the `finally`-synchronous pending save that reads pre-render refs. All note writes (manual save, autosave, property, AI) flow through the per-note coordinator, which owns the authoritative version chain per path:
  - When a write succeeds, its returned `res.snapshot.version` is authoritative for the NEXT serialized write — do NOT wait for a React render to learn the new disk version.
  - After write v1 (against `snapshot0`) returns `snapshot1`: if the current human buffer == v1 → clean; if the buffer has moved to v2 → enqueue the LATEST buffer and write v2 against `snapshot1`; returns `snapshot2`; if buffer == v2 → clean, else continue with the latest buffer.
  - `expectedVersion` comes from the coordinator's committed version, never from a React ref that updates during render; dirty state reflects "disk != current buffer" computed from the coordinator's authoritative state.
  - If a genuine version mismatch occurs, surface it truthfully — never report `conflict` when the buffer actually matches the disk.
- **Required regression test:** REAL-hook (Playwright + real `useVault`, or jsdom with real timers + actual React scheduling — NOT a re-implemented copy), run each repeatedly (≥5×): **A1** save completes before the debounce; **A2** save exceeds the debounce; **A3** pending save fires after the first save but before the React render flush; **A4** v1→v2→v3→v4 across multiple overlapping save windows. Final invariant in every run: disk == latest human buffer; `dirty` false ONLY when disk == current buffer; no false conflict; no lost edit.
- **Acceptance criteria:** A1-A4 pass on the real hook with the invariant above, ≥5 consecutive runs each; `saveStatus` truthful at every observed point.
- **Dependencies:** none (G2 shares the same coordinator — design together; see Wave 1).
- **What not to do:** Do NOT fix with arbitrary `setTimeout` delays; do NOT disable `expectedVersion` checks; do NOT ignore `ConflictError`; do NOT start a pending save synchronously from `finally` if doing so requires React to have flushed first; do NOT re-test with a duplicated standalone save loop; do NOT remove the version check or widen the conflict window; do NOT silence the conflict.

## Task G2 — F3: dead `diverged` commit-point (silent property loss)

- **Task ID:** G2
- **Severity:** P1
- **Scope:** WEB
- **Problem:** `updateNoteProperty` and `applyAIProposedEdit` use `let diverged = false; setOpenTabs(prev => { … diverged = true; }); if (diverged) { setConflictData(…); return …; }`. React applies functional updaters during render, so `diverged` is still `false` when read synchronously after `setState` — the commit-point branch is **dead code**. Consequences: (a) property mutation + human typing where the property save completes before the autosave → the autosave silently overwrites the property mutation on disk; tab falsely ends `dirty:false / 'saved'` with no conflict (probe D-silent); (b) AI apply + typing → `applyAIProposedEdit` returns `success:true` while the AI content is then reverted by the autosave — a lie to the user.
- **Empirical evidence:** Probe D-silent (write=1500 ms, type at +400 ms, property save completes at ~1.65 s < autosave at ~2.4 s): final disk = human text WITHOUT `status: done`, `isDirty:false`, `status:'saved'`, `conflict:false`. Probe E: disk = AI content, human text in buffer, conflict surfaced only via the incidental autosave race; `applyAIProposedEdit` returned success.
- **Exact reproduction:** real `updateNoteProperty(path, 'status','done')` with 1500 ms write; at +400 ms `updateContent` with human text; wait 8 s; assert disk contains the property (FAILS).
- **Root cause:** `apps/web/src/hooks/useVault.ts` lines ~594-640 (`updateNoteProperty`) and ~701-790 (`applyAIProposedEdit`): state-mutation-inside-updater read synchronously afterward is not a synchronization primitive.
- **Affected files:** `apps/web/src/hooks/useVault.ts`.
- **Architectural requirement:** A value assigned inside a React state updater must NOT be used as a synchronous commit result outside that updater — the `let diverged = false; setOpenTabs(prev => { … diverged = true; }); if (diverged) …` pattern is explicitly prohibited. Commit decisions are made by the per-note write coordinator (see G1's Architectural requirement) using explicit operation generations / buffer generations, never by reading updater-assigned locals.
- **Required change:** Route property mutation and AI apply through the SAME per-note coordinator (no separate AI-specific save mechanism).
  - **Property mutation:** capture the original buffer generation and original disk/base version; generate the property-mutated content; BEFORE the canonical commit and BEFORE replacing editor state, determine from the coordinator whether the human buffer generation has changed. If human typing occurred: the human buffer survives; the operation must not falsely mark the note clean; the property change must not be silently lost; behavior must be explicit. The implementation may (A) surface a conflict and leave the property result on disk pending resolution, or preferably (B) deterministically rebase/reapply the property mutation onto the latest human buffer where safe. It must NOT perform the forbidden sequence: write property mutation → human types → autosave silently overwrites the property mutation → report `saved` → show no conflict.
  - **Accepted AI edits:** human work wins. If the buffer generation changed while the AI apply was pending: do not replace the human buffer; return `success:false` or a truthful conflict result; NEVER return `success:true` for an edit that lost its commit authority; disk / editor / index state must be internally consistent.
- **Required regression test:** REAL-hook: (1) property + typing in BOTH timing orders (property save shorter than the autosave debounce, and longer than it) — assert human text survives, the property is not silently lost, `dirty`/status truthful, conflict truthful; (2) AI apply + typing — assert `success === false` (or a surfaced truthful conflict) and the disk/editor/index end-state is known and consistent; (3) property mutation + autosave, and AI apply + autosave collision cases through the coordinator.
- **Acceptance criteria:** Probe D (both orderings) and Probe E pass on the real hook; no silent property loss; no false `success:true`; no falsely-clean tab.
- **Dependencies:** G1 (same per-note coordinator — design together; see Wave 1).
- **What not to do:** Do NOT use the `diverged`-inside-updater pattern in any form; do NOT remove the divergence detection; do NOT make the human buffer lose; do NOT add a UI that shows a conflict that autosave then silently resolves; do NOT build a second, AI-specific save mechanism.

## Task G3 — F9: real browser regression coverage + CI browser smoke job

- **Task ID:** G3
- **Severity:** P2 — **RELEASE-GATE: YES.** The missing browser coverage is NOT itself the production data-loss bug (the silent-edit-loss defects are P1 and live in G1/G2); however, real production-hook browser coverage remains a REQUIRED feature-unfreeze condition. Do not unfreeze until it exists. This is a classification change only — it does not reduce the importance of the unfreeze gate.
- **Scope:** WEB / SHARED
- **Problem:** `tests/integrity/browser-concurrency-probes.test.ts` is a hand-written miniature copy of the save/property/AI logic (plain local variables, `MemoryVaultStorage`) — no React, no `useVault`, no Chromium, no jsdom. Playwright is NOT installed (not in `package.json`/`node_modules`), and `ci.yml` has no browser job. The concurrency fixes therefore have zero regression coverage that can catch the React-scheduling defects (proven: the suite is green while real-hook probes A2/A3/D-silent fail).
- **Empirical evidence:** `grep` of the test file (no React imports, no `useVault`, local `runSave`/`applyAIEdit` functions); `ls node_modules/.bin/playwright` → absent; `ci.yml` → no browser steps; npm test (145 tests) green while real-hook probes fail.
- **Exact reproduction:** read `tests/integrity/browser-concurrency-probes.test.ts`; run `npm test` (green); run probe A2/A3 on the real hook (fails).
- **Root cause:** the previous handoff's T11 was implemented by renaming a logic test, not by adding a browser harness.
- **Affected files:** `tests/integrity/browser-concurrency-probes.test.ts`, `package.json` (devDeps), `.github/workflows/ci.yml`.
- **Required change:** (1) `tests/integrity/browser-concurrency-probes.test.ts` may remain as a FAST ALGORITHM/UNIT TEST of the intended logic — but it must NEVER be described as browser concurrency coverage (it is not: no React, no `useVault`, no Chromium). (2) Add a REAL production test layer that: mounts the actual `useVault` hook or the actual app; executes React scheduling; executes in Chromium through Playwright (or an equivalent real browser); deliberately slows storage (prototype-patch `write` delay or equivalent); calls the actual production functions. (3) The real-production suite MUST include: A1, A2, A3, A4, B, B2, D with property save shorter than the autosave debounce, D with property save longer than the autosave debounce, E (AI edit + typing), manual save + autosave collision, property mutation + autosave, AI apply + autosave. (4) These tests must FAIL against the currently audited defective implementation and PASS only after G1/G2 are corrected. (5) Add an actual browser CI job (build → serve → open vault via stubbed picker → edit → save → reload → verify; hostile-payload preview smoke) — do NOT merely install Playwright without running it in CI.
- **Required regression test:** the real-production suite above (A1, A2, A3, A4, B, B2, D both orders, E, manual-save/autosave, property/autosave, AI/autosave); each test must FAIL on the currently audited defective implementation (red) and PASS only after G1/G2 are corrected.
- **Acceptance criteria:** CI runs a real-browser job (Playwright or equivalent installed AND executed in CI, not merely present); the concurrency suite mounts the real hook in Chromium, deliberately slows storage, and fails on the pre-G1/G2 code.
- **Dependencies:** G1, G2 (the tests encode their acceptance).
- **What not to do:** Do not rename the existing file and call it browser coverage; do not describe `browser-concurrency-probes.test.ts` as browser concurrency coverage in any doc or comment; do not add jsdom-with-fake-timers logic duplicates as the only coverage; do not install Playwright without running it in CI; do not skip the browser job for speed.

## Task G4 — F5: truthful background-verification state (`degraded` reachable)

- **Task ID:** G4
- **Severity:** P1 (desktop-runtime scope; not web-blocking)
- **Scope:** SHARED (desktop-runtime library) / DESKTOP-DEFERRED for delivery
- **Problem:** `runBackgroundVerification` wraps each candidate's read/parse/upsert in an **empty `catch {}`** and then unconditionally sets `_reconciliationState = 'verified'`. A file deleted mid-verification, permission-denied read, parse failure, or upsert failure is silently swallowed and the runtime still reports `verified`. `'degraded'` is never assigned anywhere — unreachable. "Verified" must mean every required verification succeeded.
- **Empirical evidence:** code reading (`catch {}` + unconditional `this._reconciliationState = 'verified'` at the end of `runBackgroundVerification`); grep confirms `degraded` appears only in the type union (desktop-runtime.ts:19).
- **Exact reproduction:** inject a storage read failure (delete the file during Stage B, or mock `storage.read` to reject once) and observe: state transitions to `verified`, no error surfaced, no retry, no degraded marker.
- **Root cause:** `packages/desktop/src/desktop-runtime.ts` `runBackgroundVerification` — empty catch + unconditional terminal state.
- **Affected files:** `packages/desktop/src/desktop-runtime.ts`.
- **Required change:** count failures per verification cycle; distinguish **legitimate canonical deletion** (a disappeared file that canonical state confirms is gone may be reconciled as a deletion — that is NOT a verification failure) from **verification operation failure** (unhandled/unrecovered read failure, parse failure, index failure, file disappearance requiring unresolved handling, or permission failure). On ANY verification operation failure: set `_reconciliationState = 'degraded'` (or stay 'verifying' with an explicit retry/error surface) and NEVER transition to `'verified'` while failures remain. `'verified'` may only mean: every candidate required for that verification cycle either (a) was successfully verified unchanged, or (b) was successfully reconciled to current canonical content. No empty catches — every catch must record the failure. Expose enough information for callers: number of failures, paths affected, error type/message where safe, and whether retry is possible (e.g., `getVerificationErrors()`).
- **Required regression test:** inject read/parse/upsert failures per candidate → assert state == `degraded` and the failure (path + error) is surfaced; inject a legitimate deletion (file gone, canonical state confirms) → assert it reconciles as a deletion WITHOUT degrading the state; assert `verified` only when every candidate succeeded (unchanged or reconciled).
- **Acceptance criteria:** `degraded` reachable and truthful; `verified` implies every required verification succeeded (verified-unchanged or reconciled); failures visible to the caller (count, paths, error type/message, retry-ability); no empty catches remain.
- **Dependencies:** NONE (establish truthful state/error reporting first; G5 builds on it).
- **What not to do:** Do not retry forever silently; do not report `verified` with outstanding failures; do not remove the background-verification design; do not treat a legitimately-deleted file as a verification failure; do not leave any empty catch in the verification path.

## Task G5 — F5: verifier/watcher stale-write ordering guard

- **Task ID:** G5
- **Severity:** P2
- **Scope:** SHARED (desktop-runtime library)
- **Problem:** The background verifier's `index.upsert` and the watcher's `index.upsert` have no ordering/version guard. The verifier's read→parse→upsert (measured up to 5.5 s for a 20 MB doc) can land a stale write AFTER the watcher indexed newer content, leaving the derived index stale with no self-heal until the next event/restart. Not reproduced empirically on this box (native `fs.watch` latency 3-69 s always let the verifier finish first), but code-level real on fast-watcher platforms with large files.
- **Empirical evidence:** code reading; 20 MB parse 0.5 s + sqlite upsert 5.0 s measured; verifier and watcher both call `index.upsert` with no version/expected guard.
- **Exact reproduction:** fast-watcher platform (or injected event delivery): verifier reads old content → external change → watcher upserts new → verifier upserts old → `getAll()`/query shows old content while disk is new.
- **Root cause:** `packages/desktop/src/desktop-runtime.ts` — two independent writers into the same index without serialization or a last-writer-wins-by-mtime check.
- **Affected files:** `packages/desktop/src/desktop-runtime.ts`.
- **Required change:** add per-path sequencing / version protection between the background verifier and the watcher — do NOT globally serialize the entire index (the watcher must remain responsive while verification runs). A valid solution may use: a per-path generation counter, a per-path mutex/queue, a source hash/version comparison before the verifier's upsert (skip if a newer write landed), or a re-read immediately before the verifier's commit. Required invariant: **a stale background verifier result can never overwrite a newer watcher-indexed version** for the same path.
- **Required regression test:** deterministic forced-interleaving with injected delays (mock `storage.read`/`parser.parse`/`index.upsert` ordering) — do NOT rely on native `fs.watch` timing: force verifier-reads-old → watcher-upserts-new → verifier-upserts-old and assert the index ends with the newer content; repeat for delete-during-verification and rapid multiple modifications.
- **Acceptance criteria:** no stale verifier write can land after a watcher write for the same path; the watcher remains responsive during background verification.
- **Dependencies:** G4 (truthful verification state/error reporting first; the ordering guard builds on it).
- **What not to do:** Do not drop the verification; do not make the watcher wait for the whole background pass (that regresses startup); do not rely on native `fs.watch` timing in tests; do not serialize the entire index globally as the default mechanism.

## Task G6 — F4: secret-store queue poison + stale rollback

- **Task ID:** G6
- **Severity:** P1 (desktop scope; blocks future Electron, not web)
- **Scope:** DESKTOP-DEFERRED
- **Problem:** (a) `this.writeLock = this.writeLock.then(op)` with no `.catch`: after ONE persistence failure every subsequent `setSecret`/`clearSecret` rejects with the same error without executing — the queue is permanently poisoned. (b) `previousValue` is captured at queue time, so a queued op that fails rolls back to a STALE value: verified memory `old` vs disk `v1` after [v1 ok, v2 fails].
- **Empirical evidence:** `vi.mock('fs')` injection — F4-A: set A fails, set B rejects with A's error, disk empty; F4-B: ops [fulfilled, rejected], memory `old`, disk `v1` (diverged); F4-C: clear and subsequent sets all reject (poison persists).
- **Exact reproduction:** mock `fs.writeFileSync` to throw once; `await setSecret('p1','A')` (rejects); `await setSecret('p1','B')` → rejects with the same error (queue dead). Queue [set k=v1, set k=v2], fail only the v2 persist → memory `old`, disk `v1`.
- **Root cause:** `packages/desktop/src/secure-storage.ts` — `writeLock = writeLock.then(...)` propagates rejections; `previousValue` captured outside the queued operation.
- **Affected files:** `packages/desktop/src/secure-storage.ts`.
- **Required change:** Architecturally separate the promise returned to the caller from the internal serialization tail — the tail must NEVER be left rejected.
  - **Forbidden pattern (leaves the queue dead):** `this.writeLock = this.writeLock.then(operation).catch(err => Promise.reject(err))` — the tail stays rejected, so the next `.then(operation)` never executes.
  - **Required shape (equivalent designs acceptable):**
    ```ts
    // A. caller-visible promise: rejects exactly when THIS operation fails
    const operationPromise = this.writeLock
      .catch(() => {
        // consume any previous queue failure for sequencing purposes only
      })
      .then(async () => {
        // previousValue captured INSIDE the serialized operation,
        // from the memory cache at execution time (true pre-op state)
        const previousValue = this.memoryCache.get(providerId);
        // mutate cache
        // persist to disk
        // if persistence fails: rollback cache to previousValue, then throw
      });

    // B. internal serialization tail: always recovers to a resolved state
    this.writeLock = operationPromise.catch(() => {
      // keep the queue alive for subsequent operations
    });

    return operationPromise;
    ```
  - **Contract:** (1) the caller sees its own operation's failure (rejection or thrown error — never the first failure's error recycled); (2) the queue remains usable immediately after any failure — the next queued operation still executes; (3) rollback state is captured INSIDE the serialized operation, reflecting the true state immediately before that operation; (4) memory and disk remain equivalent after every fulfilled or rejected operation.
  - Also: `previousValue` must move from the pre-queue call site into the queued operation body (currently captured before `this.writeLock.then(...)` is called, which produces the stale-rollback divergence).
- **Required regression test:** (1) `setSecret('k','A')` fails (injected persist failure) → `setSecret('k','B')` immediately afterward SUCCEEDS and both memory and disk equal `B`; (2) existing `old`; queue `set k=v1` succeeds, `set k=v2` fails → final memory == `v1` AND disk == `v1` (not `old`, not `v2`, not null); (3) `set` succeeds → `clear` fails → next `set` succeeds; (4) `clear` succeeds → next `set` fails → subsequent `set` succeeds; (5) after EVERY completed/rejected operation, a fresh store reads the same state as the in-memory cache (disk == memory), except when no `storagePath` exists by intentional design (in-memory-only mode). Each scenario must also assert the queue is usable for a follow-up operation.
- **Acceptance criteria:** no permanent poison (queue usable after every failure, in both `setSecret` and `clearSecret` directions); rollback restores the true pre-operation state; memory/disk equivalent after every operation sequence; the caller receives its own operation's error, never a recycled prior error.
- **Dependencies:** none.
- **What not to do:** Do not swallow the error; do not drop the write queue entirely; do not use `.then(op).catch(err => Promise.reject(err))` (leaves the tail rejected — the exact poison being fixed); do not capture `previousValue` outside the serialized operation; do not claim "secret persistence fully recovered" until scenarios (1)-(5) pass.

## Task G7 — F7: user-visible degraded-atomicity warning

- **Task ID:** G7
- **Severity:** P2 (web-relevant for non-Chromium browsers)
- **Scope:** WEB / SHARED
- **Problem:** When `FileSystemFileHandle.move()` is unavailable, the storage falls back to non-atomic direct writes and emits only `console.warn`. `atomicWrites` has zero production consumers — no UI notice exists. The previous remediation required a USER-VISIBLE warning. Wording note: the fallback was empirically NON-CORRUPTING in the tested Chromium version (failure before/during write left the original byte-identical; close-failure committed the new content). The warning must therefore say **"atomic replacement guarantee unavailable"** — NOT "known to corrupt files" — unless future testing proves corruption.
- **Empirical evidence:** `atomicWrites` grep → only class definition + `.d.ts`; fallback path logs `console.warn` only (browser-fsa-storage.ts:243).
- **Exact reproduction:** in a browser without `move` (or after deleting the prototype), open the vault and save — no UI indication that writes are non-atomic.
- **Root cause:** `packages/vault/src/browser-fsa-storage.ts` — no UI hook; `apps/web` never reads `atomicWrites`.
- **Affected files:** `packages/vault/src/browser-fsa-storage.ts` (expose capability), `apps/web/src` (surface a banner on mount when `atomicWrites === false`).
- **Required regression test:** stub storage with `atomicWrites=false` → app renders the warning; `atomicWrites=true` → no warning.
- **Acceptance criteria:** a user in a non-`move` browser is told (not a console line) that the **atomic replacement guarantee is unavailable**; wording must not overstate risk ("known to corrupt files" is not supported by evidence); keep this P2 unless stronger evidence of corruption appears.
- **Dependencies:** none.
- **What not to do:** Do not confuse a console warning with a user-visible warning; do not block saving entirely.

## Task G8 — P2 cleanups (bundled)

- **Task ID:** G8
- **Severity:** P2/P3
- **Scope:** WEB / SHARED
- **Problem:** (a) AI apply returns `success:true` when the human typed during the save (fixed by G2). (b) B2 false-conflict + `dirty:false` contradiction (fixed by G1). (c) `getLoadError()` never surfaced by runtime/UI (desktop). (d) Google Fonts external dependency in `index.html` (P3 — self-host or remove for offline-first). (e) 874 kB chunk warning (P3 — `manualChunks`). (f) close-during-in-flight-watcher-handler not awaited (P3).
- **Affected files:** as listed per item.
- **Acceptance criteria:** each item has a stated behavior and a regression assertion.
- **Dependencies:** G1/G2 for (a)/(b).

---

## Execution order

1. **Wave 1 — Web persistence architecture: G1 + G2.** Design and implement TOGETHER — they share the same per-note write coordinator (version-chain serialized writes; generation-based commit checks). Do not start G1 without G2's coordinator design, or vice versa.
2. **Wave 2 — Real production verification: G3.** The real-hook/browser suite proves Wave 1: A1, A2, A3, A4, B, B2, D (both timing orders), E, manual-save/autosave, property/autosave, AI/autosave — red on the current code, green after G1/G2.
3. **STOP HERE.** Run an independent re-audit of A1, A2, A3, A4, B, B2, D (both orderings), E on the real production hook. **If any web P1 remains, do not continue feature work.**
4. **Wave 3 — Background verification integrity: G4 → G5** (truthful state/error reporting first, then per-path ordering protection).
5. **Wave 4 — Secret persistence queue: G6.**
6. **Wave 5 — Browser degraded atomicity + remaining cleanup: G7 → G8.**
7. Electron remains deferred throughout all waves.

## Unfreeze conditions (rewritten per the post-audit correction)

WEB feature work may resume ONLY when ALL of the following hold:

- no WEB/SHARED P0 remains;
- no WEB/SHARED P1 remains;
- A1-A4 pass through the REAL production hook;
- B/B2 pass through the REAL production hook;
- property mutation race tests pass in BOTH timing orders (property save shorter and longer than the autosave debounce);
- AI apply + human typing passes;
- no false conflict from stale internal snapshots;
- disk eventually equals the latest human buffer after autosave;
- browser-local FSA save still passes end-to-end;
- GitHub Pages subpaths still pass;
- filesystem containment still passes;
- hostile Markdown/XSS corpus still passes;
- 10k index/graph performance gates remain green;
- CI is green;
- CI includes a REAL browser job exercising production React behavior.

Desktop/Electron readiness additionally requires: **G4 complete, G5 complete, G6 complete.**
Desktop-deferred P1s (P1-REC, P1-SEC) are NOT web-alpha blockers — do not make them gate web feature work.

---

**NEXT ACTION FOR GEMINI:**
Fix the outstanding findings in this handoff in the order above.
Do not claim F1-F10 complete until each task's acceptance criteria pass independent re-audit.
