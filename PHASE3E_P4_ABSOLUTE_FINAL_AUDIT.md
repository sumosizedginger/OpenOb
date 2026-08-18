# OpenOb — Phase 3E P3E-P4 Absolute Final Closure Audit

**Audited HEAD:** `2c08cf0be3adbc0f46437ff4bd2fb132ac9d9f62` (`2c08cf0 docs: finalize Phase 3E P4 closure report`) — `origin/main` == local HEAD (verified `git ls-remote origin HEAD`). **Working tree clean (0 changes)** as required for final closure.
**Audit mode:** read-only; no production code modified; one temporary probe in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway, then removed; working tree clean at end.
**Scope:** P3E-P4 case-variant + clean gate only. Phase 3F not audited.
**Authority:** original P3E-P4 finding (`PHASE3E_FINAL_CLOSURE_AUDIT.md`) + remediation (`PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md`). Previous blockers: P1 case-variant `.openob` bypass; P2 closure report not Prettier-clean; P2 clean `npm test` depends on prebuilt `apps/gateway/dist`.

---

## 1. Baseline

| Step                    | Result                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD`    | `2c08cf0`                                                                                                                                                                                                   |
| `git status --short`    | **clean (0 entries)** — required condition met                                                                                                                                                              |
| `git log -10 --oneline` | `2c08cf0` docs finalize P4 closure · `8e08150` fix(security): enforce case-insensitive reserved metadata namespace · `b629171` build: correct TypeScript ambient type configuration · `c83d022` … `46f35f1` |
| `git diff --check`      | PASS (exit 0)                                                                                                                                                                                               |

New commits since prior audit: `b629171` (ambient types), `8e08150` (the case-insensitive fix + tests), `2c08cf0` (docs). The prior 5-file build-config working-tree diff was committed as part of `b629171`; nothing remains dirty.

## 2. Case-Insensitive Contract (source)

`isReservedWorkspacePath()` (packages/core/src/path.ts:118-142) now case-folds before comparison:

```ts
const canonical = normalizeVaultPath(rawOrNormalizedPath);
const folded = canonical.toLowerCase();
return folded === RESERVED_WORKSPACE_PREFIX || folded.startsWith(`${RESERVED_WORKSPACE_PREFIX}/`);
```

with a `toLowerCase()` fallback in the `catch` branch for paths that fail normalization. Committed unit test 1.1 asserts reserved-ness for `.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB` (+ children), and near-miss legality for `.openobserver.md`, `.OPENOBSERVER.md`, `.OpenObserver.md`, `.openob-notes/foo.md`, `.OPENOB-NOTES/foo.md`, `notes/.openobservation.md`, `foo.openob/bar.md`, `foo.OPENOB/bar.md`.

**PASS.**

## 3. Direct Workspace Attack (no adapter)

Committed suite test 1.3 runs `readNote`/`getNoteMetadata`/`createNote`/`updateNote`/`setProperty`/`renameNote` (dest+source)/`deleteNote`/`getBacklinks`/`getOutgoingLinks`/`getProperties`/`getGraphNeighbors` against 22 attack paths spanning lowercase, `.OPENOB`, `.OpenOb`, `.oPeNoB`, `./.OPENOB/...`, `foo/../.OPENOB/...`, `.OPENOB\...`, `/.OPENOB/...` — **all throw `InvalidPathError`**. Test 1.4: `listEntries` rejects `.openob`/`.OPENOB`/`.OpenOb`/`.oPeNoB`/`.openob/views`/`.OPENOB/views` with `InvalidPathError` and root listing omits `.openob` in any casing. Test 1.6: rebuilder skips injected `.openob/evil.md` **and** `.OPENOB/uppercase.md` (index query returns 0).

**PASS — and these are pure-function/in-memory assertions (MemoryVaultStorage + the predicate), so they enforce the contract on Linux too, not merely on this case-insensitive host.**

## 4. Exact Real-Gateway Old Bypass (case variants, NO `workspace.views.write`)

Real built gateway (`apps/gateway/dist/bin/gateway.js`), scopes `workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete` (no `workspace.views.write`), legitimate existing view. Independent live probe — every case variant `.openob` / `.OPENOB` / `.OpenOb` / `.oPeNoB` / `.OpEnOb`:

| Attack                                                            | Result (all variants)              |
| ----------------------------------------------------------------- | ---------------------------------- |
| `GET /api/v1/notes/.<v>/views/<id>.json`                          | **400** `INVALID_PATH` (was 200) ✓ |
| `POST /api/v1/notes` path `.<v>/evil.md`                          | **400** `INVALID_PATH` (was 201) ✓ |
| `POST /api/v1/notes` path `.<v>/views/<id>.json` (valid envelope) | **400** ✓ (view never appears)     |
| `PUT /api/v1/notes/.<v>/views/<id>.json` (with token)             | **400** ✓ (view not corrupted)     |
| `POST /api/v1/notes/A.md/rename` newPath `.<v>/stolen.md`         | **400** ✓                          |
| `GET /api/v1/entries?path=.<v>`                                   | **400** ✓ (was 200 listing)        |
| Root `GET /api/v1/entries`                                        | 200, `.openob` omitted ✓           |

**ALL case variants dead. P1 blocker resolved.**

## 5. Full-Views-Scope Test

Committed test 2.2 (client with `workspace.views.write`): can create saved views via the dedicated API, but `readNote`/`createNote`/`deleteNote` on `.openob` and `.OPENOB` paths still throw `InvalidPathError`. `workspace.views.write` does not turn `/notes` into a metadata API. **PASS.**

## 6. Case Matrix

Committed suite 1.1/1.3/2.1/2.2/3.1 + independent probe cover `.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB`, `.OpEnOb` (probe added `.OpEnOb`) across GET/POST/PUT/DELETE/PATCH/rename/entries/listEntries. **No case variant escapes.**

## 7. Normalization Matrix

Committed suite 1.1/1.3 + independent probe:

| Form                                                  | Result                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `./.OPENOB/views/x.json`                              | 400 ✓                                            |
| `foo/../.OPENOB/views/x.json`                         | 400 ✓                                            |
| `.OPENOB\views\x.json` (backslash)                    | 400 ✓ (committed 1.1/1.3)                        |
| `/.OPENOB/views/x.json`                               | 400 ✓                                            |
| `.OPENOB//views//x.json` (double separators)          | 400 ✓                                            |
| `.OPENOB/./views/x.json` (dot segment)                | 400 ✓ (committed)                                |
| URL-encoded REST variants (`%2F` decoded server-side) | 400 ✓ (committed 3.1)                            |
| `.openob/../A.md`                                     | 200 → `A.md` (legal note; correct normalization) |

**No normalization path becomes a case bypass.**

## 8. Byte Integrity

Committed test 3.2 + independent probe: SHA-256 of `.openob/views/<id>.json` before/after the full case-variant attack matrix — **byte-identical**; view still lists via `/api/v1/views` and runs. **PASS.**

## 9. Portability (Linux CI must catch the bug)

The case-insensitive contract is asserted at three layers that do **not** depend on host filesystem case behavior:

- **Unit (path.test.ts)**: `isReservedWorkspacePath('.OPENOB') === true` — pure string logic.
- **In-process (reserved-metadata-boundary 1.1/1.3/1.4)**: MemoryVaultStorage + the same predicate — no real FS involved.
- **HTTP (3.1)**: the workspace guard rejects before any disk path resolution, so the real gateway returns 400 on Linux identically.

A regression that removes case-folding fails test 1.1 on any OS. **PASS — Linux CI would catch the bug.**

## 10. Clean `npm test` WITHOUT dist

From clean generated state:

```
rm -rf apps/gateway/dist apps/web/dist packages/*/dist   # confirmed absent
npm ci                                                    # 0 vulnerabilities
npm test                                                  # BEFORE any build
```

**Result: PASS — 62 files / 360 tests.** The new `reserved-metadata-boundary.test.ts` builds its own **isolated temporary production dist** via `execFile(node, [BUILD_SCRIPT, '--outdir', tempDist])` into `apps/gateway/.dist-boundary-<ts>-<rand>` and cleans it up in `afterAll`. It does **not** reference a pre-existing `apps/gateway/dist/bin/gateway.js`. **P2 blocker resolved — shared stale dist dependency rejected and eliminated.**

## 11. Isolated Process Build (HTTP regression quality)

- **Temporary/isolated output:** unique `--outdir` per suite run (`.dist-boundary-<timestamp>-<random>`), removed in `afterAll`.
- **Deterministic readiness:** stdout regex `/Listening on (http:\/\/127\.0\.0\.1:(\d+))/` with a 10s timeout; no arbitrary sleeps, no hidden retries.
- **Proper cleanup:** `child.kill('SIGTERM')`, `fs.rm(tempDist)`, `fs.rm(tempVaultDir)` in `afterAll` (all `.catch(() => {})` guarded).
- **No shared dist race:** no suite writes to or reads from the shared `apps/gateway/dist`; parallel-safe.

**PASS.**

## 12. Format Gate

- `npm run format:check` → **PASS** ("All matched files use Prettier code style!").
- `git diff --check` → **PASS**.
- `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md` is a committed, normal `.md` file — not in `.prettierignore` (which contains only build/artifact dirs), and it now passes Prettier. **P2 blocker resolved.**

## 13. Build-Config Hygiene (committed state)

- `@types/estree`: **0** direct occurrences in `package.json`; only transitive entries remain in `package-lock.json` (eslint's own deps). No source imports estree types.
- Node packages that need ambient Node globals declare them explicitly: `apps/gateway`, `packages/desktop`, `packages/vault` → `"types": ["node"]`; base stays `"types": []`.
- `npm run typecheck` → **PASS**.
- Committed as `b629171 build: correct TypeScript ambient type configuration`. No gate impact. **PASS (P3 hygiene, not security).**

## 14. Scope Separation (P1 closure criterion)

- **`workspace.write` cannot alter/read Saved View metadata through ANY note API path** — proven by tests 2.1 + 3.1 + independent probe: note APIs return 400 for every `.openob` casing; `/api/v1/views` mutations return 403 without `workspace.views.write`; byte integrity holds.
- **`workspace.views.write` allows Saved View mutation ONLY through the dedicated service** — proven by tests 1.5 + 2.2: dedicated view CRUD works; note APIs on `.openob` still 400 even with the scope granted.
- No reachable canonical path lets a note-write client touch metadata. **PASS — central closure criterion met.**

## 15. Lowercase Regression

Lowercase `.openob` matrix re-run (committed suite 1.3 + probe): all note APIs still 400; `.openob/evil.md` rejected; view byte-integrity intact. The fix did not regress the original lowercase path. **PASS.**

## 16. R3E-1/2/3 Spot-Check (committed state)

- `readOnly: true` context-less view writes denied — `checkCapability` blocklist includes `workspace.views.write` (workspace.ts:1804-1807) ✓
- Standalone explicitly writable Saved Views work — `useVault.ts` `readOnly: false` (3 sites) ✓
- Gateway default read-only — prior gate evidence unchanged ✓
- Documented writable path works — e2e 26/26 incl. saved-views-board specs ✓
- Explicit `views.write` denial works — test 2.1 + `/api/v1/views` 403 ✓
- `--help` truthful — `node apps/gateway/dist/bin/gateway.js --help` **exit 0** ✓
- Unknown flag fails — `--definitely-not-a-real-flag` **exit 1** with error ✓

**PASS — no regression.**

## 17. Full Clean Gate

From clean generated state (`rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci`, 0 vulnerabilities):

| Gate                   | Result                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run format:check` | **PASS**                                                          |
| `npm run lint`         | PASS (0 errors / 7 pre-existing warnings)                         |
| `npm run typecheck`    | PASS                                                              |
| `npm test`             | **PASS — 62 files / 360 tests** (with dist removed, before build) |
| `npm run build`        | PASS                                                              |
| `npm run test:e2e`     | **PASS — 26/26**                                                  |
| `npm run verify:full`  | **PASS (exit 0)**                                                 |

**Vitest count:** 62 files / 360 tests. **Playwright count:** 26/26.

## 18. 20x Adversarial Run

`reserved-metadata-boundary.test.ts` (in-process matrix + cross-scope + real spawned-gateway HTTP case-variant attacks, each run building its own isolated dist) run 20 consecutive times: **20/20 passed, 0 failures, no flake.**

## 19. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `2c08cf0` == local HEAD. GitHub web/API return **404** (private repo, no token) → actual workflow-run status at this exact HEAD is not observable from this environment. Workflow `.github/workflows/ci.yml` runs Node 20/22 matrix (format, lint, typecheck, build, packaging checks, test) plus a Playwright job. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.** CI existence not denied; full gate replayed locally and green. Note CI builds before testing (build step precedes test), and the reserved-metadata suite is now independent of that ordering anyway (isolated build), so CI ordering is no longer load-bearing for this suite.

---

## 20. Severity Summary

| ID                                            | Severity      | Status                                                                                                           |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| P3E-P4 case-variant bypass                    | P1 (as filed) | **CLOSED** — all case variants rejected (400) at every note API; scope separation holds; byte integrity verified |
| P2: closure report not Prettier-clean         | P2            | **CLOSED** — `format:check` PASS, file committed and formatted                                                   |
| P2: clean `npm test` depends on prebuilt dist | P2            | **CLOSED** — isolated per-suite build (`--outdir` temp), `npm test` passes with dist removed                     |
| Build-config hygiene                          | P3            | **CLOSED** — committed (`b629171`), typecheck clean, no gratuitous `@types/estree`                               |
| P0                                            | —             | none                                                                                                             |

---

## 21. Verdict

**SAVED VIEWS + BOARD FOUNDATION COMPLETE.**

All absolute-final closure criteria are met:

- lowercase **AND** all case variants (`.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB`, `.OpEnOb`) are reserved — predicate case-folds, verified in source and live;
- Linux CI would catch the case-variant contract (tests assert pure-string/in-memory behavior, not host FS case behavior);
- every note API (`readNote`/`createNote`/`updateNote`/`setProperty`/`deleteNote`/`renameNote`/`getNoteMetadata`/`getBacklinks`/`getOutgoingLinks`/`getProperties`/`getGraphNeighbors`/`listEntries`) rejects the metadata namespace with `InvalidPathError` (400), at workspace and real-gateway layers;
- `workspace.write` cannot bypass `workspace.views.write` — no note API path reaches Saved View metadata, and view mutations are 403 without the scope;
- legitimate views APIs remain fully functional with `workspace.views.write` (create/update/delete/run; e2e 26/26);
- Saved View bytes survive the entire case-variant attack matrix (SHA-256 identical; view lists and runs);
- `npm test` passes from **no dist** before build (62 files / 360 tests) via the isolated per-suite production build;
- closure report is formatter-clean and included in normal Prettier checking;
- working tree is clean/committed at HEAD `2c08cf0` (origin/main in sync);
- `verify:full` passes (exit 0) from clean `npm ci`.

Previous P1 (case-variant `.openob` bypass) and both P2 gate blockers are resolved with committed code, committed regression tests (776-line suite incl. 20×-verified determinism), and independent live probes. No new blockers found.

Phase 3F not audited per instruction.
