# OpenOb — Phase 3E P3E-P4 Final Security Closure Audit

**Audited HEAD:** `c83d0229cbb95c37f2a8dc4db4bd807b235b9dbe` — `origin/main` == local HEAD (verified `git ls-remote origin HEAD`). Audit performed against the **current working tree** containing the uncommitted P3E-P4 remediation.
**Audit mode:** read-only; no production code modified; temporary probes in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway binary, then removed; working tree restored to its pre-audit state.
**Scope:** P3E-P4 closure only. Phase 3F not audited.
**Original finding authority:** `PHASE3E_FINAL_CLOSURE_AUDIT.md` (P3E-P4, P1). Remediation: `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md` — treated as informational; all findings re-derived from live probes.

---

## 1. Baseline

| Step                   | Result                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD`   | `c83d022`                                                                                                                                                                                                                                                     |
| `git status --short`   | 14 modified + 4 untracked; remediation present as **uncommitted working-tree changes** (path.ts, workspace.ts, rebuilder.ts, path.test.ts, docs, tsconfigs, package.json, + `reserved-metadata-boundary.test.ts`, `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md`) |
| `git log -8 --oneline` | `c83d022` … `49d3fed` (no new commits since prior audit)                                                                                                                                                                                                      |
| `git diff --check`     | **PASS** (exit 0; only LF→CRLF notices)                                                                                                                                                                                                                       |

**Previous 5-file TS build-config diff:** still uncommitted in the working tree; the P4 remediation extends it (drops `@types/estree` from package.json, keeps `types: ["node"]` in gateway/desktop/vault tsconfigs). Documented intent in the remediation report; treated as hygiene (see §16), not confused with P3E-P4.

---

## 2. Direct Workspace Boundary (no HTTP)

Real `OpenObWorkspace` (writable, no client context) against reserved paths — committed regression suite §1.3 + live probe:

| API                      | `.openob/...` behavior                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `readNote`               | `InvalidPathError` ✓                                                                                             |
| `createNote`             | `InvalidPathError` ✓                                                                                             |
| `updateNote`             | `InvalidPathError` ✓                                                                                             |
| `setProperty`            | `InvalidPathError` ✓                                                                                             |
| `deleteNote`             | `InvalidPathError` ✓ (guard at workspace.ts:1665 is **before** the `.md`-suffix logic — genuine, not accidental) |
| `renameNote` (dest)      | `InvalidPathError` ✓ (workspace.ts:1178-1179)                                                                    |
| `renameNote` (source)    | `InvalidPathError` ✓                                                                                             |
| `getNoteMetadata`        | `InvalidPathError` ✓                                                                                             |
| `getBacklinks`           | `InvalidPathError` ✓                                                                                             |
| `getOutgoingLinks`       | `InvalidPathError` ✓                                                                                             |
| `getProperties`          | `InvalidPathError` ✓                                                                                             |
| `getGraphNeighbors`      | `InvalidPathError` ✓                                                                                             |
| `listEntries('.openob')` | `InvalidPathError` ✓ (workspace.ts:260)                                                                          |

**All 14 path-oriented note APIs route through `resolveNotePath` (workspace.ts:1847-1857), which enforces `isReservedWorkspacePath`. Invariant exists below adapters — for exact-lowercase paths.**

**BUT: case-variant paths bypass the guard at this layer too** — see §9/§14a. `readNote('.OPENOB/views/x.json')` does **not** throw.

## 3. Exact Old REST Exploit (real gateway, scopes WITHOUT `workspace.views.write`)

Scopes: `workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete` (no `workspace.views.write`). Legitimate Saved View pre-seeded.

**Lowercase (exact old exploit): DEAD.**

- `GET /api/v1/notes/.openob/views/<id>.json` → **400** `INVALID_PATH` (not 200) ✓
- `POST /api/v1/notes` path `.openob/views/<id>.json` → **400** ✓ (view does not appear)
- `PUT /api/v1/notes/.openob/views/<id>.json` → **400** ✓ (view remains valid, byte-identical)
- `POST /api/v1/notes` path `.openob/evil.md` → **400** ✓
- Rename into/out of `.openob`, DELETE, PATCH properties → all **400** ✓ (committed test 3.1, 11 attack vectors)

**Case-variant (normalized form of the same exploit): ALIVE.** See §14a — **P3E-P4 remains P1.**

## 4. Full-View-Scope Attack (scopes WITH `workspace.views.write`)

Committed test 2.2 (client with `workspace.read, workspace.views.write, workspace.write, workspace.delete`):

- Can create saved views via the **Saved View API** ✓
- `readNote('.openob/views/<id>.json')` → `InvalidPathError` ✓
- `createNote('.openob/evil.md')` → `InvalidPathError` ✓
- `deleteNote('.openob/views/<id>.json')` → `InvalidPathError` ✓

`workspace.views.write` authorizes Saved View operations; it does **not** turn `/notes` into a metadata API. (Exact-lowercase paths; case-variant gap applies here too.)

## 5. Legitimate View API

Committed test 1.5 + prior-Phase verification:

- With `workspace.views.write`: `POST /api/v1/views` 201, `PUT /api/v1/views/:id` 200, `DELETE /api/v1/views/:id` 200 — full CRUD works. `SavedViewStore` retains storage access to `.openob`.
- Without `workspace.views.write`: view mutations remain **403** (R3E-2 gate intact).
- Fix did not block `SavedViewStore` itself.

**PASS.**

## 6. Rename Attacks

- `A.md → .openob/evil.md` (lowercase dest): **400** ✓ (committed 3.1 + probe). `A.md` remains.
- `A.md → .openob/views/evil.json`: **400** ✓.
- `.openob/views/existing.json → B.md` (rename metadata out): **400** ✓ (source also guarded).
- **Case-variant `A.md → .OPENOB/stolen.md` with valid token: → 200, file landed inside `.openob/`.** See §14a.

## 7. Property / Delete Attacks

- `setProperty` on `.openob` → 400 `INVALID_PATH` (not a `.md`-suffix accident — guard is in `resolveNotePath`).
- `deleteNote` on `.openob` → 400 `INVALID_PATH` (guard at workspace.ts:1665 runs before the `.md` append at :1666 — protection is **not** the suffix forcing).

**PASS (exact-lowercase).**

## 8. Read-Side Leakage

Lowercase: `readNote`/`getNoteMetadata`/`getBacklinks`/`getOutgoingLinks`/`getGraphNeighbors`/`listEntries('.openob')` all → 400. No Saved View config leakage through ordinary note APIs.
**Case-variant: `GET /api/v1/notes/.OPENOB/views/<id>.json` → 200 with full config + version token; `GET /api/v1/entries?path=.OPENOB` → 200 listing `.openob` contents.** See §14a.

## 9. Path Normalization Attacks

Live REST probe matrix (scopes without `workspace.views.write`):

| Path form                                                                                | Result                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.openob/views/x.json` (lowercase)                                                       | 400 INVALID_PATH ✓                               |
| `.openob/views/../views/x.json`                                                          | 400 ✓                                            |
| `.openob//views/x.json`                                                                  | 400 ✓                                            |
| `.openob/./views/x.json`                                                                 | 400 ✓                                            |
| `.openob%2fviews%2fx.json` (encoded slash, decoded server-side)                          | 400 ✓                                            |
| `.openob/../A.md`                                                                        | 200 → normalizes to `A.md` (legal note; correct) |
| `/.openob/...`, `./.openob/...`, `foo/../.openob/...`, `.openob\views\...`               | 400 (committed 1.1/1.3) ✓                        |
| **`.OPENOB/views/x.json` (case variant)**                                                | **200 — BYPASS** ✗                               |
| **`.OpenOb/evil.md` (case variant)**                                                     | **201 — BYPASS** ✗                               |
| Near-miss legal: `.openobserver.md`, `.openob-notes/foo.md`, `notes/.openobservation.md` | **201** — correctly NOT rejected ✓               |

**Path normalization can bypass the guard via case-variance on case-insensitive filesystems.**

## 10. Single Reserved-Path Rule

One shared definition: `RESERVED_WORKSPACE_PREFIX = '.openob'` + `isReservedWorkspacePath()` in `@okw/core/src/path.ts`, consumed by workspace.ts (resolveNotePath, listEntries, rebuildIndex) and `@okw/index/src/rebuilder.ts` (rebuildVaultIndex). No divergent hand-coded checks remain (the previous `startsWith('.openob')` filters were replaced). **PASS for the shared-rule requirement.**

**However:** the shared predicate itself is case-sensitive (`.OPENOB` ≠ `.openob`), which is the root cause of §14a. This is a single-rule defect, not a divergence defect.

## 11. Reserved Namespace Index Isolation (unchanged)

`rebuildIndex` and `rebuildVaultIndex` skip `.openob/` (committed test 1.6: injected `.openob/evil.md` not indexed, search returns 0); search/property-query/graph/wikilink all exclude `.openob`; ordinary note tree hides it (listEntries filters). No metadata becomes user note state.

**PASS.**

## 12. Saved View Byte Integrity

Committed test 3.2: SHA-256 of `.openob/views/<id>.json` before and after the 11-vector REST attack (lowercase) — **byte-identical**; view runs afterward.
**Case-variant: `PUT /api/v1/notes/.OPENOB/views/<id>.json` with the version token obtained from the case-variant GET → 200; on-disk bytes change to `CORRUPTED-VIEW`; `listSavedViews` → `[]`; `runSavedView` → 400 "corrupted".** See §14a.

## 13. Markdown Regression

- Normal note operations outside `.openob` (create/read/update/property/rename/delete/backlinks/search/query) work — committed test 1.2 (near-miss names) + full 360-test suite + e2e 26/26.
- Nested dot-directories other than exact `.openob` (e.g. `.openob-notes/`) work normally.
- No broad path-guard regression (only `.openob` prefix + its normalized aliases are rejected; near-misses verified legal).

**PASS.**

## 14. Scope Model (central closure criterion)

- **Lowercase paths:** a note-write client (`workspace.write` without `workspace.views.write`) cannot mutate Saved View metadata by any route: note APIs → 400, views API → 403. R3E-2 scope separation holds across every reachable canonical path. **PASS.**
- **Case-variant paths:** the same note-write client **can** read view configs (200), forge-create view files (201), overwrite/corrupt view files (200 with token), rename notes into `.openob/` (200), and list `.openob` contents (200) — all without `workspace.views.write`. **FAIL — P3E-P4 remains P1.**

## 14a. P3E-P4 REMAINS OPEN — Case-Insensitive Path Bypass (P1)

**Root cause:** `isReservedWorkspacePath()` compares the normalized path case-sensitively against `.openob` (packages/core/src/path.ts:135-141). `normalizeVaultPath` does not case-fold. On case-insensitive filesystems (Windows NTFS — this environment; macOS APFS default), `.OPENOB`, `.OpenOb`, etc. resolve to the same directory as `.openob`, so the filesystem honors the attack while the string guard does not.

**Live reproduction** (real built gateway, scopes WITHOUT `workspace.views.write`):

1. `GET /api/v1/notes/.OPENOB/views/<id>.json` → **200**, returns the saved-view envelope **including its real version token**.
2. `POST /api/v1/notes` path `.OpenOb/evil.md` → **201** (file created inside the reserved directory; a second POST to `.OPENOB/evil.md` returns 409 "file already exists", proving same-directory resolution).
3. `PUT /api/v1/notes/.OPENOB/views/<id>.json` with the token from step 1 → **200**; on-disk view file becomes `CORRUPTED-VIEW`; the view is destroyed (`listSavedViews` → `[]`, `runSavedView` → 400).
4. `POST /api/v1/notes/A.md/rename` with `newPath: '.OPENOB/stolen.md'` and a valid A.md token → **200**; the note file lands inside `.openob/`.
5. `GET /api/v1/entries?path=.OPENOB` → **200**, lists `.openob` contents.

**In-process layer confirmed too:** `readNote('.OPENOB/views/x.json')` on a writable `OpenObWorkspace` does not throw (vitest probe).

**Severity: P1** per the audit's own ladder — a note API can read/write/delete/rename `.openob` metadata (delete via overwrite), `workspace.write` bypasses `workspace.views.write`, and a second canonical metadata write authority exists. Not P0 (no outside-vault write; the attack stays inside the vault).

**Smallest compatible remediation direction (for Gemini):** case-fold the comparison in `isReservedWorkspacePath` (e.g. lowercase both sides, or compare a `toLowerCase()` of the normalized path against `.openob`), add case-variant vectors to `reserved-metadata-boundary.test.ts` (`.OPENOB`, `.OpenOb`, mixed-case) for every note API, and re-run the gate. Exact-lowercase guard, near-miss legality, and all other sections already pass.

## 15. R3E-1/2/3 Regression Spot-Check

- `readOnly: true` context-less view writes denied — unchanged (workspace.ts:1807) ✓
- Standalone explicitly writable Saved Views work — unchanged (useVault.ts `readOnly: false`) ✓
- Default gateway read-only (403) ✓ (prior audit §6, unchanged)
- Documented writable gateway works ✓ (e2e 26/26 incl. saved-views-board specs)
- Explicit `views.write` denial works ✓ (this audit §5, committed test 2.1)
- `gateway --help` exit 0 ✓ / unknown flag exit 1 ✓ (prior audit §11/12, unchanged code)
- No new evidence of R3E-1/2/3 regression.

**PASS — no reopening.**

## 16. TypeScript Build-Config Hygiene

- `@types/estree` removed from `package.json` direct devDependencies; still present only as eslint's transitive dependency (package-lock) — no gratuitous direct dep remains; no source imports estree types.
- gateway/desktop/vault tsconfigs keep explicit `"types": ["node"]` (these packages use Node globals: `process`, `Buffer`, `fs`); root/base keep `"types": []`.
- `npm run typecheck` → **PASS**.
- The prior 5-file diff is coherent with the remediation's documented intent; it remains **uncommitted** (hygiene/P3 — flag for commit, not P1).

**PASS as hygiene; P3 — recommend committing the working tree.**

## 17. Full Gate

From clean generated state (`rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci`, 0 vulnerabilities):

| Gate                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` | **FAIL** — `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md` is not Prettier-formatted (the report itself claims format:check PASS)                                                                                                                                                                                                                                                                                                                                                            |
| `npm run lint`         | PASS (0 errors / 7 pre-existing warnings)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run typecheck`    | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm test`             | **FAIL on clean tree** — `tests/integrity/reserved-metadata-boundary.test.ts` spawns `apps/gateway/dist/bin/gateway.js`, which does not exist because `npm run verify` runs `npm test` **before** `npm run build`. Once `npm run build` has run, the full suite passes **62 files / 360 tests** (10/10 in the new suite). CI (`.github/workflows/ci.yml`) builds before testing, so CI would pass; the local clean-gate sequence per the `verify` script and this audit's §17 does not. |
| `npm run build`        | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:e2e`     | **PASS — 26/26**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run verify:full`  | **FAIL (exit 1)** — stops at `format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Reserved-metadata attack regression 20x loop:** 20/20 passed, 0 failures (with dist present).

**Vitest count:** 62 files / 360 tests (358 + 2 skipped on first clean run due to missing dist; 360/360 with dist present). **Playwright count:** 26/26.

## 18. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `c83d022` == local HEAD. GitHub web/API return **404** (private repo, no token) → workflow-run status at this HEAD not observable from this environment. Workflow exists and runs Node 20/22 matrix + Playwright + packaging. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.** CI existence not denied; note CI builds before testing, which masks the local test-ordering defect in §17.

---

## 19. Severity Summary

| ID                                                                | Severity      | Status                                                                                                              |
| ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| P3E-P4 (exact lowercase exploit)                                  | P1 (as filed) | **Closed for exact paths** — 400 across all note APIs, byte-integrity verified                                      |
| **P3E-P4 (case-variant bypass)**                                  | **P1**        | **OPEN** — `.OPENOB`/`.OpenOb` reach read/create/overwrite/rename/list of `.openob` without `workspace.views.write` |
| Gate: `format:check` red                                          | P2            | OPEN — new remediation report unformatted                                                                           |
| Gate: `npm test` fails on clean tree (test-before-build ordering) | P2            | OPEN — new suite depends on pre-built dist; local verify sequence builds after test                                 |
| Build-config hygiene                                              | P3            | OPEN — coherent and typecheck-clean; working tree uncommitted                                                       |
| P0                                                                | —             | none (no outside-vault filesystem catastrophe)                                                                      |

---

## 20. Verdict

**STOP — exact blocker: P3E-P4 remains P1 via case-insensitive path normalization.**

The remediation is **substantially correct** and closes the exact-lowercase exploit completely: every note API rejects `.openob/...` with `InvalidPathError` (400) below the adapters; rename/property/delete have genuine guards; near-miss names stay legal; one shared predicate in `@okw/core` is used everywhere; the Saved View API still works with `workspace.views.write` and stays 403 without it; index isolation, byte integrity, Markdown operations, and R3E-1/2/3 all hold; e2e 26/26; the committed regression suite is deterministic (20/20).

**However, the central closure criterion is not met:** `isReservedWorkspacePath` compares case-sensitively, and on case-insensitive filesystems (Windows/macOS) case-variant paths (`.OPENOB`, `.OpenOb`) bypass the guard for read (200 + version-token leak), create (201 forged view files), overwrite (200, view destroyed), rename into `.openob` (200), and directory listing (200) — all with only note-write scopes, no `workspace.views.write`. This is precisely the P1 the audit ladder defines: "any note API can read/write/delete/rename .openob metadata", "workspace.write bypasses workspace.views.write", "second canonical metadata authority".

**Secondary blockers (P2, gate):** `npm run format:check` fails on the new `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md`; and `npm test` fails on a clean tree because the new regression suite requires `apps/gateway/dist` before `npm run build` runs (local `verify` order test→build; CI order build→test). `verify:full` is therefore **red** even after the security fix lands.

Phase 3F not audited per instruction.
