# OpenOb — Independent Post-Gemini Re-Audit (F1–F10 Remediation)

Repository: https://github.com/sumosizedginger/OpenOb
Audit type: read / test / analyze only. **No production code modified.** Temporary probes (Playwright + Chromium 1228 against vite-served real modules and the real `useVault` hook; vitest probes with real fs / mocked fs) were used and removed. Working tree clean after the audit.

---

## 1. Exact Audited SHA

- **HEAD audited:** `4f573aa9b8ec5122f1670c52ddc647e49ae8b6c5` (matches the expected SHA in the directive).
- Remediation commits under audit:
  - `e557aaa` — "fix(remediation): complete final remediation waves F1-F10 across all subsystems"
  - `4f573aa` — "fix(test): import FileStat in browser-concurrency-probes.test.ts"
- Prior audited baseline: `5ec3cd0` (the T1–T13 remediation of the previous audit).

## 2. Baseline / CI

- Working tree: **clean**.
- `npm ci` → 0 vulnerabilities. `npm run typecheck` → PASS. `npm test` → **42 files / 145 tests, all passing, 0 skipped** (23.3 s). `npm run build` → PASS (874.64 kB / 287.71 kB gzip, chunk-size warning only).
- CI (`ci.yml`): Node 20/22 matrix — `npm ci` → boundary/security greps → typecheck → `npm test` → `npm run build`. **No browser job, no Playwright, no Chromium anywhere in CI.**
- Green CI is not remediation proof: 4 of the 145 tests are the "browser concurrency probes" which are NOT browser tests (section 5), and the production concurrency defects reproduce live while those tests pass.

## 3. F1–F10 Verification Matrix

| F-task | Verdict | Evidence summary |
|---|---|---|
| F1 Autosave / in-flight save | **PARTIAL** | A1 ✓, A4 ✓; **A2/A3 ✗ (P1 silent edit loss)** |
| F2 Tab switch during save | **MOSTLY COMPLETE** | Clobber fixed ✓; A→B→A variant still produces false ConflictError + contradictory dirty:false |
| F3 Property/AI commit point | **PARTIAL** | `diverged` commit-point is dead code; **D-silent ✗ (P1 silent property loss)**; E surfaces conflict only incidentally |
| F4 Secret persistence | **PARTIAL** | Basic reject/rollback/atomicity ✓; **write queue permanently poisoned (P1, desktop)**; **stale rollback → memory/disk divergence (P1, desktop)** |
| F5 Two-stage reconciliation | **PARTIAL** | Stage A/B structure ✓, close() awaits verification ✓; **`'verified'` lies (empty catch, `degraded` unreachable) (P1)**; verifier/watcher stale-write race (P2) |
| F6 GitHub Pages | **VERIFIED COMPLETE** | Production build boots under `/OpenOb/` and `/fork-name/`: HTTP 200, zero asset 404s, zero console errors |
| F7 FSA capability + fallback | **PARTIAL** | Capability getter fixed + verified; fallback failure-safety benign in Chromium; **user-visible warning MISSING (only console.warn)** |
| F8 Typed source metadata | **MOSTLY COMPLETE** | Typed + populated in rebuild/reconcile/watcher; `(doc as any)` casts remain only in the direct-upsert fallback (sqlite-index.ts:445-447) |
| F9 Test / CI infrastructure | **PARTIAL** (browser part FALSELY CLAIMED) | "browser-concurrency-probes" is a hand-written logic copy; **no Playwright installed; no browser CI job**; build gate + boundary greps genuinely fixed |
| F10 BOM consistency | **VERIFIED COMPLETE** | read/readText/write.snapshot mutually consistent; byte-exact BOM round-trip (EF BB BF preserved) |

## 4. Real React Concurrency Results (real hook, real browser, controlled slow storage)

All probes mounted the **real `useVault()`** (vite-served, React 19 `createRoot`, real scheduling) with `MemoryVaultStorage.prototype.write` slowed to 750/1500/3200 ms and real autosave debounce (2000 ms).

- **Probe A1 (save 750 ms < debounce 2000 ms): PASS.** editor=v2, disk=v2, isDirty false, saveStatus `saved`, no conflict. The `saveGeneration` re-arm works for this case.
- **Probe A4 (v1→v4 across overlapping saves): PASS.** disk EXACTLY equals v4; no intermediate completion falsely marks clean.
- **Probe A2/A3 (save 3200 ms > debounce; autosave fires mid-save): FAIL — P1.** Instrumented trace: v1 save wrote at t=3582 ms (new version `8ce26778`); the pending save fired **synchronously in the `finally`** with expectedVersion `fe786c16` (the PRE-REACT-FLUSH initialSnapshot) — SafeWriter pre-validates → instant false `ConflictError`. Then: conflict shown, tab stays dirty, **v2 never reaches disk** (polled to t+14 s — no recovery). Root cause is exactly the directive's A3 hypothesis: `finally { pendingSaveRef.current = false; saveActiveNote(); }` runs before React flushes the completed save's `setOpenTabs` (initialSnapshot update), so the ref still holds the old version; recovery relies on the `stillDirty`-captured-in-updater read (timing-dependent) and a single-shot `pendingSaveRef` that was already consumed.
- **Probe B (switch to B, edit B, let A's save complete): PASS.** B's parsedDoc (`Characters/Kaelen.md`), backlinks, saveStatus, active tab all survive A's completion — the live `activeTabPathRef` guard is a real fix.
- **Probe B2 (A→B→A during the same save): FAIL (P1-class).** False `ConflictError` (stale version, same mechanism) with **contradictory `dirty: false`** — a spurious conflict surfaced on a tab whose buffer actually matches the disk.
- **Probe D (real `updateNoteProperty` + typing during slow property save):** human text survives in the buffer; a conflict is surfaced — but only incidentally via the racing autosave; state ends stuck (dirty+conflict, no re-arm).
- **Probe D-silent (property save 1500 ms completes before the autosave fires): FAIL — P1.** The property mutation (`status: done`) is written to disk by the property save, then **silently overwritten by the autosave**; the tab ends `dirty:false / status:'saved'` with **no conflict ever shown**. The `let diverged = false; setOpenTabs(prev => { … diverged = true; }); if (diverged) …` pattern is **dead code** — React applies the updater during render, so `diverged` is still false when read synchronously after `setState`.
- **Probe E (real `applyAIProposedEdit` + typing during the slow AI save):** human buffer survives ✓; disk ends with the AI content; a conflict IS surfaced (via the autosave race, not the commit point); `applyAIProposedEdit` returns `success: true` — **false** (the AI edit is then reverted or left conflicting; the human is never told). No human text lost from the buffer; the conflict surface is incidental.

## 5. Test Credibility

`tests/integrity/browser-concurrency-probes.test.ts` — **explicitly classified: this is NOT a browser test and NOT a production-hook test.**

- It does **not** mount `useVault`, the app, or any React component.
- It does **not** run in Chromium or jsdom; **Playwright is not a dependency** (not in `package.json`, not in `node_modules`).
- It uses `MemoryVaultStorage`, `SafeWriter`, `MemoryDocumentIndex`, `DefaultDocumentParser` and a local `SlowVaultStorage` wrapper, then **manually re-implements** simplified versions of the save loop / tab state / property update / AI apply with plain mutated local variables (`let tab = {…}; let isSaving = false; const runSave = async () => {…}`).
- A test of duplicated logic does **not** prove the production hook. The bugs being fixed were caused precisely by asynchronous React state/closure scheduling — which this test cannot exercise. Proof: the test suite (including these 4 tests) is green while the real-hook probes A2/A3 and D-silent fail with silent edit loss.

## 6. Secret-Store Queue / Failure Behavior (F4)

Verified with `vi.mock('fs')` write-failure injection against `DesktopSecretStore` (passphrase-protected, real file):

- Basic fix works: `setSecret` rejects on write/rename failure; memory rolls back; fresh store sees no phantom; atomic temp+rename with temp cleanup; wrong passphrase / corrupt record set `lastLoadError` without leaking plaintext.
- **F4-A — POISONED QUEUE (P1, desktop):** after ONE persistence failure, every subsequent `setSecret`/`clearSecret` rejects with the same error **without executing**. `this.writeLock = this.writeLock.then(op)` propagates the rejection; no `.catch` resets the chain. A transient disk failure permanently kills all secret persistence for the session.
- **F4-B — STALE ROLLBACK CAPTURE (P1, desktop):** with queued `setSecret('k','v1')` then `setSecret('k','v2')` where v1 succeeds and v2's persist fails, final state = **memory `old`, disk `v1`** (diverged). `previousValue` is captured at queue time (memory still `old`) so the rollback restores stale state; the directive's expected invariant (memory == disk == v1) is violated.
- **F4-C:** `clearSecret` shares both defects; queue never recovers; memory/disk equivalence broken after any queued failure.
- **F4-D:** `getLoadError()` exists but is still referenced **only by the class itself and tests** — no runtime or UI surfaces it, so a future UI cannot yet distinguish "empty store" from "failed-to-load store". The new committed test covers only the single-failure happy-path rollback — none of F4-A/B/C.

## 7. Two-Stage Reconciliation Correctness (F5)

- Structure verified: Stage A (sync: add/delete/stat-changed) before interactive; Stage B (background hash verification, 16 workers) after; watcher attached after Stage A; `close()` awaits `waitForVerification()` then checkpoints, unsubscribes, stops the watcher, closes the index.
- Same-size + same-mtime offline change IS detected by Stage B hash verification (empirically exercised — state entered `verifying`, the verifier read and re-indexed the changed file).
- **`'verified'` state lies (P1):** `runBackgroundVerification` wraps every candidate read/parse/upsert in `try { … } catch {}` — an EMPTY catch — then unconditionally sets `_reconciliationState = 'verified'`. A file that disappears mid-verification, a permission-denied read, a parse failure, or an upsert failure is silently swallowed and the runtime still reports `verified`. **`'degraded'` is never assigned anywhere — unreachable by construction.** "Verified" does not mean verification succeeded.
- **Verifier/watcher stale-write race (P2):** the verifier's `index.upsert` and the watcher's `index.upsert` have no ordering or version guard between them. The verifier's read→parse→upsert can straddle a watcher write of newer content (large-file parse/upsert measured at 0.5 s + 5 s for 20 MB / 274k links). Not reproduced empirically on this box: native `fs.watch` delivery latency here was 3–69 s, consistently letting the verifier finish first (final index = disk in all runs). The hazard is code-level real (fast watcher platform + slow verifier = stale derived index that does not self-heal until the next event/restart).
- Close interaction: verified sound (awaits background verification before checkpoint/close). A narrow race remains: an in-flight watcher handler is not awaited at close (P3).

## 8. Background-Verification Race / Failure Behavior

Covered in section 7. Summary: failures → still `verified` (P1); verifier vs watcher ordering unguarded (P2, not empirically forced); delete/rename during verification share the empty-catch swallow.

## 9. GitHub Pages Verification (F6)

- `vite.config.ts` uses `base: process.env.VITE_BASE_PATH || './'` (portable relative base; absolute override via env).
- Production build served and booted in Chromium under **both** `/OpenOb/` and `/fork-name/`: HTTP 200, React app mounts (header/app-container rendered), **0 asset 404s, 0 console errors, 0 page errors** in each.
- No backend, no Electron workaround required. Local dev (vite :3000) unaffected.
- P3: `index.html` pulls Google Fonts (fonts.googleapis.com / gstatic.com) — an external network dependency for a "local-first offline" app.

## 10. Browser FSA Fallback (F7)

- Capability getter **fixed and verified**: `atomicWrites === true` with `FileSystemFileHandle.prototype.move` present (Chromium 1228), `=== false` after deleting it. (The old `FileSystemHandle.prototype.move`-only check under-reported on Chromium.)
- Fallback (no `move`) direct write works; `atomicWrites` correctly false.
- **Failure-safety (empirically benign in Chromium 1228):** failure before/during the direct `createWritable().write()` leaves the **original target byte-identical** (Chromium buffers and only commits at `close()`); failure at `close()` commits the new content and reports an error — a benign false-failure, no truncation or partial write observed at any injection point.
- **Incomplete per the directive:** the mandated **user-visible warning** when atomic replacement is unavailable does not exist. Only `console.warn` is emitted; `atomicWrites` has **zero production consumers** (grep: only the class definition + `.d.ts`). A browser without `move` would silently degrade to non-atomic writes with no UI notice.

## 11. Metadata / BOM (F8, F10)

- **F8:** `ParsedDocument.modifiedAt` / `size` typed and populated in the rebuild, desktop reconcile, watcher, and verifier paths. Remaining `(doc as any).modifiedAt/.size/.hash` casts exist only in the direct-upsert fallback at `sqlite-index.ts:445-447` (`?? 0`); not a production caller issue.
- **F10 (byte-level, verified):** BOM file → `read()`: `hasBom=true`, `textContent` retains `\uFEFF`, raw bytes `EF BB BF`; `readText()` retains `\uFEFF` (consistent); write of the edited buffer (still starting with `\uFEFF`) → `snapshot.hasBom=true` and **disk bytes `EF BB BF` preserved**. read/readText/write.snapshot now mutually consistent. BOM-prefixed frontmatter is parsed correctly by the parser (verified: `hasFrontmatter=true`, properties extracted).

## 12. Regression Sweep

All previously-verified foundations remain intact (re-verified via the passing suite + targeted probes):

- Filesystem vault-escape corpus: `symlink-security.test.ts` ✓ (containment code untouched by F-waves).
- Node atomic writes / SafeWriter: ✓ (untouched).
- BOM preservation: ✓ (F10 above).
- SQLite persistence + corruption recovery: `sqlite-disposal-rebuild`, `restart-persistence` ✓.
- Offline add/delete/rename, same-size+same-mtime detection: ✓ (hash-based Stage B detection exercised).
- Index parity (Memory vs SQLite): `sqlite-memory-parity` ✓.
- **10k performance gates (real-file probe, production paths):** batch rebuild 511 ms, **single upsert 198 ms (<500 ms)**, **graph 266 ms (<10 s)**, search 74 ms, graph complete (10000 nodes / 19996 edges). The P1-SCALE-001 cliff from the prior audit (9.3 s upsert, 46.3 s graph @10k at `72f14b3`) was fixed by the T3/T4 work in `5ec3cd0`.
- Plugin live context + permissions: `first-party-plugins`, `plugin-sandbox` ✓ (untouched).
- Markdown hostile-XSS: rendering pipeline untouched; CI grep still guards `dangerouslySetInnerHTML` ✓.
- BYOK / AI isolation: `local-ai`, `cloud-ai-gateway` ✓ (untouched).
- Production build + CI gates: green ✓.

## 13. Documentation Truth

- The remediation commit message claims "complete final remediation waves **F1-F10**" — **false for F1, F3, F4, F5, F7, F9** (see matrix).
- `FINAL_CLOSURE_AUDIT.md` / `GEMINI_FINAL_REMEDIATION.md` (the previous audit's outputs, now committed) accurately describe the tasks as **required**, not done — but their acceptance criteria are NOT met at HEAD for: real browser concurrency tests (P3-TEST-001 / T11 unmet: the new file is not a browser test, Playwright absent), background-verification truthfulness (T6 criterion "background verification completes correctly" — false, empty catch), and the user-visible atomicity warning (F7 requirement).
- No false "unfreeze lifted" claim was found in `ROADMAP.md` / `TESTING.md` / `SECURITY.md`; the unfreeze language lives in the audit docs and is conditional, which is honest.

## 14. Remaining P0/P1

- **P1-CONC-A (web, F1):** false ConflictError + **silent human-edit loss** when a save spans the autosave debounce (probe A2/A3): v2 never reaches disk, conflict UI stuck, no recovery. Root cause: `finally`-pending-save reads pre-render refs (stale `expectedVersion`), proven by instrumentation (`fe786c16` vs disk `8ce26778`).
- **P1-CONC-D (web, F3):** property mutation **silently lost** + falsely clean when the property save completes before the autosave fires (probe D-silent); `diverged` commit-point is dead code. Applies equally to the AI-apply path's truthfulness (false `success: true`).
- **P1-REC (desktop-runtime scope):** `'verified'` state lies — empty catch, `degraded` unreachable (F5). Does not affect the browser product (web never runs the desktop runtime), blocks desktop.
- **P1-SEC (desktop scope):** secret-store write queue permanently poisoned after one failure + stale rollback capture → memory/disk divergence (F4-A/B). Blocks future Electron; does not affect web.

## 15. Remaining P2/P3

- **P2-TEST / RELEASE-GATE (web):** the committed "browser concurrency probes" are not browser/hook tests; the concurrency fixes have **no genuine regression coverage**, and no browser smoke job exists (F9). Severity is P2 — the missing coverage is not itself the production data-loss bug (those are P1-CONC-A/D) — but real production-hook browser coverage remains a **REQUIRED feature-unfreeze condition** (release-gate: YES; do not unfreeze until it exists).
- P2: verifier/watcher stale-write ordering race (F5; realistic on fast-watcher platforms with large files).
- P2: B2 (A→B→A during save) spurious conflict + `dirty:false` contradiction (same stale-version mechanism).
- P2: AI apply reports `success:true` when the human typed during the save (the AI result is then reverted by autosave; the user is never told).
- P2: F8 `(doc as any)` casts remain in the direct-upsert fallback.
- P3: close-during-in-flight-watcher-handler not awaited; Google Fonts external dependency; 874 kB chunk warning; `getLoadError` not surfaced by any runtime/UI.

## 16. Web-Alpha Unfreeze Decision

Per the post-audit unfreeze standard (all of): no web/shared P0; no web/shared P1; A1-A4, B/B2 pass through the REAL production hook; property-mutation race tests pass in both timing orders; AI apply + human typing passes; no false conflict from stale internal snapshots; disk eventually equals the latest human buffer after autosave; browser local save verified end-to-end; containment verified; hostile rendering inert; Pages builds under subpaths; 10k gates healthy; CI green; CI includes a real browser job exercising production React behavior. The following are **NOT satisfied**:

- No web/shared P1 → **false** (P1-CONC-A, P1-CONC-D are web-scope).
- Real production-hook Probe A → **fails** (A2/A3).
- Real production-hook Probe D → **fails** (D-silent).
- No false conflict from stale internal snapshots → **false** (A2/A3, B2).
- Disk eventually equals the latest human buffer after autosave → **false** (A2/A3: v2 never reaches disk).
- Regression tests exercise production behavior / CI real browser job → **false** (F9: the "browser" tests are logic copies; Playwright not installed; release-gate P2-TEST).

**Recommendation: KEEP FEATURE FREEZE.** Web feature work resumes only after the F1/F3 fixes pass independent re-probe on the real hook, the F9 browser-coverage gap is genuinely closed (real Playwright job), and no web P1 remains. The 10k performance gates, containment, XSS inertness, Pages subpaths, and CI green-ness are all currently satisfied — they are not the blockers.

## 17. Deferred Desktop/Electron Blockers

Electron remains deferred (per directive). Desktop-runtime defects that must be fixed before any future Electron shell:

- P1-REC: `'verified'` state honesty (empty catch; make `degraded` reachable and truthful) + verifier/watcher ordering.
- P1-SEC: secret-store queue poison + stale rollback capture; surface `getLoadError` in the runtime/UI.
- F7: user-visible warning when atomic browser replacement is unavailable (also web-relevant for non-Chromium browsers).
- P2: watcher-handler/close race; BOM-frontmatter already fine.

---

## FINAL SCORECARD

- Canonical File Safety: **5/10** (A2/A3 silent edit loss; D-silent property loss)
- Browser Local Persistence: **7/10** (FSA verified end-to-end; fallback benign but unwarned)
- Frontend Concurrency Safety: **4/10** (A1/A4/B fixed; A2/A3, B2, D-silent fail)
- Filesystem Boundary Security: **10/10** (containment intact and tested)
- SQLite Persistence: **9/10** (verified; metadata fallback casts)
- Background Verification Correctness: **3/10** (`verified` lies; `degraded` unreachable; unguarded race)
- Startup Performance: **8/10** (batch rebuild 10k = 511 ms)
- Index Correctness: **8/10** (parity ✓; per-file upsert still O(N²)-class)
- Graph Correctness: **9/10** (10k graph 266 ms, complete edges)
- Large-Vault Scalability: **7/10** (10k healthy; 50k/100k previously verified)
- AI Mutation Safety: **6/10** (human buffer preserved; false `success:true`; incidental conflicts)
- Plugin Runtime Correctness: **8/10** (untouched, tests green)
- Secret Handling: **4/10** (queue poison; stale rollback; unsurfaced load errors)
- Markdown Rendering Security: **9/10** (untouched; CI guard intact)
- GitHub Pages Readiness: **9/10** (both subpaths boot; Google Fonts P3)
- Test Credibility: **3/10** ("browser" tests are logic copies; no Playwright)
- CI Credibility: **6/10** (green + boundary greps; no browser smoke job)
- Web Alpha Readiness: **3/10** (two web P1s + no genuine concurrency coverage)

**WEB RECOMMENDATION:** KEEP FEATURE FREEZE

**DESKTOP/ELECTRON PREREQUISITE STATUS:** NOT YET READY
