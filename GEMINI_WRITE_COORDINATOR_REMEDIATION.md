# GEMINI_WRITE_COORDINATOR_REMEDIATION.md

Source: `WRITE_COORDINATOR_REAUDIT.md` (full report) — HEAD `8ac85ea`, audit pass read/test/analyze only.
This file lists ONLY outstanding findings from the post-coordinator re-audit. Already-fixed work is not repeated (A1-A4 on the real hook, property P1-P4, AI E1-E4/E7, secret queue G6, degraded reconciliation state, error recovery, force semantics, multi-note independence, vault-switch containment, atomicity banner).

---

## Task C1 — Save-promise contract: a save() must resolve only when the requested buffer state is durable

- **Task ID:** C1
- **Severity:** P1
- **Scope:** WEB (shared coordinator in `packages/vault`)
- **Problem:** `save(v2)` queued behind an in-flight `save(v1)` resolves with **snapshot(v1)** while disk is still v1 — the pump drains ALL queued waiters after each physical write with THAT write's snapshot. The caller is told success before the state it requested is committed. The pump's next iteration writes v2 with NO waiter attached. `save()` currently means "at least one save cycle completed", not "the buffer state associated with this request has been durably committed" — production callers (e.g. `saveActiveNote`) assume the latter.
- **Empirical evidence:** coordinator probe — buffer=v1, `save(v1)` pending, buffer=v2, `save(v2)` queued → both promises resolve at v1's commit, both with the v1 snapshot; `RESULT: p2 resolved with v1-snapshot? true | disk is v2 at p2-resolution time? false`.
- **Exact reproduction:** slow storage (write delay 3200 ms); `setBuffer(v1)`; `save()`; at +100 ms `setBuffer(v2)`; `save()`; observe the second promise resolves with the v1 snapshot before disk has v2.
- **Root cause:** `packages/vault/src/note-coordinator.ts` `pump()` — the waiter drain (line ~227) resolves every queued waiter with the just-completed write's snapshot, regardless of which buffer generation each request represented.
- **Files involved:** `packages/vault/src/note-coordinator.ts` (pump + waiter bookkeeping); callers in `apps/web/src/hooks/useVault.ts` (`saveActiveNote`, autosave effect, `updateNoteProperty`).
- **Required architectural change:** each `save()` request must record the buffer generation (or content identity) it was issued for; the pump resolves each waiter only when the write that covered THAT request's generation has durably committed — either (a) resolve the waiter on the iteration that wrote a snapshot whose content matches the request's generation, or (b) keep per-request snapshots and resolve each waiter with the snapshot of the write that supersedes/equals its requested generation, deferring resolution of later-generation waiters to the pump iteration that writes them. The returned snapshot must correspond to the requested state.
- **Required regression tests:** real-hook latency seam (3200 ms): (1) assert the second `save()`'s promise resolves with a snapshot whose `textContent` equals the v2 content AND disk == v2 at resolution; (2) same for a 3-generation chain v1→v2→v3; (3) assert no caller-visible success before durability across ≥5 runs.
- **Acceptance criteria:** every resolved `save()` snapshot corresponds to durably-committed content matching the requesting buffer generation; the directive's "save promises have truthful durable semantics" condition holds.
- **Dependencies:** none (do first).
- **What NOT to do:** Do not resolve all waiters with the first write's snapshot; do not make `save()` reject on unrelated later writes; do not add `setTimeout` waits; do not move the index into the coordinator just to hide this.

## Task C2 — Rename-during-write ghost: an in-flight old-path write must not recreate the old path

- **Task ID:** C2
- **Severity:** P1
- **Scope:** WEB / SHARED
- **Problem:** With a slow write to A.md in flight, renaming A.md→B.md produces TWO canonical files: A.md recreated with the dirty edit + B.md with the renamed original. The dirty edit lands in the WRONG path. `renameDocument` creates the new path, then version-checks before removing the old path; the pump's in-flight write to the old path passes the check (the old file still exists) and lands — the rename's pre-delete check then fails and the old file is never removed.
- **Empirical evidence:** real-hook probe — slow save of `s9-dirty` → `renameNote('Welcome.md','Renamed.md')` mid-write → after settlement `Welcome.md exists (GHOST)=true` (content `s9-dirty`), `Renamed.md exists=true` (original content).
- **Exact reproduction:** real `useVault` + 3200 ms write delay; `updateContent('Welcome.md','s9-dirty')`; `saveActiveNote()`; at +300 ms `renameNote('Welcome.md','Renamed.md')`; wait 5 s; check both paths.
- **Root cause:** `packages/index/src/refactor.ts` `renameDocument` (create-new-then-version-check-before-remove) racing the coordinator pump's old-path write; the coordinator's `renameNote` is called AFTER the file-level rename and does not cancel/redirect the in-flight pump.
- **Files involved:** `packages/index/src/refactor.ts`, `packages/vault/src/note-coordinator.ts` (pump path binding), `apps/web/src/hooks/useVault.ts` (`renameNote`).
- **Required architectural change:** the coordinator must bind each pump iteration to the note's CURRENT path at commit time (a write begun for the old path must either be redirected to the new path with the new version base, or cancelled with a truthful conflict), and `renameNote` must sequence against the in-flight pump (e.g., the rename waits for/aborts the pump, then re-bases the buffer onto the new path). `renameDocument` should remove the old path atomically with the version it captured, and the pump must not be able to re-create a path that the rename removed.
- **Required regression tests:** real-hook latency seam: rename mid-write → assert EXACTLY ONE canonical file (B.md) with the LATEST content, no A.md, no ghost; repeat ≥5 runs; also rename-with-no-write-in-flight (must still work); rename twice in quick succession.
- **Acceptance criteria:** the directive's required final holds: one canonical file, correct filename, correct latest content, no ghost recreation of the old path.
- **Dependencies:** C1 (the pump's per-generation semantics are the same machinery).
- **What NOT to do:** Do not just delete the old path harder (the ghost is created by the pump's write, not the rename); do not globally serialize renames with all saves; do not make the rename silently abort (E5) as the "fix".

## Task C3 — Timestamp-before-commit: the watcher/verifier stand-down must key on successful index commit

- **Task ID:** C3
- **Severity:** P1 (desktop-runtime scope)
- **Scope:** SHARED (desktop-runtime library) / DESKTOP-DEFERRED for delivery
- **Problem:** `pathWriteTimestamps.set(event.path, Date.now())` runs at the TOP of the watcher handler, BEFORE the read/parse/upsert. If the watcher's read fails (both attempts), the handler returns "marked dirty" without updating the index — but the timestamp is already recorded. The verifier's G5 check (`lastWatcherUpdate > readStart`) then stands down, leaving the index stale while `reconciliationState === 'verified'` with zero errors. "A newer event started" is not "a newer version was successfully committed to the index."
- **Empirical evidence:** deterministic probe (injected fs.watch callback + EACCES read window + delayed verifier read): `state=verified | errors=0 | indexLen=3000008 (old X1) vs diskLen=4 (X3)` — STALE-INDEX-WITH-VERIFIED=true.
- **Exact reproduction:** seed X1 → checkpoint; offline X1→X2 (same size+mtime); start runtime with (a) verifier read of the path delayed 3 s and (b) watcher-handler reads failing during the window; at +500 ms write X3 + emit the fs.watch event; let the verifier's delayed read return. Observe verified + stale index.
- **Root cause:** `packages/desktop/src/desktop-runtime.ts` line ~299 — the timestamp is recorded on EVENT OBSERVATION, not on COMMIT.
- **Files involved:** `packages/desktop/src/desktop-runtime.ts` (watcher handler, verifier G5 check).
- **Required architectural change:** record the generation/timestamp ONLY after the watcher's read/parse/upsert SUCCEEDS (or maintain two markers: event-observed vs committed, and make the verifier stand down only on committed). A failed watcher cycle must not suppress the verifier.
- **Required regression tests:** the four orderings, deterministic (no fs.watch timing): watcher-first/verifier-second; verifier-first/watcher-succeeds-second; **watcher-starts-but-fails (the W3 case — must NOT end verified+stale)**; watcher-retries-and-succeeds. Final index must equal canonical disk in all four.
- **Acceptance criteria:** no configuration yields `verified` with an index that differs from canonical disk; "marked dirty" paths remain eligible for the verifier.
- **Dependencies:** none.
- **What NOT to do:** Do not globally serialize the watcher and verifier; do not remove the ordering protection; do not claim `verified` when dirty paths exist.

## Task C4 — Index update ordering: never tag v2 content with v1's hash

- **Task ID:** C4
- **Severity:** P2
- **Scope:** WEB / SHARED
- **Problem:** after `save()` resolves (with W1's snapshot), `saveActiveNote` does `parse(currentBuffer, snapshot.version.hash)` + `index.upsert` — producing an index entry whose sourceHash corresponds to a different canonical version than its content. The mismatch persists in-session (the pump's silent v2 write has no caller to trigger a re-index). Search/backlinks/graph/manifest read the wrong version identity.
- **Empirical evidence:** probe through the real sequence: after settlement `disk=v2 | index sourceHash=944a4668 (v1) | diskHash=974a4b21 (v2) | PERSISTENT MISMATCH=true | state=saved`.
- **Exact reproduction:** slow storage; v1 save in flight; buffer→v2; second save; run the exact `saveActiveNote` sequence; wait for settlement; compare `index.get(path).sourceHash` vs the disk hash.
- **Root cause:** `apps/web/src/hooks/useVault.ts` `saveActiveNote` uses the resolved snapshot's hash with the current buffer; C1's semantics make the snapshot a potentially-stale hash.
- **Files involved:** `apps/web/src/hooks/useVault.ts` (`saveActiveNote`), optionally the coordinator (expose the authoritative committed hash per generation).
- **Required architectural change:** index the buffer with the hash of the content ACTUALLY indexed (compute the hash from the parsed content, or have the coordinator return the authoritative hash for the generation being indexed). The index sourceHash/content pair must correspond to the same canonical committed version.
- **Required regression tests:** after the C1 fix, assert `index.sourceHash === diskHash` and `index.textContent === diskText` after overlapping v1/v2 saves (immediately after settlement, no extra event).
- **Acceptance criteria:** the directive's invariant "the index sourceHash/content pair must correspond to the same canonical committed file version" holds; no persistent in-session mismatch.
- **Dependencies:** C1 (the hash source), C2 (rename sequencing touches the same index path).
- **What NOT to do:** Do not put the index inside the canonical write transaction without evidence; do not recompute hashes in a way that diverges from `SafeWriter`'s versioning.

## Task C5 — Silent commit after discard: close/AI must not write after an explicit discard

- **Task ID:** C5
- **Severity:** P2
- **Scope:** WEB
- **Problem:** closing a tab with "Discard and close?" confirmed, or closing during an AI apply, still commits the in-flight write (disk gets the content; the save promise resolves). The user's explicit discard is silently ignored. (s.8 + E6.)
- **Empirical evidence:** real-hook probe with confirm accepted: `closeTab` mid-write → `disk contains s8b-dirty=true | tabs:0`; AI apply + close → `disk=E6-AI | tabs:0`.
- **Exact reproduction:** slow storage; edit; save; close with confirmed discard → check disk.
- **Root cause:** `packages/vault/src/note-coordinator.ts` `removeNote` does not cancel/abort an in-flight pump write; the pump completes the write and resolves the waiters regardless.
- **Files involved:** `packages/vault/src/note-coordinator.ts` (`removeNote` + pump), `apps/web/src/hooks/useVault.ts` (`closeTab`).
- **Required architectural change:** define the discard contract explicitly: on confirmed discard, the coordinator must (a) abort/ignore the in-flight write's commit (or mark the note as discarded so the pump drops the result and rejects/resolves waiters as discarded), and (b) never resolve a waiter as "saved" for a discarded note. If "autosave may still land" is the intended product behavior, the close dialog must say so — the UI contract must be explicit either way.
- **Required regression tests:** close-with-discard mid-write → disk does NOT contain the edit (or the UI explicitly documents otherwise); AI apply + close → same; waiter settles (resolved-as-discarded or rejected), never hangs.
- **Acceptance criteria:** no write lands after an explicit discard; no waiter hangs.
- **Dependencies:** C1 (waiter semantics).
- **What NOT to do:** Do not remove the write version checks; do not leave the pump writing to a removed note's path silently.

## Task C6 — Rename/AI during write must not silently abort (E5)

- **Task ID:** C6
- **Severity:** P2
- **Scope:** WEB
- **Problem:** renaming during an AI apply silently ABORTS the rename (Welcome.md remains, Renamed.md never created, only `console.error`). The user's rename is dropped with no UI indication.
- **Empirical evidence:** E5 probe — `wExists:true, rExists:false` after AI+rename; no error surfaced to the user.
- **Exact reproduction:** slow storage; AI apply in flight; rename mid-apply; observe the rename never happens and only a console.error appears.
- **Root cause:** `renameDocument`'s pre-delete version check fails because the AI write changed the old path's version; `useVault.renameNote` swallows the error into `console.error`.
- **Files involved:** `packages/index/src/refactor.ts`, `apps/web/src/hooks/useVault.ts` (`renameNote` error path).
- **Required architectural change:** surface rename failures truthfully (status/error to the user) and/or sequence the rename against the in-flight write (wait for the pump, then re-baseline and rename) — align with C2's sequencing.
- **Required regression tests:** rename during an active AI write → either the rename succeeds (B.md has the AI content) or the user is told it failed; never a silent no-op.
- **Acceptance criteria:** no silent rename drop; consistent with C2.
- **Dependencies:** C2.
- **What NOT to do:** Do not just add a toast and keep the failure; do not make the rename overwrite the AI content silently.

## Task C7 — Real regression coverage: latency seam + disk assertions in the Playwright suite

- **Task ID:** C7
- **Severity:** P2 — **RELEASE-GATE: YES** (must exist before unfreeze; classification changed from the earlier pass because missing coverage is not itself the data-loss bug)
- **Scope:** WEB / SHARED
- **Problem:** the Playwright job is real (Chromium, real app) but the concurrency tests have NO controlled storage latency and NO disk read-back assertions. The "A2 & A3: Slow save exceeding debounce" test uses instant in-memory writes + a 3 s wait — it never overlaps the 2000 ms debounce and would pass on the pre-coordinator buggy code.
- **Empirical evidence:** read of `tests/e2e/browser-concurrency.spec.ts` (no delay injection, DOM-only assertions); the audited probes required a prototype-patched write seam to reproduce any race.
- **Exact reproduction:** run the e2e A2/A3 test; it passes while the previous buggy implementation would also pass.
- **Root cause:** no seam to delay the production write path in the test environment.
- **Files involved:** `tests/e2e/browser-concurrency.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` (e2e job).
- **Required architectural change:** add a test-only seam that delays the production write path (prototype patch on the storage used by the real app, or a coordinator write-delay hook) at 750/1500/3200/5000 ms; assert DISK state via storage read-back, not just DOM. Permanent browser coverage: A1, A2, A3, A4, B, B2, property both timing orders, AI + human typing, rename during save, delete during save, vault switch during save.
- **Required regression tests:** the cases above; each must FAIL on the current audited code where a defect exists (red) and pass after C1-C6.
- **Acceptance criteria:** the e2e suite reproduces the targeted timing cases with disk assertions; CI runs it.
- **Dependencies:** C1-C6 (the tests encode their acceptance).
- **What NOT to do:** Do not rename the existing file and call it coverage; do not add jsdom logic-copy "browser" tests; do not gate on flaky wall-clock sleeps alone.

## Task DEV-QUALITY-GATES — Tooling (AFTER correctness blockers)

- **Task ID:** DEV-QUALITY-GATES
- **Severity:** P3 (ergonomics/quality; must come AFTER C1-C6 and C7)
- **Scope:** repo-wide
- **Problem:** `lint` is a fake (`tsc --noEmit`); no ESLint/Prettier/Husky/coverage; mixed quote styles already visible; floating promises and swallowed errors are uncaught; `browser-concurrency-probes.test.ts` still mis-named; `npm test` includes performance and (while present) the broken parallel probes; no `verify` command; no Node version pinning.
- **Empirical evidence:** inventory + spot checks (quote-style counts; floating `saveActiveNote()` at useVault.ts:544/App.tsx:218; `lint` script = `tsc --noEmit`; no dotfiles beyond `.gitignore`; `tests/_reaudit-tmp` untracked).
- **Files involved:** `package.json`, new `eslint.config.js`, `.prettierrc.json`, `.editorconfig`, `.nvmrc`, `vitest.config.ts` (coverage), `.husky/`, `.gitignore` (+`tests/_reaudit-tmp/`, `.env*`), `.github/workflows/ci.yml`.
- **Required change (exact tooling):**
  - **ESLint** flat config with MUST HAVE: `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `no-unnecessary-type-assertion`, `no-unused-vars`, `no-empty` (comment-allowed); USEFUL: `consistent-type-imports`, `no-unnecessary-condition`, `no-unreachable`; nothing stylistic (Prettier owns style). `lint` must actually lint.
  - **Prettier** (`singleQuote`, `printWidth: 100`); `format` / `format:check` scripts; CI checks, never rewrites; ignore dist/coverage/node_modules/playwright-report/test-results/tests-_reaudit-tmp.
  - **Husky + lint-staged:** pre-commit runs ONLY staged-file Prettier check + ESLint (target < 10 s); no full suite/Playwright/benchmarks.
  - **Vitest coverage** (`@vitest/coverage-v8`), visibility-first report, per-critical-module expectations (coordinator, SafeWriter, storage adapters, SqliteDocumentIndex, runtime, secret store, link resolver, renderer boundary, AI pathway); no global percentage gate.
  - **`npm run verify`** = `format:check && lint && typecheck && test && build`; `verify:e2e` = `+ test:e2e`; `verify:full` includes the heavy tiers. 50k/100k stay scheduled.
  - **Test organization:** delete or rename `tests/integrity/browser-concurrency-probes.test.ts` (the name still lies); move scale/performance into `tests/performance/` (or document that `npm test` includes 10k gates); add `tests/adversarial/` for the scheduled race matrix.
  - **Node consistency:** `"engines": {"node": ">=20 <23"}` + `.nvmrc` (22); no `packageManager` unless needed.
  - **Secrets:** cheap CI grep in the existing boundary step for private-key/API-key patterns; add `.env*` to `.gitignore`.
  - **EditorConfig:** minimal (utf-8, LF, final newline, 2-space indent).
  - **commitlint:** NOT adopted (no release automation; conventional forms already used).
- **Acceptance criteria:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` all green locally and in CI; pre-commit hooks execute only fast staged-file checks (< 10 s); `npm run verify` is the single pre-CI command.
- **Dependencies:** C1-C7 (tooling must not distract from correctness blockers).
- **What NOT to do:** Do not install a maximalist ruleset; do not add commitlint; do not enforce vanity coverage percentages; do not run Playwright/benchmarks in pre-commit; do not adopt tools that don't catch the demonstrated bug classes.

---

## Execution order

1. **Wave 1 — Coordinator correctness (web P1s):** C1 (save-promise contract) → C2 (rename ghost) — same pump machinery, design together.
2. **Wave 2 — Desktop runtime:** C3 (timestamp-before-commit).
3. **Wave 3 — Consistency + UX:** C4 (index hash/content) → C5 (discard semantics) → C6 (rename-no-silent-abort).
4. **Wave 4 — Real regression coverage:** C7 (latency seam + disk assertions + renamed taxonomy).
5. **STOP — independent re-audit:** re-probe A1-A4, B/B2, property both orders, AI E1-E7, rename/delete/vault-switch with real latency; verify C1-C6 acceptance; if any web P1 remains, no feature work.
6. **Wave 5 — Developer ergonomics:** DEV-QUALITY-GATES (only after 1-4 are green).

## Unfreeze conditions (unchanged from the directive)

Web feature work resumes only when: no WEB/SHARED P0; no WEB/SHARED P1; genuine delayed-write A1-A4 pass; rename-during-save cannot recreate the old path; delete-during-save cannot resurrect; vault-switch cannot cross-contaminate; property preserves human typing; AI apply never falsely reports success after losing commit authority; **save promises have truthful durable semantics**; final index represents the latest canonical commit; Playwright permanently reproduces the critical timing cases (with latency + disk assertions); browser FSA save passes; GitHub Pages works; containment intact; CI green.

Desktop/Electron readiness additionally requires C3 (and the Node/FSA delete-window probe) complete. Electron remains deferred.

---

**NEXT ACTION FOR GEMINI:**
Fix the outstanding findings in this handoff in the order above.
Do not claim the coordinator "solved the persistence class" until C1-C7 pass independent re-audit with real latency.
