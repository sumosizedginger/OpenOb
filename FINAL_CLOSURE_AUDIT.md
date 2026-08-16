# OpenOb — Final Pre-Electron Closure Audit

Audit pass: read/test/analyze only. No production code modified. Temporary probes (vitest + Playwright/Chromium 1228 against vite-served real modules and the real `useVault` hook) were used for empirical reproduction and removed. **Working-tree truth:** the audit made no production-code modifications; `git status` at HEAD shows only the two untracked audit documents (`FINAL_CLOSURE_AUDIT.md`, `GEMINI_FINAL_REMEDIATION.md`). "No production-code modifications by the audit" is NOT equivalent to "git working tree clean" — the tree is not clean because the audit outputs exist. Electron: out of scope (see Deferred section).

---

## 1. Exact audited SHA

`5ec3cd0` — "fix(re-audit): resolve all outstanding findings T1-T13" on top of the previously audited `72f14b3`. All T1-T13 remediation commits are present in this HEAD. Working tree at audit time: **no production-code modifications**; `git status` shows only the two untracked audit documents — the tree is not "clean" (see intro; the earlier "Working tree clean" phrasing was imprecise and is corrected here).

## 2. Baseline gates

| Gate | Result |
|---|---|
| `npm ci` | PASS (0 vulnerabilities) |
| `npm run typecheck` | PASS |
| `npm test` | **41 files / 140 tests, all passing, 0 skipped** (21.3 s) |
| `npm run build` | **PASS (exit 0)** — web bundle 873 kB (gzip 287 kB); >500 kB chunk warning remains |
| CI steps run locally | npm ci, boundary grep, dangerouslySetInnerHTML grep, typecheck, test, build — all green |
| CI gaps | NO browser-smoke step; NO scale-benchmark step (T11 not implemented) |

## 3. Previous P1 reverification

| Prior P1 | Disposition at `5ec3cd0` | Evidence |
|---|---|---|
| P1-FS-001 filesystem escape (T1) | **VERIFIED FIXED** | Junction to `vault-evil`: read/write/move/remove/createFolder/stat/exists ALL throw `SecurityError`; sibling untouched; in-vault links still work; write() re-realpaths the parent immediately before rename (TOCTOU window closed for write). Residual: move()/remove() single-validation TOCTOU window (sub-microsecond, needs co-actor inside the vault) — documented, not exaggerated |
| P1-IDX-001 O(N²) upsert (T3) | **VERIFIED FIXED** | Single upsert @10k: 9.3 s → **68 ms** (100k: 478 ms); batch-loaded child tables (N+1 removed); incremental `refreshAffectedLinks`; mid-transaction sync failure → ROLLBACK with clean recovery |
| P1-GRAPH-001 graph (T4) | **VERIFIED FIXED** | Graph @10k: 46.3 s → **767 ms**; @100k: **6.9 s with the FULL 999,986-edge set** (no dropped nodes/edges, no sampling); Memory/SQLite parity holds under incremental resolution (PARITY_OK) |
| P1-CI-001 build red (T5) | **VERIFIED FIXED** | Root `npm run build` now = web workspace build + passes on a fresh `npm ci`; honest build decision (source-only packages, per coordinator review) |
| P1-UI-001 plugin context (T2) | **VERIFIED FIXED** | Enabled plugins observe live context via accessor (new storage/index/active-note after `updateContext`); permissions remain frozen (immutable snapshot); App.tsx:131-137 keeps context synced; host-level probe + app wiring confirmed |

**Also reverified:** T6 reconcile correctness (same-size + same-mtime offline change now detected — hash verification), T7 secret crypto (random per-file salt, PBKDF2 600k, AES-GCM, serialized writes, atomic temp+rename, no plaintext leak on wrong passphrase/corrupt record), T8 FSA capability flag (getter added — but see new P3), T9/T10 useVault (partial — see new P1s), T12 same-size test (now genuinely same-size: `'created'→'altered'`, 42-byte assertion + mtime restore), T13 docs (D-005 restated to facade; F-019→F-035; "sandboxed" comments removed).

## 4. Save/autosave concurrency — FAIL

Three empirically proven silent-edit-loss races in `apps/web/src/hooks/useVault.ts` (real browser, real hook, deliberately slow storage):

- **Probe A (type during save):** manual save of v1 starts (3.2 s); user types v2 at +0.8 s. Save completes: `saveStatus` → `'saved'` (lies), editor = v2, **disk = v1**, `isDirty` = true, and **no autosave ever re-fires** (7 s watch). Root cause: `saveActiveNote` early-returns while `isSavingRef` (line 333); the autosave effect deps `[activeTab.content, activeTab.isDirty]` (528-536) do not change when the save completes (content same, isDirty true→true) — the consumed autosave opportunity is never re-armed. **Silent edit loss on close.**
- **Probe B (switch tabs during save):** while Welcome.md saves slowly, switch to Kaelen.md and type. A's completion clobbers B: `parsedDoc.path` = 'Welcome.md', B's backlinks replaced with A's, `saveStatus` = `'saved'` while B is dirty. Root cause: the claimed guard `if (activeTabPath === savingPath)` (line 363) compares a closure variable to itself — **always true, a no-op**. The P2-UI-002 fix was falsely claimed.
- **Probe C (rapid saves):** PASS — 3 rapid saves serialize correctly (isDirty false, disk correct).

## 5. AI concurrency — FAIL (state level)

- **Probe E (AI apply while typing):** divergence check (line 619) passes against the buffer; user types during the slow `safeSave`; completion unconditionally replaces the buffer with `proposedContent` and sets `isDirty:false`. Result: **human text lost from state AND never on disk, falsely marked clean, no conflict surfaced.** The expectedVersion protection only triggers a `ConflictError` when a *competing save* races — typing alone (2 s autosave debounce) does not. **There is no post-await commit point** in `applyAIProposedEdit` (631-647) or `updateNoteProperty` (555-564). Disk-level protection works when a competing writer exists (external change / autosave racing → conflict surfaced, disk protected — verified); the same-tab typing window is the unprotected hole.
- Double-apply / rename / delete / external-change paths: protected by version checks + ConflictError catch (non-active and competing-writer paths).

## 6. Browser FSA — PASS (real browser)

Full frontend flow verified in Chromium with the real FSA API (stubbed picker → real OPFS handle): select directory → open note → edit → autosave → disk updated; create nested unicode note; rename (old gone, unicode new exists); delete (properly gated by `confirm()`); external modification → ConflictError surfaced, disk protected (external wins); BOM preserved (`hasBom` true, byte-exact); **reload → reopen → content persisted exactly**. No truncation/overwrite paths found in the temp+move path. Browser local persistence genuinely works.

## 7. GitHub Pages readiness — GAP (P2)

- PASS: no router (SPA, refresh-safe); no Node-only module in the runtime bundle (0 markers at HEAD); no backend needed (edit flow is client-only); `openDirectoryVault` wired to a direct `onClick` (valid user gesture); unsupported browsers get a clear alert (useVault.ts:250); FSA works under HTTPS secure contexts.
- **GAP:** `apps/web/vite.config.ts` has no `base`, so the production build emits absolute asset paths (`src="/assets/index-*.js"`). Under `https://user.github.io/OpenOb/` all assets 404. Required change: a PORTABLE base — prefer a relative Vite base (`./`) where compatible with the router-free SPA, or an environment/config-driven base supplied at build time (conceptually `process.env.VITE_BASE_PATH || './'`, or the equivalent supported Vite mechanism) — NOT a hardcoded `/OpenOb/`, so forks, renamed repos, custom domains, and alternate static hosts work without editing source. Verify the build mounted under both `/OpenOb/` and a differently-named subpath (e.g. `/fork-name/`). → P2-PAGES-001.

## 8. Filesystem containment — PASS

All seven operations blocked through the vault-evil junction; direct traversal blocked; no false positives; case-variant handled (win32-only lowercasing; POSIX compares case-sensitively); write() re-verifies the parent realpath before rename. Documented residual: move()/remove() validate-then-operate TOCTOU window (requires a co-actor racing inside the vault; not exploitable in normal use).

## 9. 1k/10k/50k/100k results

| Metric | 1k | 10k | 50k | 100k |
|---|---|---|---|---|
| seed (files on disk) | 206 ms | 6.1 s | 38.2 s | 82.5 s |
| cold create (scan+parse+rebuild+checkpoint) | 959 ms | 6.37 s | 29.6 s | 60.3 s |
| search | 12 ms | 89 ms | 368 ms | 850 ms |
| backlinks | 3 ms | 7 ms | 25 ms | 55 ms |
| graph (FULL edges) | 53 ms / 6,080 | 767 ms / 97,784 | 3.2 s / 497,784 | 6.9 s / 999,986 |
| single upsert | 30 ms | 68 ms | 217 ms | 478 ms |
| shutdown | 4 ms | 22 ms | 120 ms | 311 ms |
| warm start, 0 changed | 371 ms | 3.9 s | 18.2 s | **46.6 s** |
| warm start, 1 changed | 354 ms | 3.7 s | 20.0 s | **50.7 s** |
| warm start, 100 changed | 3.2 s | 11.2 s | 49.6 s | **104.6 s** |
| heap / db | 23 MB / 3 MB | 132 MB / 30 MB | 131 MB / 152 MB | 181 MB / 307 MB |

No catastrophic cliff at any scale. Graph and upsert no longer block large vaults.

## 10. 100k warm-start regression — CONFIRMED (P2-WARM-001)

Previous behavior (old reconcile): 100k persistent restart ≈ 4.8 s. At HEAD with T6 hash-verifying reconciliation: **46.6 s (0 changed), 50.7 s (1 changed), 104.6 s (100 changed)** — a ~10× warm-start regression, at every scale (10k: 451 ms → 3.9 s). The correctness gain is real (same-size+same-mtime offline changes now detected) and this is derived-state verification, not canonical corruption — but 46 s of startup blocking at 100k is an operational regression.

**Safer optimizations that do NOT reintroduce stale state:**
1. Add `ctime` (and `birthtime` where available) to the persisted stat tuple; skip a file only when (size, mtime, ctime) all match. Userland mtime-restore tools cannot restore ctime, closing the same-size hole without reading most files on NTFS/APFS/ext4 (FAT has no usable ctime — fall back to hash there).
2. Run reconciliation in the background after the app becomes interactive ("indexing…" indicator) so startup latency is not perceived.
3. Keep the current behavior as the correctness baseline; do NOT revert to the (size,mtime)-only fast path.

## 11. Index/graph correctness and scale — PASS

10k gates: rebuild ≈ 5 s (marginal, includes scan/checkpoint; committed harness gates 1k < 10 s), search 89 ms (< 500 ms ✓), upsert 68 ms (< 500 ms ✓), graph 767 ms (< 10 s ✓ — and 6.9 s at 100k). Graph integrity: full edge set at every scale (999,986 edges @100k) — no dropped nodes/edges, no sampling, no semantic change. Memory/SQLite parity re-verified under the incremental resolver (ADD/UPDATE/DELETE/RECREATE, alias changes, backlinks: identical). Incremental resolution is semantically equivalent to full resolution (targeted refresh covers incoming resolved links, unresolved links, and alias-name links; verified by parity + the rollback test).

## 12. SQLite correctness — PASS

Persistence, corrupted-DB reconstruction, deleted-DB reconstruction, offline add/delete/rename, same-size offline modification, **same-size + same-mtime modification (now detected)**, metadata-only change (hash unchanged → metadata update only), canonical-file-wins, and SQLite cannot mutate Markdown (reconciliation only reads canonical files) — all verified at HEAD.

## 13. Secret-storage failure semantics — FAIL (P1-SEC-001) [deferred desktop-runtime scope]

**Scope note:** P1-SEC-001 blocks future Electron/desktop delivery, not the current browser-local GitHub Pages product, because the Electron application is deliberately deferred. It is not a web-alpha blocker. It remains a P1 defect, the code already exists, and it must still be fixed in this remediation pass (Wave B) — but the web feature-unfreeze decision must not depend on it.

- Crypto: random 16-byte per-file salt, PBKDF2 600k, AES-256-GCM, serialized concurrent writes (writeLock), atomic temp+rename, wrong-passphrase/corrupt-record → `getLoadError` set + no plaintext leak — all verified.
- **Persistence-failure reporting is broken:** injected temp-write (ENOSPC) and rename (EPERM) failures → `setSecret` **resolves successfully**; the secret exists only in memory; a fresh store sees `null` — the durable write silently became ephemeral and the secret is lost on restart. (mkdir failure throws — inconsistent semantics; mkdirSync sits outside the try/catch.) `persistToDisk` swallows write/rename errors (console.error only).
- **`getLoadError()` is never surfaced**: referenced only in tests; no runtime/UI reads it — a corrupt secrets file or wrong passphrase still silently looks like "no saved keys".

## 14. Plugin context/security — PASS

Enabled plugins observe the newest storage/index/active-note-path via the context accessor (host probe: write after `updateContext(B)` lands in B; permissions remain frozen). App keeps `updateContext` synced on every state change (App.tsx:131-137). Docs are honest at HEAD: D-005 = capability-gated facade with isolation "planned for third-party" (F-032); F-019→F-035; "sandboxed" comments removed; no third-party install path exists — no false security expectations are created. Same-realm permission facade remains the accurate classification.

## 15. Markdown rendering security — PASS

Full 18-payload hostile corpus rendered through the real `PreviewPane` in Chromium at HEAD: 0 dialogs, zero dangerous elements, zero `on*` handlers, zero `javascript:` URLs, escaped text only. Zero dangerous DOM APIs in production source. CI ban verified active via two independent mechanisms (workflow grep with `--exclude-dir=__tests__` + a runtime static-scan test asserting no production file contains `dangerouslySetInnerHTML`). No CSP header (pre-existing P3).

## 16. Test credibility — PARTIAL

Fixed by the remediation: same-size test is now genuinely same-size (byte-length assertion + mtime restore); scale harness has real 1k-pipeline gates (rebuild < 10 s, search < 500 ms, backlinks < 200 ms, graph < 5 s) and a 10k upsert < 500 ms gate with realistic docs; P1-FS-001 and P1-UI-001 regression tests promoted. Remaining gaps: (a) **zero browser tests in the permanent suite** — the FSA and concurrency probes in this audit were temporary; the three P1 concurrency races would not be caught by the current 140 tests; (b) no 10k-graph / 50k / 100k gates in the harness; (c) the committed 1k graph gate (< 5 s) is weaker than the 10k < 10 s requirement; (d) no async-overlap/slow-storage tests for `useVault`; (e) watcher tests rely on real debounce sleeps (mildly timing-dependent).

## 17. CI credibility — PARTIAL

CI permanently covers typecheck, npm test (140), production build, and both security greps — all verified green by executing the steps locally. **Not covered (T11 unmet):** browser smoke behavior and scale regression (the harness exists but is not wired in). Recommended split, based on measured runtimes: per-commit = fast correctness + 1k/10k gates (≈ 15-25 s); scheduled/manual = 50k/100k scale (≈ 2-4 min) + real-browser integration (≈ 30 s).

## 18. Newly discovered findings

### P1-CONC-001 — Autosave opportunity permanently consumed by an in-flight save (silent edit loss)
- **Evidence/repro:** probe A — editor v2, disk v1, `saveStatus 'saved'`, isDirty true, no further autosave in 7 s.
- **Root cause:** `saveActiveNote` early-return on `isSavingRef` (useVault.ts:333) + autosave effect deps `[content, isDirty]` (:528-536) don't re-arm after completion; `setSaveStatus('saved')` fires unconditionally.
- **Fix:** after a save completes, if the tab is still dirty, re-arm the autosave (or make the early-return defer rather than consume the opportunity); set `saveStatus` only when the saved content matches the buffer.

### P1-CONC-002 — Tab-switch guard is a self-comparison no-op (falsely-claimed-fixed P2-UI-002)
- **Evidence/repro:** probe B — B's preview/backlinks/status clobbered by A's save completion.
- **Root cause:** `if (activeTabPath === savingPath)` (useVault.ts:363) — both closure values from the same render.
- **Fix:** compare against a live ref (e.g., `activeTabPathRef` updated every render) or a per-save generation token.

### P1-CONC-003 — Property/AI updates unconditionally replace the buffer after the await (no commit point)
- **Evidence/repro:** probes D/E — human keystrokes during the slow save lost from state, `isDirty:false`, no conflict.
- **Root cause:** `updateNoteProperty` (:555-564) and `applyAIProposedEdit` (:631-647) run the divergence check before the await, then replace content unconditionally.
- **Fix:** re-check the buffer still equals `originalContent`/the pre-edit content at completion; if it changed, surface a conflict instead of replacing; keep the disk-level expectedVersion protection.

### P1-SEC-001 — `setSecret` reports success on persistence failure; `getLoadError` never surfaced
- **Evidence/repro:** injected writeFileSync/renameSync failures → setSecret resolves, memory-only secret, fresh store sees null.
- **Fix:** propagate persistence failures (reject `setSecret` or expose a load/persist error the UI surfaces); surface `getLoadError()` in the settings UI so a corrupt file/wrong passphrase is not shown as "no saved keys".

### P2-WARM-001 — 100k warm start regressed to 46.6 s (correctness strategy, not a bug)
- See section 10; recommended ctime-gated fast path + background reconciliation.

### P2-PAGES-001 — Missing vite `base` breaks GitHub Pages subpath deployment
- `vite.config.ts` has no `base`; built assets are absolute. Use a PORTABLE base (relative `./`, or an env/config-driven base supplied at build time) — not a hardcoded `/OpenOb/` — and verify under both `/OpenOb/` and a differently-named subpath (e.g. `/fork-name/`).

### P3-FSA-001 — `atomicWrites` getter under-reports on Chromium; no UI notice for the non-atomic fallback
- Checks `FileSystemHandle.prototype.move` (undefined in Chromium 1228; move lives on `FileSystemFileHandle.prototype`) → reports false on a fully capable browser (conservative direction; writes still atomic via the subclass method). The no-`move()` fallback direct-write provides NO atomic replacement guarantee. **Scope of the claim:** whether an interrupted/failed fallback write actually truncates canonical content was NOT empirically reproduced in this audit (the fallback is unreachable in Chromium 1228, where `move()` exists on the subclass) — the accurate description is "atomic replacement guarantee unavailable or unverified", not demonstrated corruption. The fallback also only emits a console.warn (no UI notice).

### P3-IDX-001 / P3-FS-002 — Carry-overs outside T1-T13 scope
- `(doc as any).modifiedAt/size/hash` metadata contract (sqlite-index.ts:264-269, rebuilder.ts:41-42) — data correct in the desktop path, but untyped; plugin/parity callers store 0.
- Node `write()` snapshot still omits `hasBom` (read() sets it).

### P3-TEST-001 / P3-CI-001 — No browser tests, no concurrency tests, harness not CI-wired
- The three P1 concurrency races and the FSA flow have no permanent regression coverage; the scale harness and a browser smoke job are absent from CI.

## 19. Remaining alpha blockers

**Current Web-Alpha P1 Blockers (must be fixed and independently re-probed before web feature development resumes):**
P1-CONC-001, P1-CONC-002, P1-CONC-003.

**Deferred Desktop-Runtime P1 Blocker (blocks future Electron/desktop delivery, not the browser-local product; still fix in this remediation pass):**
P1-SEC-001.

P2 (should fix): P2-WARM-001 (web-relevant: startup UX), P2-PAGES-001 (web-relevant: deployment), the FSA fallback UI notice (folded into P3-FSA-001), and the P3-TEST-001/P3-CI-001 coverage work (regression tests for the P1s).
P3: as listed; none block alpha.

## 20. Deferred — Electron

**Electron is deferred.** Do not add Electron tasks, IPC design, preload design, packaging, installers, or Electron dependencies in this remediation. Existing `packages/desktop` runtime code (Node filesystem, SQLite persistence, watcher, secret storage) remains in scope, auditable, and repairable — the Electron shell comes only after the web/local-first foundation is trusted. Prerequisites that must remain stable before Electron work begins: (1) the desktop runtime's public surface (DesktopVaultRuntime/SafeWriter/SecretStore contracts) is stable; (2) the web app's save/reconcile semantics are the source of truth (the P1-CONC fixes must land first so Electron does not inherit the races); (3) secret-store failure semantics are corrected (an Electron shell must be able to surface load/persist errors); (4) the same-size/mtime reconciliation behavior is finalized (warm-start cost is a desktop-relevant UX question). Electron is not a blocker for the current web/local-first foundation.

---

## FINAL SCORECARD

```
Canonical File Safety: 7/10          (Node save path solid; useVault races can silently drop edits)
Browser Local Persistence: 8/10      (FSA verified end-to-end; fallback notice gap)
Frontend Concurrency Safety: 4/10    (three empirically proven silent-edit-loss P1 races)
Filesystem Boundary Security: 9/10   (containment fixed; documented move/remove TOCTOU residual)
SQLite Persistence: 9/10             (verified; metadata-contract hack)
Startup Reconciliation: 6/10         (correct, but 100k warm start 4.8s -> 46.6s)
Index Correctness: 9/10              (parity + rollback verified)
Graph Correctness: 9/10              (full edges at 100k, consistent)
Large-Vault Scalability: 8/10        (graph 6.9s@100k, upsert 478ms@100k; warm-start slow)
AI Mutation Safety: 5/10             (disk protected; state clobber when typing during apply)
Plugin Runtime Correctness: 9/10     (context fix verified end-to-end)
Secret Handling: 5/10                (crypto solid; silent persistence failure, load error unsurfaced — desktop-runtime scope, deferred for web-alpha gating)
Markdown Rendering Security: 9/10    (hostile corpus inert; no CSP)
GitHub Pages Readiness: 6/10         (base config missing)
Test Credibility: 6/10               (gates real; no browser/concurrency tests)
CI Credibility: 6/10                 (green locally; no smoke/benchmark steps)
Public Alpha Readiness: 5/10
```

```
RECOMMENDATION:
KEEP FEATURE FREEZE
```

Four P1 findings remain. Scope split: **Web-Alpha P1 blockers** (P1-CONC-001 autosave opportunity consumed, P1-CONC-002 stale-tab state clobber via the no-op guard, P1-CONC-003 property/AI post-await state clobber) are proven browser-facing silent-edit-loss/state-integrity failures; **Deferred Desktop-Runtime P1** (P1-SEC-001 setSecret persistence-failure success) blocks future Electron delivery, not the browser-local Pages product — it must still be fixed in this pass but does not gate web unfreeze.

**Web feature-unfreeze standard (rewritten):** web/local-first feature development may resume only when ALL of the following hold:
- no web-scope P0 and no web-scope P1 exist;
- P1-CONC-001, P1-CONC-002, P1-CONC-003 each pass independent re-probe (probes A/B/D/E);
- browser local save passes a real integration test;
- filesystem containment passes;
- Markdown hostile corpus passes;
- CI is green;
- GitHub Pages subpath build works;
- 10k performance gates remain green;
- 50k/100k testing shows no catastrophic scalability failure.

P1-SEC-001 (F4) remains required before future Electron work and should be fixed now, but an isolated desktop secret-store defect must not be mislabeled as a browser-alpha failure. Until the web-scope list holds, the freeze stands.
