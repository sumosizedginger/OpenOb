# OpenOb — Gemini Deep Re-Audit Handoff

Source: `DEEP_REAUDIT.md` (full report) — HEAD `72f14b3`, audit pass read/test/analyze only.
This file lists ONLY outstanding findings from the re-audit, ordered by dependency. Already-fixed work is not repeated.

Revision (coordinator review): T4 re-scoped to fix hydration before any graph sampling; T5 re-scoped to define what `build` means rather than adding placeholder scripts; execution order changed to T1-T5 → T6/T9/T10 → remaining P2s → independent re-audit. Also fixed a wording bug in the audit report itself (the executive verdict said "Three P1-class defects" while listing five; it now says five).

---

## T1 · P1-FS-001 — Vault boundary escape (vault-evil prefix bug)

- **Problem:** `resolveToDiskSafe` (node-fs-storage.ts) tests containment with bare case-insensitive `startsWith(root)` — no separator boundary. A junction/symlink inside the vault pointing to a prefix-sharing sibling (e.g. `vault-evil`) escapes: read AND write outside the vault root both succeeded in the reproduction.
- **Evidence:** `PROBE READ: ESCAPE SUCCEEDED -> # SECRET OUTSIDE VAULT`; `PROBE WRITE: ESCAPE SUCCEEDED`; logic check `normEvil.startsWith(normRoot) => true`. Locations: node-fs-storage.ts:52, 63, 73, 77; lowercasing in `normalizeFsPath` :23-29 (case-insensitive check on case-sensitive FS = second variant).
- **Files involved:** `packages/vault/src/node-fs-storage.ts`.
- **Exact required change:** In all three checks use `inside(p, root) = p === root || p.startsWith(root + '/')`; lowercase only on `win32` (POSIX compares case-sensitively). Consider re-`realpath` immediately before the final `rename` (closes part of the TOCTOU window).
- **Architectural constraints:** Keep the containment policy (reject, never rewrite). Do not weaken the traversal rejection in `normalizeVaultPath`.
- **Regression tests:** junction + dir-symlink + (Linux) case-variant symlink to sibling `vault-evil`/`VAULT-EVIL` → `SecurityError` on read and write; benign in-vault links still work; sibling without link still unreachable.
- **Acceptance criteria:** all three probes throw `SecurityError`; the reproduction from this audit fails.
- **Dependencies:** none.
- **What not to do:** Do not just document it; do not remove the realpath check; do not change `normalizeVaultPath` semantics.

## T2 · P1-UI-001 — Plugin API context frozen at mount (silent plugin-write loss)

- **Problem:** `PluginHost` is created in a `useState` initializer (App.tsx:101-128) with mount-time context; `updateContext` replaces the context object (host.ts:29-31) while `createPluginAPI` captured the OLD object by reference at enable time (bridge.ts:17, host.ts:64-69). Enabled plugins permanently write to the mount-time `MemoryVaultStorage` — plugin-created notes never reach disk and vanish on reload.
- **Evidence:** code trace (subagent file:line analysis of App.tsx/useVault.ts/host.ts/bridge.ts); the update effect App.tsx:131-137 is dead for enabled plugins.
- **Files involved:** `apps/web/src/App.tsx`, `packages/plugin/src/host.ts`, `packages/plugin/src/bridge.ts`.
- **Exact required change:** Hold a mutable context holder (e.g., a single object whose fields are updated in place) so bridge closures observe fresh `storage`/`openNote`/`activeNotePath`; or re-enable plugins after every context update; verify `api.vault.write` hits the live storage after a vault switch.
- **Architectural constraints:** `PluginAPI` surface unchanged; Constitution Law 20 unchanged; do not add ambient access.
- **Regression tests:** host-level — enable with context A, `updateContext(B)`, plugin `vault.write` lands in B's storage; app-level — open real vault, run a first-party plugin write, assert the file exists on disk after reload.
- **Acceptance criteria:** plugin writes persist to the user's real vault; no plugin context is ever mount-time-frozen.
- **Dependencies:** none.
- **What not to do:** Do not give plugins a backdoor to the real storage; do not add the worker boundary in this task.

## T3 · P1-IDX-001 — O(N²) per-upsert full-vault link re-resolution

- **Problem:** every `upsert()`/`remove()` calls `getAll()` + `refreshLinkTargets(allDocs)` (sqlite-index.ts:281-283, 302-304). Measured: single upsert 1.13 s @5k, 4.7-9.3 s @10k (full rebuild of 10k = 280 ms).
- **Evidence:** benchmark runs (scaling curve 5k/10k; two-link corpus 9.3 s @10k). Watcher events and startup reconcile call upsert per file. Compounding factor: `getAll()` hydrates each document with FIVE separate prepared queries (links, headings, tags, properties, aliases — sqlite-index.ts:457-520), so every upsert/remove pays an N+1 query pattern over the whole vault (~50k queries per edit at 10k).
- **Files involved:** `packages/index/src/sqlite-index.ts` (+ `desktop-runtime.ts` reconcile loop if batching is chosen).
- **Exact required change:** Incremental target refresh: index links by `target_path`/`target_name`, re-resolve only links affected by the changed/removed path; or batch the reconcile path into one re-resolve pass after all upserts. Keep Memory/SQLite parity (both must still produce identical observable behavior).
- **Architectural constraints:** D-013 parity; D-004 resolver unchanged; derived state stays disposable.
- **Regression tests:** time-bound single-upsert budget at 10k (< 500 ms); parity suite still passes (add/update/delete/recreate/backlinks).
- **Acceptance criteria:** single upsert at 10k < 500 ms; parity tests green.
- **Dependencies:** none.
- **What not to do:** Do not remove link re-resolution; do not weaken the delete case (stale target cleanup must still happen).

## T4 · P1-GRAPH-001 — Graph construction superlinear (fails P1-SCALE-001 gate)

- **Problem:** `buildGraphData` 578 ms @1k → 46.3 s @10k (80× for 10× data); the Wave-3 gate "graph < 10 s @10k" FAILS at HEAD (previous audit measured 9.2 s; HEAD is 5× worse).
- **Evidence:** full-pipeline benchmark (BENCH rows n=1000/n=10000). Profile finding (coordinator review, code-verified): `buildGraphData` obtains all documents via `index.getAll()` (graph.ts:18) and `getAll()` hydrates each doc with 5 separate queries (N+1, sqlite-index.ts:457-520) — so the 46.3 s is dominated by hydration, not edge math. The `LinkResolver` already caches its path/basename/alias maps per docs array (link-resolver.ts:18-26), so repeated resolves over the same array are cheap.
- **Files involved:** `packages/index/src/sqlite-index.ts` (getAll/hydrateDocument), `packages/index/src/graph.ts` (+ harness `tests/integrity/scale-benchmark.test.ts`).
- **Exact required change (order matters):** (1) PROFILE the 46 s first and confirm the hydration share. (2) Attack the hydration: batch-load links/headings/tags/properties/aliases for all documents in a small number of grouped queries (or add a dedicated lightweight graph projection query that returns only path/title/links — graph does not need bodies/properties/aliases). (3) Re-measure at 10k. (4) ONLY if the fully correct graph is still intrinsically too large (edge explosion, not hydration), introduce bounded construction (edge cap / sampled neighbors per D-015) with the cap documented and visible.
- **Architectural constraints:** graph consumes index only (Law 21); provenance edges preserved; the graph must remain correct — speed must not come from silently dropping edges.
- **Regression tests:** time-bound graph build @10k < 10 s in the scale harness; wire the harness into CI (opt-in flag as designed) and add a 50k run.
- **Acceptance criteria:** graph @10k < 10 s with the FULL edge set (no sampling unless documented); harness runs in CI; P1-SCALE-001 gate re-earned or 100k wording stays removed.
- **Dependencies:** T3 (both flow through `getAll()`; fix hydration once and both paths benefit — coordinate the batch-load work so it is not done twice).
- **What not to do:** Do NOT start with edge capping/sampling — that makes OpenOb fast by making the graph incomplete. Do not move graph to a separate parser (Law 21). Do not add a second hydration path that duplicates T3's batch loader.

## T5 · P1-CI-001 — CI build step red at HEAD

- **Problem:** `npm run build` fails on a fresh checkout (7 library workspaces lack a `build` script); ci.yml:43-44 runs it as the final gate. GEMINI_REMEDIATION's "npm run build 100% green" is false for the root gate.
- **Evidence:** baseline run: BUILD_EXIT=1, "Missing script: build" for packages/ai, core, desktop, index, markdown, plugin, vault; web workspace itself builds (3.07 s).
- **Files involved:** `package.json` (root), 7 workspace `package.json`s, `.github/workflows/ci.yml`.
- **Exact required change (decide what `build` means FIRST):**
  - If the library workspaces are source-only packages consumed directly by Vite/tsc (the current reality — `main`/`exports` point at `./src/index.ts` and the web app compiles their TS in-bundle), then the honest root production build is: web app build + `tsc --build` (typecheck) — change the root script to run those two, and adjust the CI step accordingly. Do not add per-workspace scripts for the sake of it.
  - If the libraries are intended to become separately distributable packages, give them legitimate compilation outputs (real `build` scripts emitting `dist` with `.d.ts`) as a deliberate, documented decision.
  - Either way: verify the workflow passes on a fresh clone (npm ci → typecheck → test → build) and that the root script name still means what it claims.
- **Architectural constraints:** none beyond keeping the root gate honest.
- **Regression tests:** the CI job itself; locally `npm ci && npm run build` exit 0.
- **Acceptance criteria:** green workflow on a fresh clone; root `npm run build` exit 0 and the script reflects a real build decision.
- **Dependencies:** none.
- **What not to do:** Do NOT create seven placeholder/`echo`-style build scripts just to make CI green; do not delete the build step; do not rename scripts to hide the failure; do not silently change library distribution intent without a DECISIONS.md entry.

## T6 · P2-REC-001 — Reconciliation (size,mtime) fast path can silently skip changes

- **Problem:** desktop-runtime.ts:173-174 skips files whose `size` and `modifiedAt` match the manifest without reading them. Same-size content changes with preserved/coarse mtime (FAT/exFAT 2 s resolution; rsync -t / OneDrive / Dropbox) are silently never detected. Not reproducible on this NTFS host (sub-ms `mtimeMs` makes Date-based restore differ), so this is a cross-platform correctness gap, not a local repro.
- **Files involved:** `packages/desktop/src/desktop-runtime.ts` (reconcile).
- **Exact required change:** when `size` matches, verify content hash before skipping (or gate the skip on mtime resolution); document the tradeoff in the code.
- **Regression tests:** mock stat so (size,mtime) equal but content differs → assert re-read + upsert.
- **Acceptance criteria:** no silent stale-state path for same-size changes on coarse-timestamp filesystems.
- **Dependencies:** T3 (reconcile shares the upsert path).
- **What not to do:** Do not drop the fast path entirely without measuring startup impact at 100k.

## T7 · P2-SEC-001 — Secret-store hardening (fixed salt, non-atomic persistence, silent failure)

- **Problem:** fixed salt `'okw-desktop-key-salt-v1'` (secure-storage.ts:30) enables offline precomputation and cross-install ciphertext correlation; `persistToDisk` is a plain `writeFileSync` (:132) — a crash can corrupt `secrets.json`; `loadFromDisk` (:99-116) swallows corrupt/wrong-passphrase errors, so failure is indistinguishable from "no secrets".
- **Files involved:** `packages/desktop/src/secure-storage.ts`.
- **Exact required change:** random per-file salt stored beside the ciphertext; Argon2id (or ≥600k PBKDF2 iterations); atomic temp+rename for `secrets.json`; surface decrypt failures (wrong passphrase vs corrupt file) to the UI; serialize concurrent `setSecret`.
- **Architectural constraints:** `SecretStore` interface unchanged; desktop-runtime fail-closed wiring unchanged.
- **Regression tests:** corrupt `secrets.json` → explicit error surfaced; wrong passphrase → explicit auth error (not empty store); concurrent `setSecret` calls serialize.
- **Acceptance criteria:** no source-derivable key material; no silent secret loss; clear failure signals.
- **Dependencies:** none.
- **What not to do:** Do not store the salt in code; do not log secrets or keys.

## T8 · P2-FSA-001 — `atomicWrites` flag honest + fallback notice

- **Problem:** browser-fsa-storage.ts:126 hardcodes `atomicWrites: true` while the no-`move()` fallback (:220-229) is a direct truncate-write with no notice. `move()` itself (:302-312) is read→write→remove (non-atomic).
- **Files involved:** `packages/vault/src/browser-fsa-storage.ts`.
- **Exact required change:** derive `atomicWrites` from capability detection; warn in the fallback; document `move()` semantics.
- **Regression tests:** simulated no-`move()` environment → `atomicWrites === false` + notice; failure mid-fallback leaves original intact.
- **Acceptance criteria:** the browser path either provides atomicity or explicitly reports it does not (P1-BROWSER-001 acceptance, finally met).
- **Dependencies:** none.
- **What not to do:** Do not remove the temp+move path.

## T9 · P2-UI-002 — `saveActiveNote` post-save bookkeeping races

- **Problem:** useVault.ts:345-359 — typing during an in-flight save de-dirties the captured tab and cancels the pending autosave (edits silently never autosaved; Ctrl+S recovers); a tab switch during the save writes `parsedDoc`/`backlinks`/`saveStatus('saved')` for the old tab, masking the new tab's unsaved edits.
- **Files involved:** `apps/web/src/hooks/useVault.ts`.
- **Exact required change:** clear `isDirty` only when the current buffer equals the saved content; guard post-save bookkeeping with a per-tab generation token.
- **Regression tests:** slowed `safeSave` + typing during it → `isDirty` stays true, autosave fires with new content; tab switch during save → no stale status/preview.
- **Acceptance criteria:** no silent edit loss on close; status bar always reflects the active tab.
- **Dependencies:** none.
- **What not to do:** Do not remove autosave; do not make save synchronous.

## T10 · P2-UI-003 — Wholesale `setOpenTabs` stale-array clobber

- **Problem:** `updateNoteProperty` (useVault.ts:532-552) and `applyAIProposedEdit` (:604-627) mutate a captured tab and call `setOpenTabs([...openTabs])` with the render-time array; concurrent keystrokes in other tabs are dropped from state; the AI divergence check runs before the await.
- **Files involved:** `apps/web/src/hooks/useVault.ts`.
- **Exact required change:** functional updates (`setOpenTabs(prev => …)` keyed by path); re-check divergence after the await in `applyAIProposedEdit`.
- **Regression tests:** concurrent keystroke in tab B during property/AI update in tab A → both buffers survive; F-028 divergence still aborts.
- **Acceptance criteria:** no keystroke burst lost; AI proposals still refuse stale application.
- **Dependencies:** none.
- **What not to do:** Do not bypass SafeWriter/version checks to 'fix' the race.

## T11 · P2-CI-002 / P2-CI-003 — Browser smoke test + benchmark wiring

- **Problem:** no Playwright/browser step in CI (promised by P2-CI-001); `tests/integrity/scale-benchmark.test.ts` never invoked.
- **Files involved:** `.github/workflows/ci.yml`.
- **Exact required change:** add a Playwright job (open vault → edit → save → reload → verify content; hostile-payload preview smoke) and a benchmark job (1k/10k/50k, 100k time-boxed) with the `--run` opt-in.
- **Acceptance criteria:** browser regressions and scale regressions fail CI.
- **Dependencies:** T4 (benchmark includes graph), T5 (CI must be green first).
- **What not to do:** Do not make the default `npm test` slow.

## T12 · P2-TEST-001 — True same-size regression

- **Problem:** desktop-wrapper.test.ts:285 replaces `'created'` (7 B) with `'REPLACED'` (8 B) while claiming "exact same byte length"; the mandated same-size case is uncovered.
- **Files involved:** `tests/integrity/desktop-wrapper.test.ts`.
- **Exact required change:** use genuinely equal-length strings; add a same-size + same-mtime variant (works with T6's test).
- **Acceptance criteria:** the test fails if the index misses a same-size change.
- **Dependencies:** T6.
- **What not to do:** Do not weaken other assertions.

## T13 · P2-DOC-001 — Remove surviving "sandboxed" claims

- **Problem:** bridge.ts:13 / host.ts:17 comments say "sandboxed"; DECISIONS.md D-005:22-23 claims worker/iframe isolation (contradicts D-019:89); FAILURE_REGISTRY F-019 mitigation still names the sanitizer (contradicts F-035).
- **Files involved:** `packages/plugin/src/bridge.ts`, `packages/plugin/src/host.ts`, `DECISIONS.md` (+ `docs/DECISIONS.md` mirror), `FAILURE_REGISTRY.md`.
- **Exact required change:** s/sandboxed/permission facade/; restate D-005 to match D-019; update F-019 mitigation to reference F-035.
- **Acceptance criteria:** no doc or comment claims isolation the code does not provide.
- **Dependencies:** none.
- **What not to do:** Do not touch the actual plugin boundary in this task (that is the separate worker-boundary roadmap item).

## P3 backlog (do after P1/P2; grouped)

- FS: `write()` snapshot `hasBom`; `readText()` BOM; `exists()` swallowing `SecurityError`; browser `list()`/`getHandleForPath` error masking; stale `dist/sanitizer.*` artifacts; checkpoint fsync.
- UI: Ctrl+S one-frame stale window; unvalidated citation paths; seed-content overclaims; no CSP; bundle hygiene (872 kB, unused sql.js, node-fs latent trap).
- Tests: vacuous read-only-dir assertion; real SIGKILL crash test; disk-full/lock probes; promote full 18-payload preview corpus; watcher test timing.

---

```
NEXT ACTION FOR GEMINI:
Fix only the outstanding findings in this handoff.
Do not begin new roadmap features until all P0/P1 findings pass independent re-audit.
```

Execution order (coordinator-approved):

1. **P1 set — T1 → T2 → T3 → T4 → T5.** T3 before T4 (T4 profiles/measures from the fixed index and shares T3's `getAll()` batch-load work — coordinate so hydration is fixed once). T11 waits for T5 (CI must be green first).
2. **Correctness/data-integrity-adjacent P2s — T6 → T9 → T10** (reconciliation freshness, save-state races: silent edit loss concerns) — before remaining P2s.
3. **Remaining P2s — T7 → T8 → T12 → T13** (secrets hardening, FSA flag, same-size test, doc claims; T12 pairs with T6's regression work).
4. **Independent re-audit:** send DeepSeek back in one more time after the P1 set and the P2 correctness group. Re-run: `npm run build` green, `npm test` green with the new regression tests, hostile-path corpus, live-DOM preview probe, 10k upsert (< 500 ms) and graph (< 10 s) budgets, and the plugin-vault-write persistence check.
5. **Unfreeze condition (coordinator):** only when the re-audit returns no P0/P1 AND the performance gates actually hold. Then — and only then — resume roadmap feature work.
