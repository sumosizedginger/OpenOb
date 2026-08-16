# OpenOb — Adversarial Implementation Audit Report

Repository: `https://github.com/sumosizedginger/OpenOb`
Branch: `main` · HEAD audited: `d39dbd4` (feat phase-12) · Local checkout: 114/114 tests, typecheck 0 errors, clean build

Audit method: read-only investigation of every phase's claims against actual code, plus executed empirical probes (real-filesystem persistence tests, hostile path/traversal attempts, parser and sanitizer attack corpus, 1k–100k-note scale benchmarks). No production code was modified. Probe harnesses live under `tests/_audit/` (temporary; see Wave 0).

---

## 1. Executive verdict

**The vertical slice works and the canonical-file core is genuinely solid — but the repository's documentation and Phase 12 claims materially overstate what is implemented, and several P0/P1 claim-integrity and data-path defects must be resolved before the "public alpha" label is earned.**

What is real: a verified crash-safe Node filesystem write path (temp + fsync + atomic rename + parent-dir fsync), strict version-based conflict enforcement, path-traversal containment, a robust markdown parser, a working permission-gated (though not sandboxed) plugin host, AI proposal mutation with divergence abort, and a fast in-memory/WASM index engine that rebuilds exactly from canonical Markdown.

What is not real (as claimed): persistent desktop SQLite indexing, a desktop application/shell, machine-bound secret encryption, verified 100,000-note support, and a sanitizer that blocks the XSS vectors its own tests claim to prove.

**RECOMMENDATION: CONTINUE AFTER FIXES.** The repair scope is bounded and mostly consists of making claims true, removing false confidence, and hardening two data paths (browser writes, index persistence). Do not begin new roadmap phases (13+) until Waves 1–4 complete.

---

## 2. What is genuinely working (verified by execution)

| Area                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node canonical-file safety   | 14/14 hostile probes passed: write→close→reopen exact round-trip; Unicode/emoji/space/apostrophe filenames; CRLF and LF byte-exact; BOM preserved at byte level (`efbbbf` on disk); empty/nested/5MB files; stale-version write → `ConflictError`, disk unchanged; delete-then-write → `ConflictError`; 100 rapid sequential saves consistent; file+folder move; read-only-dir failure is a clean `StorageError`; 200-char filename; **no hostile path escaped the vault root** (forward-slash and dot-dot forms throw `SecurityError`; Windows forms land inside as mangled names) |
| Atomic write implementation  | `NodeFsVaultStorage.write`: temp file + `fsync` + `fs.rename` + parent-dir `fsync` (POSIX), temp cleanup on failure (F-002, H-03)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Conflict detection           | `SafeWriter` + storage-level token/hash version enforcement (F-001)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Markdown parser              | 5/5 hostile corpus: malformed/unclosed/duplicate-key/huge frontmatter, links inside code fences correctly excluded, CRLF line numbers exact, Unicode headings, empty notes, 2MB note parsed in 154ms                                                                                                                                                                                                                                                                                                                                                                                |
| Index correctness            | Phase 11 exact-parity rebuild test: doc-by-doc `versionHash`/tags/headings/links/properties equality after `index.close()` + full rebuild from disk; backlink + property-query parity                                                                                                                                                                                                                                                                                                                                                                                               |
| AI mutation safety           | F-028 divergence abort (proposal apply rejected when file/buffer changed after generation); F-029 model-supplied path binding; Law 17 secret redaction in all provider error paths; Law 18 failure isolation                                                                                                                                                                                                                                                                                                                                                                        |
| Plugin permission gatekeeper | P9-2 immutable `grantedPermissions` snapshot + deep-frozen manifest projection (self-escalation provably blocked)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gates                        | 114/114 tests (37 suites), `tsc --build` 0 errors, clean `vite build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 3. What is partially working

- **Browser (FSA) persistence** — reads/writes/version-checks work, but the write path is a direct `createWritable` truncate-write; crash-atomicity is implementation-defined (Chromium does temp+swap in practice; not spec-guaranteed; other browsers vary). The alpha's primary runtime does not provide the F-002 guarantee the Node adapter has.
- **SQLite index engine** — correct and fast (100k synthetic rebuild 4.5s), but in-memory only and wired into no shipping app path.
- **Watcher** — create/modify/delete all handled (delete derived via `existsSync`), but platform fallback and error swallowing create staleness windows.
- **Starter vault / alpha UX** — seeded, dead-link-free (verified), but only exercised as React code, never by a browser test.

## 4. What is misleadingly described

1. **D-022**: "fulfilling the D-021 obligation for **100,000+ note vaults**" — no benchmark exists for the full system; the only in-repo gate (F-025) is 10,000 synthetic documents (no parser, no disk). The engine was measured at 100k by this audit (engine-only, synthetic); the full pipeline was not, and extrapolation is unfavorable (see §14).
2. **D-022**: "**persistent** desktop indexing" / "SQLite … wired directly into the desktop backend … **native**" — `SqliteDocumentIndex` is in-memory WASM `sql.js`; `databasePath` is declared and **never used**; nothing is serialized after mutation; `close()` discards; every launch rebuilds from Markdown. `export()` exists but has zero callers.
3. **D-022**: "**machine-bound** key derivation" — the default (and only in-repo usage) PBKDF2 secret is the hardcoded literal `'okw-device-bound-secret'` with a fixed public salt. Anyone with the source can decrypt the persisted secrets file. AES-256-GCM is correctly used; the _key management_ is not machine-bound.
4. **D-022**: "IPC interactions between the **native shell** and renderer" — there is no shell. `@okw/desktop` is a Node library; no Electron/Tauri/Neutralino/NW.js dependency or entry point exists. The commit message "deliver Desktop Wrapper" and ROADMAP's Phase 12 "Electron shell" describe different things.
5. **Phase 12 commit message**: "SQLite Desktop Scaling and Authenticated Secret Store" — scaling not demonstrated, secret store not authenticated in the security sense (see 3).
6. **`sanitizeHtml` docstring** ("removes inline event handlers", "blocks … pseudo-protocol injections") — false for entity-encoded handler names and `style`-attribute `url(javascript:)` (see §13).
7. **D-019 / PLUGIN_ARCHITECTURE "isolated"** — the plugin host is a permission facade in the same JS realm, not an execution isolation boundary (see §12).

## 5. Phase-by-phase verification matrix

| Phase                                                 | Claimed                                                                                     | Actual                                                                                                                 | Status           | Risk   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| 0–1 Foundation, vault, safe save                      | Contracts, safe atomic save, F-001/F-002 mitigation                                         | Node path fully verified (14/14 probes); browser path lacks atomic guarantee                                           | MOSTLY VERIFIED  | MEDIUM |
| 2 Workspace (outline, callouts, tasks, search, panes) | Verified in prior reviews; 48→50 tests                                                      | Code matches claims                                                                                                    | VERIFIED         | LOW    |
| 3 Index & SQLite derived state                        | SQLite index, FTS, rebuild (D-013)                                                          | Real `sql.js` engine, correct, parity-proven; **in-memory only, no persistence**; app still uses `MemoryDocumentIndex` | MOSTLY VERIFIED  | MEDIUM |
| 4 Graph                                               | 2D graph with provenance edges                                                              | Present, tested; graph construction super-linear at 10k (9.2s)                                                         | MOSTLY VERIFIED  | MEDIUM |
| 5-6 Views + properties                                | Notion-like views, YAML 1.2 serializer                                                      | Present, tested (P6 cycle)                                                                                             | VERIFIED         | LOW    |
| 7 AI local + retrieval                                | Scoped retrieval, proposals, F-028/F-029                                                    | Verified after P7 fix cycle (divergence abort, path binding)                                                           | VERIFIED         | LOW    |
| 8 BYOK + gateway                                      | Secret isolation, 4 providers, Law 17/18                                                    | Verified (headers-only keys, redaction everywhere, exit gate genuine)                                                  | VERIFIED         | LOW    |
| 9 Plugin SDK                                          | Permission gatekeeper, crash containment, F-006/F-007                                       | Gatekeeper solid after P9 fix; **not a sandbox** (no worker/iframe)                                                    | PARTIAL          | MEDIUM |
| 10 First-party pack                                   | 5 plugins via public API, zero private imports                                              | Verified (P10 hygiene items outstanding)                                                                               | VERIFIED         | LOW    |
| 11 Alpha consolidation                                | Full-system suite, starter vault, exact-parity rebuild                                      | Verified after P11 fix cycle (parity now doc-by-doc)                                                                   | VERIFIED         | LOW    |
| 12 Desktop wrapper                                    | "Desktop Wrapper, Native Vault Watcher, SQLite Desktop Scaling, Authenticated Secret Store" | Node library only; SQLite not persistent; secret store not machine-bound; no shell; watcher functional with caveats    | MISLEADING CLAIM | HIGH   |

## 6. Data-loss findings

- **DL-1 (P1): BrowserFSAVaultStorage.write is a non-atomic truncate-write.** `handle.createWritable()` → `write(bytes)` → `close()` with no temp file or swap (browser-fsa-storage.ts:211-214). Interruption mid-write can leave a truncated canonical file. Chromium mitigates in practice; the code and docs claim F-002 atomicity that only the Node adapter delivers. **Affected:** `packages/vault/src/browser-fsa-storage.ts` — the alpha's default storage. **Fix:** temp-file-then-rename strategy via FSA (create temp handle in same directory, write, then `move()` over target, mirroring the Node adapter), or document the browser caveat and surface a "browser saves are not crash-atomic" notice.
- **DL-2 (P2): BOM loss on edit.** Files with a UTF-8 BOM are read with `new TextDecoder().decode()` (default `ignoreBOM:false`), which strips the BOM from the editor buffer; the next save writes without it. Byte-fidelity of canonical files is silently broken for BOM-marked files. **Reproduced:** write `\uFEFF# Title`, read back → `'# Title'` (bytes on disk still `efbbbf`). **Fix:** decode with `{ignoreBOM:true}` and re-emit the BOM on save when the original file had one (track `hadBOM` on the snapshot), or always preserve the leading BOM when present.
- **DL-3 (P2): Index staleness after watcher read failures.** `DesktopVaultRuntime.handleWatcherEvent` swallows all read/parse errors; a transient failure (file locked mid-atomic-save) leaves the index entry stale until the next event or restart — search/backlinks/views then disagree with disk. Not canonical-file loss, but derived-state drift (F-003/F-004 family).
- **Verified non-issues (red-team):** process-kill mid-Node-save (temp+rename), temp-file collision (timestamp+random suffix), traversal (`SecurityError` / containment proven), stale version tokens (`ConflictError` + disk unchanged), delete-after-open (conflict, no resurrection), rapid saves (serialized), permission revocation (clean `StorageError`, no corruption).

## 7. Persistence findings

- **P-1 (P0-claim): SQLite index persistence does not exist.** `SqliteDocumentIndex.create(existingData?)` only ever receives `undefined`; `export()` is never called; `databasePath` in `DesktopVaultRuntimeOptions` is dead. Restart = full rebuild. As disposable derived state this is architecturally defensible (Constitution D-002); as "persistent desktop indexing" it is false. Choose: implement persistence (checkpoint `export()` to `databasePath` after mutation, load on create, survive restart, delete→rebuild still exact) **or** restate every claim (D-021/D-022, commit, handoffs).
- **P-2 (P1): full rebuild on every desktop launch.** `DesktopVaultRuntime.initialize()` always `rebuildVaultIndex` — at 10k that is 4.5s parse + 9.2s graph measured; at 100k extrapolates to minutes before first search works. Incremental load (persisted DB) or progressive rebuild is required for the claimed scale.
- **P-3 (P1): desktop secrets are decryptable by anyone with the source** (hardcoded PBKDF2 fallback secret + fixed salt; see §4.3). "Authenticated" is misleading. Either require a real passphrase/OS-keychain-backed key (Electron `safeStorage`, DPAPI, Keychain, libsecret) or rename the feature "obfuscated file storage".

## 8. SQLite findings (answers to the audit's 10 questions)

1. Persistent? **No** — in-memory only.
2. Physically stored? **Nowhere** — RAM only; `close()` discards.
3. Is `databasePath` honored? **No** — declared, never read.
4. Does the desktop runtime load an existing DB? **No** — always `new SQL.Database()` + full rebuild from Markdown.
5. Serialize after mutation? **No** — `export()` exists, zero callers.
6. Survives process termination? **No.**
7. Native SQLite? **No** — WASM `sql.js` (SQLite compiled to WebAssembly), running under Node on desktop.
8. WASM sql.js under Node? **Yes.**
9. Is "native SQLite" inaccurate? **Yes** — "WASM SQLite" is the precise phrase; root `START_HERE.md:60` already says "SQLite WASM" honestly, D-022 does not.
10. 100k benchmarked? **Not in-repo.** F-025 is 10k synthetic docs (hand-built `ParsedDocument`, no parser/disk). This audit's engine-only 100k run: rebuild 4.5s, search 0.8s — engine OK; full pipeline unmeasured and extrapolates poorly (graph §14).

## 9. Desktop findings

- **No executable desktop application exists.** `packages/desktop` is a TypeScript library (`@okw/desktop`): `DesktopVaultRuntime`, `NativeVaultWatcher`, `DesktopIpcBridge`, `DesktopSecretStore`. package.json has **no** Electron/Tauri/Neutralino/NW.js dependency; there is no main process, no window shell, no packaging, no installer. A user cannot install, launch, choose a vault, or restart-and-retain-state today.
- `DesktopIpcBridge` is an in-process handler registry — there is no real main↔renderer IPC channel.
- The watcher works for the common cases (create/modify/delete derived via `existsSync`) with these caveats: `fs.watch` `recursive:true` falls back to **non-recursive** on unsupported platforms with a silent catch (nested folder changes missed); no `fs.watch` `'error'` handler; swallowed read errors → stale index (DL-3); the `'renamed'` event type is declared but never emitted.

## 10. Index/search findings

- Index engine correctness: **strong** — exact-parity rebuild proven (Phase 11), code-fence link isolation, CRLF line numbers, aliases, same-name-in-different-dirs handled by full paths.
- `MemoryDocumentIndex` rebuild at 50k: 18ms (vs SQLite 2.1s) — the browser alpha's choice is also the fast one; SQLite buys persistence/scale, which is currently unused.
- Search: SQLite FTS 100k = 0.8s/query (measured); acceptable but not instant.
- Graph: super-linear — 1k: 234ms → 10k: 9,173ms (39x for 10x data). At 100k graph construction is unusable until this is bounded (edge sampling/limit).

## 11. AI findings

- F-028 divergence abort, F-029 path binding, Law 17 redaction, Law 18 isolation, scope enforcement, token budget: all verified in the P7/P8 cycles; no new defects found.
- Residual (P3): provider switch does not abort the in-flight stream (AIChatDrawer sync effect) — cross-provider state bleed, no data loss.

## 12. Plugin-isolation findings

**Can a hostile plugin bypass the declared capability system? YES — trivially.** The "sandbox" is a permission facade (`createPluginAPI`) in the same JS realm; every capability boundary is reachable outside the facade:

1. **Secrets:** `sessionStorage.getItem('okw_sec_openai')` reads BYOK keys directly (StandardSecretStore prefix `okw_sec_`) — bypasses `ai.use`.
2. **Network:** `fetch()` is ungated — no network permission exists; a plugin can exfiltrate the whole vault.
3. **Host realm:** `api.vault.read.constructor('return this')()` yields `globalThis`; prototype pollution (`Object.prototype.x = …`) affects host code.
4. **DOM:** `ui.registerView` hands plugins a live container; plugin code can read the editor's DOM (CodeMirror) directly, bypassing `vault.read`.

Not exploitable today only because every plugin is first-party code in the repo. D-019's "isolated capability host", PLUGIN_ARCHITECTURE.md's worker-isolation design, and the Phase 9/10 handoffs overstate the mechanism. The F-030/F-031 registry note records this honestly — the DECISIONS/PLUGIN_ARCHITECTURE text does not. Minimum for any third-party plugin: worker/iframe execution + postMessage capability bridge + CSP, per PLUGIN_ARCHITECTURE's own design.

## 13. Security findings

- **S-1 (P1, latent): four confirmed `sanitizeHtml` bypasses** — entity-encoded handler names (`on&#101;rror=` / `on&#69;rror=` survive; the browser decodes character references in attribute names, producing a live `onerror`), `style`-attribute `url(javascript:…)` (untouched), and `<scr<script>ipt>` collapsing to a bare `<script>`. **Not live today**: the app renders markdown as React elements; zero `dangerouslySetInnerHTML`/`innerHTML` occurrences in production code; `sanitizeHtml` has **no production call sites** — it exists only for its own tests. This is a false-confidence trap: SECURITY.md:56 ("Rendered Markdown must be sanitized"), the sanitizer's docstring, and its passing tests assert protection that any future HTML path (plugin views, HTML export, an embed feature) would inherit as a live XSS. Fix the sanitizer or delete it and its tests.
- **S-2 (P2): BYOK keys in `sessionStorage`** are readable by any same-realm code (XSS or plugin). Compensating controls: no live XSS path, per-session lifetime. Record and revisit before plugins go third-party.
- **S-3 (P1): desktop secret store not machine-bound** (see §7 P-3).
- **S-4 (verified good):** no path traversal escape (proven); no command injection surface (no shell exec anywhere); provider keys header-only (never in URLs/bodies/errors); HTML not rendered raw; CSP-level concerns unaddressed (no CSP header configured) — P3 for the alpha.

## 14. Performance findings (executed measurements)

Real pipeline (real files → parser → `rebuildVaultIndex` → SQLite):

|                   | 1,000 | 10,000   |
| ----------------- | ----- | -------- |
| file seeding      | 1.9s  | 23.6s    |
| index rebuild     | 0.54s | 4.5s     |
| search (limit 10) | 14ms  | 66ms     |
| backlinks         | 1ms   | <1ms     |
| graph build       | 0.23s | **9.2s** |

Engine-only (synthetic docs):

|                | 10k   | 50k   | 100k                   |
| -------------- | ----- | ----- | ---------------------- |
| SQLite rebuild | 0.41s | 2.1s  | 4.5s                   |
| SQLite search  | 88ms  | 413ms | 813ms                  |
| Memory rebuild | 4ms   | 18ms  | not run (memory bound) |
| Memory search  | 14ms  | 46ms  | —                      |

**Interpretation (clearly separated):** measured — engine handles 100k; full pipeline measured only to 10k. **Extrapolation (not measurement):** 100k cold start ≈ 45–90s rebuild + minutes of graph, recomputed on every launch because the DB is not persisted. 100k support is an engine fact, not a product fact.

## 15. Test-suite weaknesses (false confidence)

- **No browser tests at all** — the alpha's actual runtime (FSA storage, CodeMirror, preview) is untested.
- **Most suites use `MemoryVaultStorage`** — the crash-atomicity, fsync, and real-filesystem behaviors are only covered by the Phase 12 desktop suite (real FS) and this audit's probes.
- **No restart/persistence test** — the desktop suite never creates a runtime, closes it, and creates a second one with the same `databasePath` (which would fail: persistence is unwired).
- **F-025 benchmark is 10k synthetic docs** — no parser, no disk, no `rebuildVaultIndex`; it measures the engine only and cannot support the 100k claim.
- **Sanitizer tests assert bypassable behavior** (§13 S-1) — they pass while the protection they claim does not exist.
- **No hostile-filename, Unicode, CRLF, BOM, or traversal tests exist in-repo** (this audit's probes cover them; they should be promoted into the permanent suite).
- **No CI** — nothing runs these gates outside local dev.

## 16. CI / release gates

**Missing entirely.** No `.github/workflows` (or equivalent). A public alpha with no CI has no protection against regression on `main` — every phase has pushed directly. Required: workflow running `npm ci && npm run typecheck && npm test && npm run build` on Node LTS + current, plus (P2) a package-boundary check (no cross-package private imports — already a stated rule) and a browser smoke test (Playwright) for the FSA flow.

## 17. Remediation priorities

| ID                                                                                           | Severity | Finding                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-CLAIM-001                                                                                 | P0       | D-021/D-022/commit claim 100k, persistent SQLite, native desktop, machine-bound secrets — all false as delivered (claim-restoration rule)                                                       |
| P0-REMEDIATION must: implement or restate (SQLite persistence, desktop scope, secret keying) |          |                                                                                                                                                                                                 |
| P1-SQLITE-001                                                                                | P1       | Persist `SqliteDocumentIndex` to `databasePath` (checkpoint after mutation, load on create) or restate docs + remove dead `databasePath` option                                                 |
| P1-SECRET-001                                                                                | P1       | Replace hardcoded PBKDF2 fallback with real passphrase/OS-keychain binding; fail closed if no key available                                                                                     |
| P1-BROWSER-001                                                                               | P1       | Browser FSA write atomicity (temp+move swap) or explicit documented caveat + UI notice                                                                                                          |
| P1-SANITIZER-001                                                                             | P1       | Fix the 4 sanitizer bypasses or delete the sanitizer + its misleading tests (latent XSS trap)                                                                                                   |
| P1-PLUGIN-001                                                                                | P1       | Restate "isolated" claims; record that first-party-only today; design worker boundary before third-party plugins (PLUGIN_ARCHITECTURE already specifies it)                                     |
| P1-SCALE-001                                                                                 | P1       | Add the real benchmark suite (parser+disk) at 10k/50k/100k before restoring 100k claims; bound graph construction                                                                               |
| P2-DL-002                                                                                    | P2       | BOM preservation through read/write                                                                                                                                                             |
| P2-DL-003                                                                                    | P2       | Watcher: retry on transient read failure; add `fs.watch` error handler; log the non-recursive fallback                                                                                          |
| P2-PATH-001                                                                                  | P2       | Backslash path normalization (convert `\` to `/` instead of stripping)                                                                                                                          |
| P2-TEST-001                                                                                  | P2       | Promote audit probes (hostile FS, sanitizer corpus, BOM, traversal) into the permanent suite; add restart test                                                                                  |
| P2-CI-001                                                                                    | P2       | GitHub Actions: typecheck+tests+build on Node 20/22; browser smoke test                                                                                                                         |
| P3                                                                                           |          | provider-switch abort; CSP headers; `'renamed'` event; dead code cleanup (`sanitizeHtml` or fix; unused `search.query` in character-bible manifest; ManuscriptTools folder/extension filtering) |

## 18. Features that must remain frozen

- Sync (Phase 13), mobile (14), marketplace/third-party plugins, autonomous agents, collaboration, microservices, mandatory cloud. Do not start until Waves 1–4 pass their gates.

## 19. Features safe to continue building (after Waves 1–2)

- Desktop shell (Electron/Tauri) **if** it wires the fixed persistence + real key storage (Wave 4).
- Plugin pack features (first-party, existing sandbox constraints).
- Views/query engine extensions; starter-vault content.
- Documentation-driven truth passes (Wave 8) can run in parallel with Wave 1.

## 20. Recommended next engineering phase

**Remediation Waves 1–4 (see GEMINI_REMEDIATION.md), then a re-audit gate.** After that, the honest next product phase is the desktop shell (Wave 4) — it is the only path that makes the Phase 12 claims true — with the browser alpha remaining the reference client.

---

## Final audit ratings

```
Canonical File Safety: 8/10      (Node path excellent; browser write non-atomic; BOM loss)
Persistence Reliability: 5/10    (Markdown survives; index never persisted; rebuild-every-launch)
Browser Runtime: 6/10            (works; zero browser tests; FSA atomicity caveat; latent sanitizer trap)
Desktop Runtime: 2/10            (library only; no shell; no persistence; decryptable-by-source secrets)
Index/Search Correctness: 8/10   (parity proven; engine solid; graph super-linear)
Large-Vault Scalability: 4/10    (engine 100k measured; full system unmeasured, extrapolates poorly)
AI Isolation: 8/10               (F-028/F-029/Law 17/18 verified)
Plugin Isolation: 4/10           (permission facade, not a sandbox; first-party-only mitigates)
Security: 6/10                   (no live XSS; 4 latent sanitizer bypasses; sessionStorage secrets)
Test Credibility: 5/10           (114 pass but memory-only, no browser, no CI, sanitizer false confidence)
Documentation Accuracy: 5/10     (root docs honest; D-021/D-022 + Phase 12 commit overstate)
Public Alpha Readiness: 5/10
```

```
RECOMMENDATION:
CONTINUE AFTER FIXES
```

Do not inflate scores: every number above is the lower bound justified by executed evidence in this report.
