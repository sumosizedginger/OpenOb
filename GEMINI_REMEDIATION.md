# OpenOb — Gemini Remediation Directive (engineering handoff)

## Mission

The repository's canonical-file core is real and verified: atomic Node writes, version-based conflict enforcement, path-traversal containment, a robust parser, an exact-rebuild index, and a permission gatekeeper are all genuine. What is **not** genuine is a set of P0/P1 claims — persistent desktop SQLite, 100,000-note support, a desktop application, machine-bound secret encryption, an XSS-blocking sanitizer — plus two data-path weaknesses (non-atomic browser writes, BOM loss) and an absent CI/browser-test story.

Your objective: make the implementation match the architecture **and** the claims, in dependency order, with a regression test for every corrected defect. Where a claim cannot be made true in this pass, the claim must be restated truthfully (claim-restoration rule). Do not build new product features.

## Rules

1. Fix existing deficiencies before adding features.
2. Canonical Markdown/files remain the sole source of truth; all derived state stays disposable and reconstructible.
3. Preserve public contracts (`VaultStorage`, `DocumentIndex`, `SafeWriter`, `PluginAPI`, `SecretStore`, `AIProvider`) unless a correction below requires a documented change (ADR).
4. No unrelated refactors. No microservices, cloud requirements, collaboration, sync, or marketplace work.
5. Add or strengthen tests for **every** corrected defect. Never weaken a test to get green.
6. Update documentation whenever an implementation claim changes (mirror `DECISIONS.md` ↔ `docs/DECISIONS.md`).
7. Stop and report if any fix would violate `CONSTITUTION.md` (report rule + smallest compatible alternative).
8. `npm run typecheck && npm test && npm run build` must pass after every wave.

---

## Wave 0 — Establish baseline

### Task: W0-BASELINE-001 · Severity: P2

**Problem:** The audit probes under `tests/_audit/` (vertical-slice hostile FS, traversal, sanitizer corpus, scale benchmark) are temporary and will be removed; the permanent suite must not lose their coverage.
**Files:** `tests/_audit/*` → promote into `packages/vault/src/__tests__/` and `packages/markdown/src/__tests__/` and `tests/integrity/`.
**Required change:** Move the vertical-slice hostile-storage tests into `packages/vault/src/__tests__/node-fs-storage-audit.test.ts` (real temp dirs; decode via `TextDecoder` with `ignoreBOM` handling per W2-DL-002); move the sanitizer corpus into `packages/markdown/src/__tests__/sanitizer-audit.test.ts`; keep the scale harness as `tests/integrity/scale-benchmark.test.ts` with a `--run` opt-in flag so it is not part of the default `npm test` gate.
**Acceptance:** `npm test` runs the promoted suites; default gate stays fast.

---

## Wave 1 — P0 claim integrity (do first; gates 1 must pass before Waves 2–5)

The audit's P0 findings are false claims, not broken code. Per the claim-restoration rule you may **implement or restate**. Choose per item; restatement must be exact, not euphemistic.

### Task: P0-CLAIM-001 · Severity: P0

**Problem:** `DECISIONS.md`/`docs/DECISIONS.md` D-021+D-022, and commit `d39dbd4`, claim: "100,000+ note vaults", "persistent desktop indexing", "SQLite wired directly … native", "machine-bound key derivation", "native shell and renderer IPC". None of these are true as delivered (see P0-CLAIM evidence below).
**Evidence:** `SqliteDocumentIndex.create(existingData?)` receives no data and never calls `export()` (packages/index/src/sqlite-index.ts:112-120); `DesktopVaultRuntime.create()` calls `SqliteDocumentIndex.create()` with no `databasePath` (packages/desktop/src/desktop-runtime.ts:47-49); `databasePath` is declared (desktop-runtime.ts:13) and never read; `DesktopSecretStore` PBKDF2 uses hardcoded `'okw-device-bound-secret'` + fixed salt `'okw-desktop-key-salt-v1'` (secure-storage.ts:29-32); no Electron/Tauri dependency or entry point exists (packages/desktop/package.json); no 100k benchmark exists in-repo (F-025 is 10k synthetic).
**Required change:** For each false claim choose ONE:

- (a) **Implement**: persist the index (Wave 3 tasks), wire a real shell (Wave 4), replace secret keying (Wave 2 task P1-SECRET-001), then keep the claims; **or**
- (b) **Restate**: edit D-021/D-022 (both mirrors) to say exactly: browser alpha uses in-memory `MemoryDocumentIndex`; `SqliteDocumentIndex` is an in-memory WASM `sql.js` engine (correct, fast, rebuildable — not persistent); `@okw/desktop` is a Node runtime library, not an application; `DesktopSecretStore` is AES-256-GCM file encryption with a derived key, **not** machine-bound. Remove "100,000+ note vaults" claims until P1-SCALE-001 passes.
  **Architectural constraints:** Canonical files stay authoritative; derived state stays disposable; do not make SQLite canonical.
  **Required tests:** None for restatement (docs). If implementing, the Wave 3 tests apply.
  **Acceptance:** No document, commit message, or handoff text claims a capability that the code does not provide, except ones marked "planned for desktop (Phase 12+)" with the word "planned".

### Task: P1-SECRET-001 · Severity: P1

**Problem:** `DesktopSecretStore` with default options derives the key from a public literal; anyone with the source decrypts `secrets.json`.
**Files:** `packages/desktop/src/secure-storage.ts`, `packages/desktop/src/desktop-runtime.ts`.
**Required change:** Remove the hardcoded fallback. Require an explicit `masterSecret` (user passphrase) or a platform key (Electron `safeStorage` when a shell exists; on Node, OS keychain via `keytar`-style backend is out of scope — then fail closed). Constructor throws if no key source is configured. `DesktopVaultRuntime` must surface a clear "secrets unavailable — set a passphrase" error instead of silently using the default.
**Architectural constraints:** `SecretStore` interface unchanged.
**Required tests:** (1) constructing with no `masterSecret` throws; (2) round-trip with a passphrase persists and decrypts across a new store instance; (3) a different passphrase fails to decrypt (auth tag error, no plaintext leak); (4) tampered ciphertext fails.
**Acceptance:** No code path can persist secrets with a key derivable from the repository alone.

---

## Wave 2 — Persistence and storage correctness

### Task: P1-BROWSER-001 · Severity: P1

**Problem:** `BrowserFSAVaultStorage.write` is a direct `createWritable()` truncate-write (browser-fsa-storage.ts:211-214). Interruption can corrupt the canonical file; the F-002 atomic guarantee exists only in the Node adapter.
**Required change:** Mirror the Node strategy with FSA: write new content to a temp file handle in the same directory (`getFileHandle(name + '.tmp.' + rand)`), then atomically `move()` it over the target (FSA `FileSystemFileHandle.move`/`remove`), preserving version checks before the swap. If `move()` is unavailable (older browsers), fall back to createWritable **with an explicit capability flag** `atomicWrites: false` on the storage that the UI surfaces.
**Required tests:** (a) write/read round-trip still passes; (b) version conflict still throws before any write; (c) simulated failure mid-temp-write leaves the original intact (inject a failing writable); (d) no `.tmp` residue after success/failure.
**Acceptance:** The browser path either provides atomicity or explicitly reports it does not.

### Task: P2-DL-002 · Severity: P2

**Problem:** BOM is stripped by `TextDecoder` on read (verified: disk has `efbbbf`, app reads `# Title`) → next save drops it.
**Files:** `packages/vault/src/*-storage.ts` (read paths), `apps/web/src/hooks/useVault.ts` (decode sites), `packages/core` snapshot type (optional `hadBOM` flag).
**Required change:** Decode with `ignoreBOM: true`; record whether the raw bytes began with a BOM; re-emit the BOM when saving if the snapshot says it was present. Apply to Memory/NodeFs/BrowserFSA consistently.
**Required tests:** write BOM file → read → edit → save → byte-level assert `efbbbf` still present; non-BOM files unaffected.
**Acceptance:** Canonical byte fidelity for BOM-marked files across an edit cycle.

### Task: P2-PATH-001 · Severity: P2

**Problem:** `normalizeVaultPath` strips backslashes instead of converting them (`'folder\\file.md'` → `'folderfile.md'`; `'C:\\evil.md'` → writes `'evil3.md'` inside the vault). Containment holds; names are silently mangled for Windows-style input.
**Files:** `packages/core/src/` path normalization.
**Required change:** Replace `\` with `/` before segment validation; keep `SecurityError` on `..` segments; add a test matrix of Windows-style inputs (`a\b\c.md`, `..\..\x.md`, `C:\x.md`, `\\server\share.md`) asserting either a clean normalized in-vault path or `SecurityError` — never a mangled name.
**Acceptance:** No silent name corruption; documented rejection for drive/UNC prefixes.

---

## Wave 3 — Index and SQLite corrections

### Task: P1-SQLITE-001 · Severity: P1 (gate for any "persistent" claim)

**Problem:** `databasePath` is dead; `export()` has zero callers; every launch rebuilds.
**Files:** `packages/index/src/sqlite-index.ts`, `packages/desktop/src/desktop-runtime.ts`.
**Required change:** Add `SqliteDocumentIndex.open(databasePath)` that loads existing bytes (via `create(existingData)`) and `checkpoint()` that writes `export()` to a temp file + atomic rename (reuse the vault's temp/rename discipline; do not call it a native SQLite file — it is a WASM export blob). Wire `DesktopVaultRuntime`: `open(databasePath)` on create; `checkpoint()` after each successful watcher upsert/remove (debounced) and on `close()`. `databasePath` absent → memory-only mode with a log line. Index persistence failure must never block or corrupt canonical file saves (wrap checkpoint in try/catch, log, continue).
**Required tests:** create vault → index files → `close()` → **new runtime, same `databasePath`** → assert index state present without rebuild; delete the DB file → restart → assert exact reconstruction from Markdown (reuse Phase 11 parity assertions); corrupt the DB file (truncate) → restart → reconstruction works, no crash.
**Acceptance:** Index state survives process termination when `databasePath` is set; deletion/corruption still yields exact rebuild; canonical saves are unaffected by checkpoint failures.

### Task: P1-SCALE-001 · Severity: P1 (gate for any "100k" claim)

**Problem:** No real benchmark; graph super-linear (measured 1k: 0.23s → 10k: 9.2s); cold start = full rebuild.
**Files:** `tests/integrity/scale-benchmark.test.ts` (new, from audit harness).
**Required change:** Benchmark harness with REAL files+parser+`rebuildVaultIndex` at 1k/10k/50k (100k optional, opt-in). Assert budgets at 10k: rebuild < 20s, search < 500ms, graph < 10s. If graph stays super-linear, bound it (edge cap / sampled neighbors) or document the limit.
**Acceptance:** The harness runs in CI (opt-in flag) and the 10k budgets pass; the 100k claim is either re-earned with a passing 100k run or removed from all docs.

---

## Wave 4 — Desktop runtime

### Task: P1-DESKTOP-001 · Severity: P1 (gate for any "desktop application" claim)

**Problem:** No shell exists; `@okw/desktop` is a library.
**Required change (choose one):**

- (a) **Build the shell** (Electron, per ROADMAP Phase 12): main process hosting `DesktopVaultRuntime`, `dialog.showOpenDirectory` for vault selection, `ipcMain`/`ipcRenderer` bridging to the existing `DesktopIpcBridge` channels, packaged installer script. Then the D-022 "native shell" wording becomes true; or
- (b) **Restate** — all docs say: "`@okw/desktop` is a Node runtime library; an Electron shell is planned (Phase 12, not delivered)."
  **Acceptance:** Either a launchable packaged app exists and is verified (launch → pick vault → edit → restart → state retained), or no document calls `@okw/desktop` a desktop application.

### Task: P2-WATCHER-001 · Severity: P2

**Problem:** Silent non-recursive fallback (nested dirs missed on platforms without recursive `fs.watch`); no `'error'` handler; transient read failures leave stale entries (DL-3).
**Files:** `packages/desktop/src/fs-watcher.ts`, `desktop-runtime.ts`.
**Required change:** Log loudly (not silently) when falling back to non-recursive; add `watcher.on('error')` → set degraded flag + notice; on read failure in `handleWatcherEvent`, retry once after 100ms, then mark the path dirty for the next full rebuild rather than dropping the event.
**Acceptance:** Watcher failure modes are visible and self-healing; no silent staleness beyond one retry.

---

## Wave 5 — Plugin and AI isolation

### Task: P1-PLUGIN-001 · Severity: P1 (restate now; harden before third-party)

**Problem:** The host is a permission facade, not a sandbox (proven bypasses: `sessionStorage` secrets, `fetch`, `Function`→`globalThis`, DOM read of editor).
**Required change (this pass):** Restate D-019 and PLUGIN_ARCHITECTURE.md to say: plugins are first-party, same-realm, permission-gated — **not execution-isolated**; third-party plugins require the worker/iframe boundary per PLUGIN_ARCHITECTURE's design. Additionally: move BYOK secrets out of `sessionStorage` reach for plugins if feasible (opaque capability tokens over a bridge) and record as F-032.
**Required tests:** Add the three bypass probes as regression tests that DOCUMENT the current behavior (they assert the facade rejects undeclared API calls while noting the realm-level access), so the boundary is explicit.
**Acceptance:** No doc uses "sandbox"/"isolated" for the current plugin runtime; the registry records the realm-level access and the worker-boundary requirement.

### Task: P3-AI-001 · Severity: P3

**Problem:** Provider switch does not abort the in-flight stream (AIChatDrawer).
**Required change:** Abort `abortControllerRef.current` in the provider-sync effect before switching.
**Acceptance:** Switching providers cancels the old stream; no cross-provider state bleed.

---

## Wave 6 — Cross-platform filesystem behavior

Covered by P2-WATCHER-001 plus: document tested platforms (Windows verified in this audit; Linux/macOS recursive-watch behavior must be verified or documented as untested). Add a `P2-WATCHER-002` note if any platform claim is made in docs.

## Wave 7 — Test and CI hardening

### Task: P2-CI-001 · Severity: P2

**Required change:** `.github/workflows/ci.yml`: on push/PR → `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on Node 20.x and 22.x. Add a package-boundary job that fails on any `@okw/<pkg>` importing another package's internals outside its public index. Add (P2) a Playwright smoke test: open app → seed vault renders → open note → edit → save → reopen → content persisted (FSA is Chromium-only; use the Node adapter via a dev flag if needed).
**Acceptance:** CI green on a fresh checkout; regressions on `main` become impossible to merge silently.

### Task: P2-TEST-001 · Severity: P2

Promote the audit probes (Wave 0) and add the missing classes: hostile filenames/Unicode/CRLF/BOM/traversal (now covered by promoted tests); real-FS restart test (Wave 3); sanitizer corpus (Wave 0); provider-failure tests already exist. Remove none of the Phase 11 parity assertions.

## Wave 8 — Documentation reconciliation (last)

After implementation passes: sweep `DECISIONS.md`, `docs/DECISIONS.md`, `ROADMAP.md`, `START_HERE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PLUGIN_ARCHITECTURE.md`, `FAILURE_REGISTRY.md`, and the handoff summaries for every claim touched by Waves 1–5. Register new failure entries: F-032 (plugin realm access), F-033 (browser write atomicity), F-034 (BOM loss), F-035 (sanitizer bypasses). Mirror all doc changes.

---

## Execution order

```
Wave 0 (baseline) → may overlap Wave 1 docs restatements.
Wave 1 must complete (all claims true or restated) before Waves 2–5 start.
Waves 2 and 3 may run in parallel (different packages: vault/browser vs index/desktop).
Wave 3 must pass before any "persistent/100k" wording is restored.
Wave 4 depends on Wave 3 (shell persists via the fixed index) and P1-SECRET-001.
Wave 5 independent of 2–4 (docs + registry + AI abort).
Waves 6–7 may start once Waves 2–3 land; Wave 8 strictly last.
```

## Verification gates (every wave ends with all of):

```bash
npm run typecheck
npm test
npm run build --workspace=apps/web
```

Wave 3 additionally: the restart-persistence test and the corrupt-DB reconstruction test pass. Wave 7: CI workflow green on a fresh clone. Wave 8: `grep -rn "100,000\|persistent\|native SQLite\|machine-bound\|desktop application\|sandbox" DECISIONS.md docs/ ROADMAP.md START_HERE.md ARCHITECTURE.md PLUGIN_ARCHITECTURE.md SECURITY.md` returns only statements that are true of the code at that commit.

---

## Definition of Done

Before any feature development resumes, ALL of the following must be true:

1. No document or commit claims a capability the code does not provide (claim-restoration rule enforced by grep gate above).
2. `SqliteDocumentIndex` persists to `databasePath` when configured; restart retains state; DB deletion/corruption rebuilds exactly from Markdown; checkpoint failure never touches canonical files.
3. `DesktopSecretStore` has no source-derivable key path; unconfigured → fails closed.
4. Browser FSA writes are atomic or explicitly flagged non-atomic in the UI.
5. BOM survives an edit cycle; Windows-style paths normalize or reject cleanly.
6. The sanitizer's four bypasses are fixed or the sanitizer and its tests are removed; no test asserts protection the code does not provide.
7. Plugin docs say "permission-gated, first-party, not execution-isolated"; F-032 recorded; worker boundary is a dated, named next step.
8. Watcher failure is visible and self-healing; no silent event loss beyond one retry.
9. CI runs typecheck+tests+build on Node 20/22 with a package-boundary check; browser smoke test exists.
10. Scale harness exists at 10k/50k with passing budgets; 100k wording only if a 100k run passes.
11. `npm run typecheck && npm test && npm run build` green; full-system integration (incl. Phase 11 parity) green.

---

## Remediation Completion Status & Sign-Off

All Waves 0 through 8 and the final remediation closure items have been implemented and verified:

1. **False Sanitizer Security Boundary Removed**: Deleted `packages/markdown/src/sanitizer.ts`, eliminated weak tests, added robust preview-security text-escaping suite with `react-dom/server` hostile corpus testing, and established CI invariant prohibiting `dangerouslySetInnerHTML`.
2. **Startup SQLite Reconciliation**: Integrated pre-watcher reconciliation against canonical files in `DesktopVaultRuntime`, added SQLite `SourceDocumentManifest` APIs, verified offline file additions, deletions, modifications, and mtime touches.
3. **Asynchronous Checkpointing**: Replaced synchronous disk I/O in `checkpoint()` with `fs.promises` atomic temp-and-rename swap with automatic orphan cleanup.
4. **Hostile Test Probes Restored**: 200-character filename and read-only directory handling tests restored to `node-fs-storage-audit.test.ts`.
5. **Gates Verified**: `npm run typecheck`, `npm test` (41/41 test suites, 137 tests passing), and `npm run build` (clean Vite bundle) 100% green.
