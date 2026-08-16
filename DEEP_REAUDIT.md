# OpenOb — Deep Adversarial Re-Audit

Repository: `https://github.com/sumosizedginger/OpenOb`
Branch: `main` · HEAD audited: `72f14b32b7544337bdc3b4bed7a33b912ecbcef3` (origin/main identical)
Method: fresh read/test/analyze pass. No production code modified. Temporary probe scripts used for empirical reproduction and removed after each probe (working tree clean except pre-existing local `reasonix.toml`). Playwright + Chromium 1228 used for real-browser probes. All previous conclusions treated as hypotheses and re-probed.

---

## 1. Executive Verdict

**The remediation was substantially real — most Wave 0-8 fixes are genuinely implemented and hold under adversarial re-probing — but the repository is NOT yet safe or coherent enough to resume feature work. Five P1-class defects remain that block public alpha: a demonstrated filesystem-boundary escape (read AND write outside the vault root, untouched by the remediation), a measured 46-second graph build at only 10,000 notes that fails the remediation's own declared budget, an O(N²) per-upsert index path (9.3 s per single-note update at 10k), a CI build step that fails on a fresh checkout, and plugin API closures frozen to mount-time storage that silently drop plugin-authored writes.**

What is genuinely fixed and verified at HEAD:

- Path normalization hostile corpus (25/25), BOM byte-preservation across edit cycles, atomic Node save with conflict detection, secret-store passphrase requirement, sanitizer removal with live-browser inertness proof, plugin facade enforcement (F-030 manifest freeze verified live), F-028/F-029 AI mutation safety, SQLite persistence with startup reconciliation and corrupted-DB recovery, watcher error/retry hardening.

What is still broken:

- **P1-FS-001**: vault boundary escape (junction → sibling `vault-evil` → read AND write outside vault root). Empirically reproduced.
- **P1-GRAPH-001 / P1-SCALE-001 partial**: graph build 46.3 s at 10k notes (578 ms at 1k) — the "graph < 10 s" gate fails.
- **P1-IDX-001**: every index upsert re-reads and re-resolves the whole vault — 9.3 s per single-note update at 10k.
- **P1-CI-001**: `npm run build` (the CI build step) fails on a fresh checkout; "CI green" sign-off claim is false.
- **P1-UI-001**: plugin APIs are frozen to mount-time context; first-party plugin writes silently target a memory vault — plugin-created notes are silently lost on reload.
- Plus a cluster of P2 races in the web save/autosave bookkeeping, the reconciliation (size,mtime) fast-path staleness gap, fixed-salt + non-atomic secret persistence, and several doc/name overstatements.

**RECOMMENDATION: FREEZE FEATURE WORK.** Fix the outstanding P0/P1 findings, re-earn the graph budget, turn the CI gate green, and pass an independent re-audit before alpha or any new roadmap phase.

---

## 2. Baseline

| Item                | Value                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD                | `72f14b32b7544337bdc3b4bed7a33b912ecbcef3` (= origin/main)                                                                                                                                                                                                                                                                                          |
| Working tree        | clean except `reasonix.toml` (pre-existing local tool config)                                                                                                                                                                                                                                                                                       |
| Node / npm          | v22.23.1 / 11.4.2 (Playwright 1.62.1 + Chromium 1228 available)                                                                                                                                                                                                                                                                                     |
| `npm run typecheck` | PASS (0 errors)                                                                                                                                                                                                                                                                                                                                     |
| `npm test`          | **41 files / 137 tests, all passing**, 0 skipped, ~5-6 s                                                                                                                                                                                                                                                                                            |
| `npm run build`     | **FAILS** — root script `npm run build --workspaces` errors on 7 library workspaces (missing `build` script); `@okw/web` vite build itself succeeds (3.07 s) with warnings: externalized `fs/promises`/`path` named exports from `packages/vault/src/node-fs-storage.ts` ("not exported by `__vite-browser-external`") and 872.81 kB chunk > 500 kB |

The test count matches the GEMINI_REMEDIATION sign-off (41/41, 137); the build claim does not ("clean Vite bundle 100% green" is only true for the web workspace, not for the documented root gate).

---

## 3. Previously Fixed Findings — Reverification

| Prior finding                | Claimed fix                             | Disposition at HEAD 72f14b3             | Evidence                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-CLAIM-001 (P0)            | Restate D-021/D-022                     | **VERIFIED FIXED** (restated)           | DECISIONS.md:101 "in-memory WASM `sql.js` engine", :107 "not machine-bound", Electron shell "planned … not delivered"; "100,000+ note vaults" wording removed. Caveats: D-005:22-23 still claims worker/iframe isolation (contradiction), D-021:103 "verified zero-data-loss durability" phrase remains |
| P1-SQLITE-001 (P1)           | open(databasePath)+checkpoint+reconcile | **VERIFIED FIXED**                      | desktop-runtime.ts:59-73 load, :266-284 async checkpoint (temp+rename), :99-118 load→reconcile/rebuild→checkpoint→watch; restart-persistence + corrupt-DB tests pass; measured: restart-at-100k 4.8 s vs 55 s cold rebuild                                                                              |
| P1-SECRET-001 (P1)           | Require masterSecret, fail closed       | **VERIFIED FIXED**                      | secure-storage.ts:22-25 throws on empty; desktop-runtime.ts:80 only constructs when provided; no default/derived key; wrong-passphrase and tampered ciphertext fail safe (tests pass); no secret in logs/bundles                                                                                        |
| P1-BROWSER-001 (P1)          | FSA temp+move atomicity                 | **PARTIALLY FIXED**                     | temp-file-then-`move()` implemented (browser-fsa-storage.ts:208-226) and verified live in Chromium (0 residue, conflicts detected); BUT `atomicWrites` hardcoded `true` while the no-`move()` fallback is a silent non-atomic truncate-write; zero browser tests in the permanent suite                 |
| P1-SANITIZER-001 (P1)        | Delete sanitizer; escaped-text policy   | **VERIFIED FIXED**                      | `sanitizer.ts` source deleted (stale `dist/sanitizer.js` remains, P3); CI ban on `dangerouslySetInnerHTML` active (ci.yml:35); live-DOM hostile corpus (18 payloads) inert: 0 dialogs, 0 executable elements, 0 handlers, 0 `javascript:` URLs                                                          |
| P1-PLUGIN-001 (P1)           | Restate; record F-032                   | **VERIFIED RESTATED**                   | PLUGIN_ARCHITECTURE.md:61, D-019:89 admit same-realm permission facade; F-032 recorded. BUT code comments still say "sandboxed" (bridge.ts:13, host.ts:17) — P2-DOC-001                                                                                                                                 |
| P1-SCALE-001 (P1)            | Harness 1k/10k/50k; graph < 10 s @10k   | **PARTIALLY FIXED / REGRESSED (graph)** | rebuild @10k = 4.76 s (< 20 s ✓), search @10k = 71 ms (< 500 ms ✓) — but **graph @10k = 46.3 s (< 10 s ✗, 5× worse than the prior audit's 9.2 s measurement)**; no 50k/100k harness exists despite TESTING.md mandate; benchmark not wired into CI                                                      |
| P2-DL-002 (BOM)              | ignoreBOM + hasBom re-emit              | **VERIFIED FIXED**                      | byte-level probe: BOM preserved exactly once through read→edit→save→reopen; non-BOM files untouched; serializer re-emits BOM (frontmatter.ts:225,278). P3: `write()` drops `hasBom` from returned snapshot; `readText()` strips BOM (default decode)                                                    |
| P2-PATH-001 (backslash)      | Convert `\` → `/`; reject drive/UNC     | **VERIFIED FIXED**                      | 25/25 hostile corpus: traversal/drive/UNC/colon/NUL rejected; backslash conversion, `%2e%2e` literal, in-vault `..` resolution correct                                                                                                                                                                  |
| P2-DL-003 (watcher)          | error handler + retry + loud fallback   | **VERIFIED FIXED**                      | fs-watcher.ts:61-64 `on('error')`→degraded flag; :50-58 loud non-recursive fallback; desktop-runtime.ts:209-251 single 100 ms retry then warn; per-path debounce, `.okw.tmp`/`.git` ignore, `stop()` clears timers                                                                                      |
| P2-CI-001                    | Node 20/22 workflow + boundary + smoke  | **PARTIALLY FIXED**                     | workflow exists (ci.yml, Node 20.x/22.x matrix, typecheck, tests); BUT build step runs `npm run build` which **fails** → CI red at HEAD; no Playwright smoke test; no benchmark step; boundary grep bypassable                                                                                          |
| P2-TEST-001 (promote probes) | Promote audit probes                    | **VERIFIED FIXED (with gaps)**          | hostile suites promoted and passing (node-fs-storage-audit 11, preview-security 2, unicode/bom/symlink/crash/disaster/restart-persistence/adversarial-rename/multi-tab); gaps in §14                                                                                                                    |
| S-2 (sessionStorage BYOK)    | Record; revisit                         | **DOCUMENTED, NOT FIXED**               | ai/src/secrets.ts:30-42 plaintext keys in `sessionStorage`; F-032 documents; same-realm plugins can read `okw_sec_*`; acceptable only because plugins are first-party today                                                                                                                             |
| P3-AI-001 (stream abort)     | Abort on provider switch                | **VERIFIED FIXED**                      | AIChatDrawer.tsx:76-81 abort before switch, :104-108 unmount cleanup, :252-258 stop button; signal → fetch (openai-compatible.ts:85); AbortError yields graceful `isDone` (:88-89). Residual cosmetic race (P3)                                                                                         |

---

## 4. Newly Discovered Findings

### P1-FS-001 — Filesystem boundary escape: bare `startsWith(root)` without separator boundary (vault-evil prefix bug)

- **Severity:** P1 (borders P0: demonstrated read AND write outside the vault root)
- **Title:** Junction/symlink inside vault to a prefix-sharing sibling directory escapes containment
- **Evidence:** Empirical reproduction in a temp vault: root `<tmp>/vault`, sibling `<tmp>/vault-evil` containing `leak.md`; junction `sub/escape → vault-evil` created inside the vault. `storage.read('sub/escape/leak.md')` returned `# SECRET OUTSIDE VAULT`; `storage.write('sub/escape/newfile.md', …)` succeeded outside the vault. Logic check reproduced: `normEvil.startsWith(normRoot)` = `true`. Root cause chain: `resolveToDiskSafe` (node-fs-storage.ts:52,63,73,77) tests `normDisk.startsWith(normRoot)` — no `===`/`root + '/'` boundary — and `normalizeFsPath` (node-fs-storage.ts:23-29) lowercases BOTH sides, making the check case-insensitive even on case-sensitive filesystems (second variant: symlink to `Vault-evil`/`VAULT-EVIL` on Linux passes).
- **Reproduction:** see probe above (junction creation worked without admin on Windows); repeatable.
- **Root cause:** prefix comparison without separator boundary + unconditional lowercasing; realpath check uses the same weak test.
- **Affected files:** `packages/vault/src/node-fs-storage.ts` (resolveToDiskSafe :44-90).
- **Impact:** A vault opened from an untrusted source (imported vault, synced folder, shared zip) containing a junction/symlink can read and overwrite files in any sibling directory whose name starts with the vault root path (e.g., `vault`, `vault-evil`, `vault-backup`). Violates the primary containment guarantee; TOCTOU swap after check remains an inherent residual (honest note: the check is per-call, the write uses the un-rechecked `diskPath`).
- **Recommended correction:** `const inside = normDisk === normRoot || normDisk.startsWith(normRoot + '/')` in all three checks; lowercase only on `win32` (or compare case-sensitively on POSIX); apply the same to the realpath and ancestor checks. Consider `realpath` re-verify immediately before rename.
- **Required regression test:** symlink/junction to `vault-evil` (and `VAULT-EVIL` on Linux) must throw `SecurityError` for both read and write; benign sibling `vault-evil` without symlink must still be unreachable; in-vault sibling links must still work.

### P1-IDX-001 — Every index upsert/remove re-reads and re-resolves the entire vault (O(N²))

- **Severity:** P1
- **Title:** Per-single-note-update cost is O(N): 1.1 s @5k, 4.7-9.3 s @10k
- **Evidence:** Measured: `SqliteDocumentIndex.upsert` at 5k = 1,128 ms; at 10k = 4,731 ms (1 link/doc) and 9,337 ms (2 links/doc); full `rebuild` of all 10k = 280-311 ms. Code: sqlite-index.ts:281-283 (upsert) and :302-304 (remove) call `await this.getAll()` + `refreshLinkTargets(allDocs)` after every single document change.
- **Reproduction:** build 10k docs, time one `upsert`. Watcher path in `DesktopVaultRuntime` calls upsert per event → ~9 s stall per external edit at 10k; startup reconcile with 100 changed files ≈ 15+ min.
- **Root cause:** full-vault link re-resolution after every mutation instead of incrementally updating only affected targets.
- **Affected files:** `packages/index/src/sqlite-index.ts` (upsert/remove), consumed by `packages/desktop/src/desktop-runtime.ts` (watcher/reconcile).
- **Impact:** Violates the Performance Stop Rule (AGENTS.md) on the desktop runtime at realistic vault sizes; makes the watcher unusable at 10k+; startup reconciliation degrades quadratically with the number of offline changes.
- **Recommended correction:** incremental target refresh (resolve only links pointing at the changed path, using an index on `target_path`/`target_name`; mark-and-sweep only on deletes); or batch the reconcile path with a single re-resolve pass after all upserts.
- **Required regression test:** time-bound test at 10k (e.g., single upsert < 500 ms budget) — must fail at current HEAD.

### P1-GRAPH-001 — Graph construction is catastrophically superlinear (fails P1-SCALE-001 gate)

- **Severity:** P1
- **Title:** `buildGraphData` 578 ms @1k → 46.3 s @10k (80× for 10× data)
- **Evidence:** Measured in the full-pipeline benchmark. Prior audit measured 9.2 s @10k; HEAD measures **46.3 s @10k** — 5× worse than the previous measurement and 4.6× over the declared `< 10 s` budget. Extrapolation: 50k ≈ 20+ min, 100k ≈ 1 h (skipped, time-boxed).
- **Reproduction:** `buildGraphData(index, {})` at 10k docs.
- **Root cause:** graph rebuild recomputes all edges from scratch with per-edge lookups; no edge cap/sampling (D-015 mentions decay for the simulation, not for construction).
- **Affected files:** `packages/index/src/graph.ts`.
- **Impact:** Graph view is unusable at 10k+; the "10k-note benchmark acceptable" ROADMAP gate (Phase 3) and the Wave 3 P1-SCALE-001 acceptance are false at HEAD.
- **Recommended correction:** bound construction (edge cap / sampled neighbors per D-015 option), incremental edge updates, or compute in a worker with progressive rendering; re-run the 10k gate.
- **Required regression test:** time-bound graph build at 10k (< 10 s) in the scale harness; wire into CI.

### P1-CI-001 — CI build step is red at HEAD; "CI green" sign-off claim false

- **Severity:** P1 (gate integrity)
- **Title:** `npm run build` fails on a fresh checkout; workflow runs it as the last step
- **Evidence:** Baseline: root build exits 1 (missing `build` script in packages/ai, core, desktop, index, markdown, plugin, vault). ci.yml step "Build Web Production Bundle" runs `npm run build` (:43-44) — platform-independent failure. GEMINI_REMEDIATION:188-196 claims "`npm run build` (clean Vite bundle) 100% green".
- **Reproduction:** `npm ci` + `npm run build` on a fresh clone.
- **Root cause:** workspaces without a `build` script + a root script that requires all workspaces to have one.
- **Affected files:** `package.json` (root script), `.github/workflows/ci.yml`, 7 workspace package.jsons.
- **Impact:** No merge can pass CI as written; either the repo has been merging red or the claim is aspirational — either way the gate is broken and cannot be trusted.
- **Recommended correction:** add per-workspace `build` scripts (or change the root script to `--workspace=@okw/web`), then confirm the workflow passes on a fresh clone.
- **Required regression test:** CI step "fresh clone → npm ci → npm run build" (the workflow itself).

### P1-UI-001 — Plugin API context frozen at mount; first-party plugin writes silently lost

- **Severity:** P1 (silent data loss through the plugin path)
- **Title:** `createPluginAPI` captures the context object by reference at enable time; `PluginHost.updateContext` replaces the object, so enabled plugins permanently use mount-time storage/tab state
- **Evidence:** App.tsx:101-128 creates `PluginHost` in a `useState` initializer with mount-time `openNote`/`activeTabPath: null`; host.ts:29-31 `updateContext` assigns a NEW object; bridge.ts:17 captures the `context` parameter by reference; host.ts:64-69 passes the (by then stale) context to `createPluginAPI`. The update effect (App.tsx:131-137) is therefore dead for already-enabled plugins. Consequence: `api.vault.write` from daily-notes/templates/character-bible writes to the mount-time `MemoryVaultStorage`, not the user's real vault → plugin-created notes appear saved and vanish on reload.
- **Reproduction:** enable any first-party plugin, open a real (FSA/Node) vault, run a plugin command that writes a note; the file never appears on disk.
- **Root cause:** mount-once context + by-reference capture + replace-not-mutate update.
- **Affected files:** `apps/web/src/App.tsx`, `packages/plugin/src/host.ts`, `packages/plugin/src/bridge.ts`.
- **Impact:** silent canonical data loss for plugin-authored content; all plugin `workspace.openNote` navigation is wrong after storage swap.
- **Recommended correction:** mutate/refresh the context object in place (or hold a mutable context holder) so enabled plugin bridges observe updated storage/tab state; re-enable plugins after vault switch; add a regression test that writes via `api.vault.write` against a real storage and asserts the file exists on disk.
- **Required regression test:** host-level: enable plugin with context A, `updateContext` with context B, assert the plugin's next `vault.write` hits B's storage.

### P2-REC-001 — Reconciliation (size,mtime) fast path can silently skip same-size content changes

- **Severity:** P2
- **Title:** Same-size offline modification with preserved/coarse mtime is never detected
- **Evidence:** desktop-runtime.ts:173-174 compares only `size` and `modifiedAt`; when both match, the file is skipped without reading. On this NTFS host a same-size rewrite + `utimes` restore was still detected because Node/`utimes` can't reproduce sub-ms `mtimeMs` (manifest `…147.811` vs restored `…148`); on FAT/exFAT (2 s mtime resolution) and under mtime-preserving tools (rsync -t, OneDrive/Dropbox) the equal-(size,mtime) case is reachable → stale index until the next real event.
- **Reproduction:** on a coarse-timestamp filesystem, rewrite a file with same byte length within the same mtime tick while the app is closed; restart; index still shows old content.
- **Root cause:** trusting (size,mtime) equality as "unchanged" without a content check.
- **Affected files:** `packages/desktop/src/desktop-runtime.ts` (reconcile).
- **Impact:** silent stale search/backlinks/graph after restart (F-003/F-004 family).
- **Recommended correction:** when `size` matches, verify content hash (or at least when the filesystem mtime resolution is coarse); document the tradeoff.
- **Required regression test:** mock stat so (size,mtime) equal but content differs → assert the file is re-read.

### P2-SEC-001 — Fixed PBKDF2 salt and non-atomic secret-file persistence

- **Severity:** P2
- **Title:** `'okw-desktop-key-salt-v1'` fixed salt (secure-storage.ts:30); `secrets.json` written via plain `writeFileSync` with silent load failures
- **Evidence:** salt is a fixed public literal → offline precomputation amortizes across all installs; identical passphrase yields identical ciphertext (cross-install correlation). persistToDisk (secure-storage.ts:118-136) is a direct non-atomic write — a crash can corrupt `secrets.json`; loadFromDisk (:99-116) and per-record decrypt errors are swallowed silently, so a wrong passphrase or corrupt file is indistinguishable from "no secrets stored" and the user is never told.
- **Reproduction:** kill during `setSecret` (hard to time) or truncate `secrets.json`; restart silently shows no secrets.
- **Impact:** weaker-than-claimed crypto hygiene; silent secret loss without notification.
- **Recommended correction:** random per-file salt stored alongside ciphertext; Argon2id or higher iterations (OWASP 600k+ PBKDF2); atomic temp+rename for `secrets.json`; surface decrypt failure to the UI.
- **Required regression test:** corrupt `secrets.json` → constructor or first use surfaces an explicit error; concurrent `setSecret` calls serialize.

### P2-FSA-001 — `atomicWrites` flag hardcoded true; silent non-atomic fallback

- **Severity:** P2
- **Title:** When `FileSystemFileHandle.move` is unavailable, writes fall back to direct truncate-write while `atomicWrites` still reports `true`
- **Evidence:** browser-fsa-storage.ts:126 `readonly atomicWrites: boolean = true`; :220-229 fallback path writes the target directly with no capability detection or UI notice — violates P1-BROWSER-001 acceptance ("explicitly reports it does not"). Browser `move()` also non-atomic (:302-312 read→write→remove).
- **Impact:** on browsers without `move()`, crash mid-save can truncate canonical content while the UI believes writes are atomic.
- **Recommended correction:** set `atomicWrites` from capability detection; warn when the fallback engages.
- **Required regression test:** simulated no-`move()` environment → flag `false` + notice; failure mid-fallback-write leaves original intact.

### P2-UI-002 — Post-save bookkeeping races in `saveActiveNote`

- **Severity:** P2 (silent edit loss on close under race)
- **Title:** Typing or switching tabs during an in-flight save de-dirties the tab, cancels the pending autosave, and clobbers preview/status for the wrong tab
- **Evidence:** useVault.ts:333-359 captures path/content/version at invocation; :345-351 unconditionally set `isDirty:false` on the captured path after the await; the autosave effect (:519-527) is torn down when the tab is no longer dirty → text typed during the save is never autosaved (buffer retained; Ctrl+S recovers); :353-359 write `parsedDoc`/`backlinks`/`saveStatus('saved')` for the OLD tab if the user switched during the save, masking the new tab's unsaved edits.
- **Reproduction:** type continuously while Ctrl+S is held; watch `isDirty` flip false and the autosave timer vanish.
- **Impact:** silent loss of edits on app close without a manual save; wrong preview/status.
- **Recommended correction:** only clear `isDirty` if the buffer still equals the content that was saved (compare current buffer vs saved content, not captured path); guard post-save bookkeeping with the tab identity at completion time (generation token).
- **Required regression test:** simulate slow `safeSave`; type during it; assert `isDirty` stays true and autosave fires with the new content.

### P2-UI-003 — Wholesale `setOpenTabs` stale-array clobber in `updateNoteProperty` / `applyAIProposedEdit`

- **Severity:** P2
- **Title:** Property updates and AI proposal application replace the whole tabs array with a stale captured copy, discarding concurrent keystrokes in any tab
- **Evidence:** useVault.ts:532-552 (updateNoteProperty) mutates the captured `openTab` and calls `setOpenTabs([...openTabs])` with the render-time array; :604-627 (applyAIProposedEdit) same pattern; any keystroke landing during the awaits lives in a newer array that this call clobbers; the divergence check (:607) runs before the await, so typing during the save is both discarded from the buffer and overwritten on disk.
- **Reproduction:** type in tab B while applying a property change in tab A (with a slowed storage); the tab-B text disappears from state.
- **Impact:** silent loss of keystroke bursts.
- **Recommended correction:** functional updates (`setOpenTabs(prev => …)`) keyed by tab path; re-check divergence after the await.
- **Required regression test:** concurrent keystroke + property update in two tabs; assert both buffers survive.

### P2-CI-002 / P2-CI-003 — No browser smoke test; scale benchmark not wired into CI

- **Severity:** P2
- **Title:** P2-CI-001 promised a Playwright smoke test; none exists. The scale harness exists but nothing runs it.
- **Evidence:** ci.yml has no playwright/browser/benchmark step; `tests/integrity/scale-benchmark.test.ts` is never invoked (its `--run` opt-in is never used in CI).
- **Impact:** browser regressions and large-vault regressions ship undetected; TESTING.md 50k/100k mandate unenforced.
- **Recommended correction:** add a Playwright smoke job (open vault → edit → save → reload → verify) and a scheduled/opt-in benchmark job running 1k/10k/50k (and 100k when time-boxed).

### P2-TEST-001 — The "same-size modification" regression test is not same-size

- **Severity:** P2
- **Title:** desktop-wrapper.test.ts:285 replaces `'created'` (7 bytes) with `'REPLACED'` (8 bytes) while asserting "exact same byte length"
- **Evidence:** string lengths differ by one byte; the test therefore exercises the size-changed path, not the mandated same-size scenario; combined with P2-REC-001, the true same-size behavior is entirely uncovered.
- **Impact:** false confidence in the mandated data-integrity case.
- **Recommended correction:** use genuinely equal-length strings and add a same-size + same-mtime variant.

### P2-DOC-001 — "Sandboxed" claims survive in code comments and D-005

- **Severity:** P2
- **Title:** bridge.ts:13 / host.ts:17 say "sandboxed"; DECISIONS.md D-005:22-23 claims worker/iframe isolation; F-019 registry entry still names the sanitizer
- **Evidence:** greps at HEAD; contradicts D-019:89 / PLUGIN_ARCHITECTURE.md:61 / F-032 / F-035.
- **Impact:** false confidence for future readers; doc-internal contradiction (audit Part 15).
- **Recommended correction:** s/sandboxed/permission-facade/ in comments; restate D-005 to match D-019; update F-019 mitigation to reference F-035.

### P3 findings (consolidated)

- **P3-FS-001** `write()` drops `hasBom` from its returned snapshot (node-fs-storage.ts:302-309); `readText()` strips BOM via default decode (:175).
- **P3-FS-002** `exists()` swallows `SecurityError` as `false` (node-fs-storage.ts:352-360).
- **P3-FS-003** browser `list()` swallows per-file read errors (:121); `getHandleForPath` maps `NotAllowedError` → `NotFoundError` (:49,62).
- **P3-FS-004** stale build artifacts: `packages/markdown/dist/sanitizer.js` + `dist/__tests__/sanitizer-audit.test.js` still shipped.
- **P3-FS-005** checkpoint writes are not fsynced before rename (desktop-runtime.ts:266-284) — durability of derived state only.
- **P3-UI-001** global keydown (Ctrl+S) effect captures previous render for one frame (App.tsx:161-223) — one-frame stale save target window.
- **P3-UI-002** `extractCitations` accepts `[Source: <path>.md]` tags for paths not in `availableDocs` (retrieval.ts:238-254).
- **P3-UI-003** seed vault content overstates: "Verified zero data-loss safe save pipeline", "Sandboxed Plugin SDK" (useVault.ts:75,132).
- **P3-UI-004** no CSP header/meta (pre-existing S-4 note); 872 kB bundle chunk; sql.js JS bundled but unused by the web app; node-fs code tree-shaken out (latent trap if any future web path imports it).
- **P3-AI-001** provider-switch stale-closure race in the drawer (message clobber, cosmetic; generation token recommended).
- **P3-TEST-001** audit #11 read-only-dir test vacuous on Windows (assertion inside catch); crash-injection test simulates orphan tmp only (no real SIGKILL); disaster-recovery Memory-only 50 notes; preview-security corpus covers 6/18 payloads; watcher tests sleep on real debounce timers.
- **P3-DOC-001** TESTING.md:71-74 mandates 50k/100k synthetic vaults — no harness; AGENTS.md/TESTING.md "100,000 notes" language is a mandate, not a verified claim; D-021 "verified zero-data-loss durability" overstates given P2-FSA-001.

---

## 5. Canonical Data Safety

The Node save path is genuinely strong: temp file + fsync + atomic rename + parent-dir fsync, version/hash conflict enforcement, same-size external modifications detected via hash, orphan tmp cannot corrupt, injected rename/open failures leave the target intact with zero residue, deletion-after-open → ConflictError. The desktop runtime's checkpoint is correctly contained (a failed checkpoint cannot block canonical saves — verified). **Remaining risks:** P1-UI-001 (plugin writes silently target memory), P2-UI-002/003 (web bookkeeping races can silently drop or de-autosave edits), and the honest untested set: real SIGKILL mid-write, disk-full, cross-process file locks (recommended regression tests in the handoff).

## 6. Filesystem Security

Path normalization and all storage call sites are sound (25/25 corpus). **P1-FS-001** breaks the realpath containment boundary via the vault-evil prefix bug (reproduced). TOCTOU (symlink swap between check and write) and hard-link invisibility to `realpath` are documented residual limitations of the current API. Windows drive-case handling is benign via lowercasing; the same lowercasing is a second escape vector on case-sensitive filesystems.

## 7. Browser Runtime

FSA temp+move verified working in Chromium; conflicts/deletion handled. Hardcoded `atomicWrites` (P2-FSA-001), non-atomic `move()`, and zero permanent browser tests are the gaps. Real-browser probing of the preview (18 hostile payloads) was clean; the editor remount-per-tab + ref-callback design is sound (no cross-tab buffer mixing). The useVault bookkeeping races (P2-UI-002/003, P1-UI-001) are the live browser-runtime defects.

## 8. SQLite Persistence/Reconciliation

Persistence is real and verified (restart at 100k = 4.8 s vs 55 s rebuild; corrupted-DB reconstruction; checkpoint atomicity + containment; export measured non-problematic at 50k = 6 ms, 100k = 209 ms). Metadata originates from real fs stats but is smuggled through `(doc as any).modifiedAt/size` (rebuilder.ts:41-42, sqlite-index.ts:351-353) with no type contract — plugin/parity callers store 0. The (size,mtime) fast path (P2-REC-001) is the correctness gap.

## 9. Index/Search Correctness

Memory and SQLite are observably equivalent across add/update/delete/recreate with same-basename folders, ambiguous/relative/embed/heading/alias links; stale links re-resolve identically. Search/backlinks fast. The O(N²) per-upsert re-resolution (P1-IDX-001) is a performance defect, not a correctness one. Link resolution follows D-004.

## 10. Markdown / Rendering Security

Raw HTML is intentionally unsupported and rendered strictly as escaped text; verified through the real preview layer in a real browser (0 dialogs, 0 executable elements, 0 handlers, 0 `javascript:` URLs, entity-encoded/tag-collapse/browser-repair payloads all inert). Zero dangerous DOM APIs in production source; CI ban active. Gaps: no CSP, stale sanitizer dist artifacts, preview corpus not fully promoted.

## 11. AI Boundary

F-028 (divergence abort) and F-029 (path binding) verified; user acceptance is mandatory before any canonical mutation; provider failures isolated (Law 18); secrets never reach retrieval content or the facade (F-005/D-018); stream abort on switch/unmount verified; folder-scope separator boundary correct in both indexes. Residual: unvalidated citation paths (P3).

## 12. Plugin Boundary

Honest classification: **permission facade + capability restriction, same-realm — not process-isolated, not realm-isolated, not a sandbox.** Facade enforcement works (undeclared capabilities denied, manifest deep-frozen, crash containment isolates failing plugins, host survives). Same-realm access (fetch, `Function`→`globalThis`, prototype pollution, `sessionStorage` secrets) remains fully reachable — documented F-032 and acceptable only while plugins are first-party. **P1-UI-001** (context frozen at mount) is a real functional/data-loss bug in the current facade, not a docs issue.

## 13. Performance / Scale

Full-pipeline numbers at HEAD: rebuild 0.62 s/4.76 s/28.2 s/55.1 s and reconcile-from-DB 50 ms/451 ms/2.6 s/4.8 s at 1k/10k/50k/100k — the persistence story scales. Search 17-793 ms, backlinks 2-62 ms. **Two O(N²) pathologies break the story: per-upsert re-resolution (P1-IDX-001) and graph construction (P1-GRAPH-001, 46.3 s @10k)**. Memory 125 MB @100k, DB 307 MB @100k.

## 14. CI / Test Credibility

137/137 tests pass with zero skips, and the promoted hostile suites are real. Credibility gaps: **CI build step red (P1-CI-001)**; no browser test in the permanent suite; same-size test not same-size; vacuous read-only-dir assertion on Windows; crash-injection not a real kill; disaster-recovery Memory-only; preview corpus partial; watcher tests timing-dependent; boundary grep bypassable.

## 15. Documentation Accuracy

The P0 claim-restoration work was done honestly (D-021/D-022 truthful; "sandbox" removed from PLUGIN_ARCHITECTURE; SECURITY.md matches the escaped-text policy). Remaining inaccuracies: D-005 vs D-019 contradiction, "sandboxed" code comments, F-019 stale mitigation, "verified zero-data-loss durability" (D-021), seed-content claims, TESTING.md 50k/100k mandate without a harness, and the GEMINI_REMEDIATION sign-off's false "npm run build 100% green".

## 16. Remaining Release Blockers

P0: none confirmed (P1-FS-001 borders it; escalate if untrusted vaults are ever auto-opened).
P1 (must fix before alpha): P1-FS-001, P1-IDX-001, P1-GRAPH-001 (+ P1-SCALE-001 graph gate), P1-CI-001, P1-UI-001.
P2 (should fix before alpha): P2-REC-001, P2-SEC-001, P2-FSA-001, P2-UI-002, P2-UI-003, P2-CI-002, P2-CI-003, P2-TEST-001, P2-DOC-001.
P3: see consolidated list; non-blocking.

---

## FINAL SCORECARD

```
Canonical File Safety: 7/10          (Node save path solid; plugin-write-to-memory + web bookkeeping races)
Filesystem Boundary Security: 5/10   (P1-FS-001 escape reproduced)
Persistence Reliability: 6/10        (works; fast-path gap, non-atomic secrets, no fsync)
Startup Reconciliation: 7/10         (correct order; (size,mtime) fast-path gap)
Browser Runtime: 5/10                (FSA partial; useVault races; zero browser tests)
Markdown Rendering Security: 9/10    (verified inert live; no CSP, partial corpus)
Index/Search Correctness: 8/10       (parity proven; O(N²) upsert)
Large-Vault Scalability: 4/10        (graph 46.3s@10k; upsert 9.3s@10k; rebuild/reconcile OK)
AI Isolation: 8/10                   (F-028/F-029 verified; citation P3)
Plugin Isolation: 3/10               (facade only; frozen context; same-realm access)
Secret Handling: 7/10                (no default key; fixed salt, non-atomic persistence)
Test Credibility: 6/10               (137 honest; same-size test wrong; no browser tests)
CI Credibility: 3/10                 (build step red; no smoke/benchmark steps)
Documentation Accuracy: 6/10         (restatements good; D-005/comments/seed overclaims)
Public Alpha Readiness: 4/10
```

```
RECOMMENDATION:
FREEZE FEATURE WORK
```

Fix the five P1 findings (in handoff order), re-earn the graph budget, green the CI, then re-audit before any feature phase resumes.
