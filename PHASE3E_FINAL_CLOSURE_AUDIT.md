# OpenOb — Phase 3E Final Closure Re-Audit (R3E-1 / R3E-2 / R3E-3)

**Audited HEAD:** `c83d0229cbb95c37f2a8dc4db4bd807b235b9dbe` (`c83d022 build: install @types/estree and standardize types: [] across all package tsconfigs`) — `origin/main` == local HEAD (verified `git ls-remote origin HEAD`).
**Audit mode:** read-only; no production code modified; temporary probes built in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the **real built gateway binary** (`apps/gateway/dist/bin/gateway.js`), then removed; working tree restored to its pre-audit state.
**Scope:** Phase 3E Final Closure (R3E-1 / R3E-2 / R3E-3) only. Phase 3F not audited.
**Original audit:** `PHASE3E_SAVED_VIEWS_BOARD_AUDIT.md` (at `ff5b122`); **remediation:** `ANTIGRAVITY_PHASE3E_REMEDIATION.md`; remediation implemented at `46f35f1`, docs finalized at `54f950b`/`dcb42ef`. The closure report (`PHASE3E_REMEDIATION_CLOSURE_REPORT.md`) was treated as informational only; all findings were re-derived from the original audit + live probes.

---

## 1. Current-State Awareness

| Step                   | Result                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git rev-parse HEAD`   | `c83d0229`                                                                                                                                                                                                                                 |
| `git status --short`   | 5 modified files, **all build-config only**: `apps/gateway/tsconfig.json`, `packages/desktop/tsconfig.json`, `packages/vault/tsconfig.json` (`types: []` → `types: ["node"]`), `package.json` + `package-lock.json` (drop `@types/estree`) |
| `git log -5 --oneline` | `c83d022`, `0dc1296`, `29129a0`, `65269a0`, `dcb42ef`                                                                                                                                                                                      |
| Origin sync            | `origin/main` == local HEAD == `c83d022`                                                                                                                                                                                                   |

**Hygiene note:** the working tree carries uncommitted tsconfig/package changes that partially _reverse_ HEAD `c83d022` (restoring `types: ["node"]`, removing `@types/estree`). These are build-configuration only; they do not touch production semantics, and the full gate passes with them in place. Recorded per audit instruction 1; not a blocker.

---

## 2. Format / Prettier Check

| Check                                         | Result                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format:check`                        | **PASS** — "All matched files use Prettier code style!"                                                                                                                                                                                                                                    |
| `git diff --check`                            | **PASS** (exit 0; only expected LF→CRLF notices on the 5 modified files)                                                                                                                                                                                                                   |
| Formatter config weakened?                    | No — `.prettierrc.json` unchanged (`singleQuote`, `printWidth 100`, `trailingComma es5`)                                                                                                                                                                                                   |
| Audit docs hidden in `.prettierignore`?       | No — `.prettierignore` contains only `node_modules/`, `dist/`, `build/`, `coverage/`, `playwright-report/`, `test-results/`, `.vitest/`, `*.tsbuildinfo`, `*.log`, `*.tmp`, `.temp-*`, `.dist-*`, `tests/_reaudit-tmp/`. All three Phase 3E audit docs are formatted by Prettier and pass. |
| `verify:full`                                 | **PASS** (exit 0, see §18)                                                                                                                                                                                                                                                                 |
| Bulk-formatting changed production semantics? | No — the only working-tree diff is the 5 build-config files above.                                                                                                                                                                                                                         |

**PASS.**

---

## 3. R3E-1 Exact Reproduction (read-only workspace, NO client scope context)

Live probe (`OpenObWorkspace` constructed exactly as `useVault.ts` does — `readOnly` defaulting to `true`, **no** `ClientContext` passed):

| Mutation attempt                 | Required       | Actual           |
| -------------------------------- | -------------- | ---------------- |
| `createNote({ path: 'New.md' })` | ForbiddenError | ForbiddenError ✓ |
| `createSavedView({...})`         | ForbiddenError | ForbiddenError ✓ |
| `updateSavedView(id, {...})`     | ForbiddenError | ForbiddenError ✓ |
| `deleteSavedView(id, {...})`     | ForbiddenError | ForbiddenError ✓ |
| `listSavedViews()`               | allowed        | `[]` ✓           |

The `checkCapability` read-only blocklist now includes `workspace.views.write` (workspace.ts:1807) alongside `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete`. **A view write succeeding here would mean P3E-P1 remains — none succeeded.**

**PASS — P3E-P1 closed.**

## 4. Read-Only Capabilities (behavior ⇄ advertisement)

`getWorkspaceInfo()` on a `readOnly: true` workspace (probe + source, workspace.ts:194-203):

```
capabilities: ['workspace.read', 'workspace.search']
```

and does **not** contain `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete`, or `workspace.views.write`. Advertisement matches enforcement.

**PASS.**

## 5. Standalone Mode (explicitly writable local workspace)

Real local `OpenObWorkspace` with `readOnly: false` (the `useVault.ts` construction — `apps/web/src/hooks/useVault.ts:232, 773, 835`):

create → `view_<uuid32>` ✓ · list ✓ · get ✓ · run (total 3/3) ✓ · update (renamed) ✓ · delete → empty ✓.
`getWorkspaceInfo()` advertises `workspace.views.write`. Works because the workspace is **explicitly constructed writable**, not because the read-only guard leaked.

**PASS.**

## 6. Gateway Read-Only Default (REAL production binary)

`node apps/gateway/dist/bin/gateway.js <vault> --port 0 --token <t>` (no `--scopes`):

- `GET /api/v1/workspace` → 200, `readOnly: true`, capabilities exactly `[workspace.read, workspace.search]`.
- `POST /api/v1/views` → **403**.
- `POST /api/v1/notes` → **403** (gateway is genuinely read-only).
- `GET /api/v1/views` (read/list) → **200**.

No operator action is required to obtain destructive capability — the default stays read-only.

**PASS — default gateway is NOT writable; no security regression.**

## 7. Writable Default Scope Set (product-realistic path, no hidden injection)

Two layers verified:

1. **Server default inference** (`server.ts:281-291`): a non-read-only workspace with no explicit scopes gets `['workspace.read','workspace.search','workspace.write','properties.write','workspace.rename','workspace.delete','workspace.views.write']` — `workspace.views.write` now included. (Committed test `gateway-views-api.test.ts` #5 "Default writable gateway ... infers workspace.views.write and allows Saved View CRUD" — PASS in the 346.)
2. **Real binary with the documented writable invocation** (the exact `--scopes` string from `--help` / `docs/API_CONTRACTS.md`): create → **201**, update → **200**, run → **200 (total 3)**, delete → **200**. No test-only scope injection; this is the operator path from the docs.

**PASS — P3E-P2 (writable defaults) closed.**

## 8. Explicit Scope Restriction (independent denial preserved)

Real binary with explicit `--scopes workspace.read,workspace.search,workspace.write`:

- `POST /api/v1/notes` → **201** (note writes behave per supplied scopes).
- `POST /api/v1/views` → **403**, body `{ code: 'FORBIDDEN', ... }` (view write denied).

Proves note-write capability and view-write capability are **not** collapsed into one implicit permission at the `/api/v1/views` layer.

**PASS at the views API — but see P3E-P4 (§14a) for a scope-separation gap reachable through the note API.**

## 9. Gateway-Managed Web Product Path (real gateway + real web assets + real Chromium)

Playwright e2e `saved-views-board.spec.ts:183` — "Documented default writable gateway allows Web UI to Save, Update, and Delete views without manual scope injection":

- Real production gateway (`startGateway` with `serveWeb: true`, no explicit scopes → server infers writable defaults), real web `dist`, real Chromium.
- Opens Saved Views UI → **Save View → success** (view appears in picker) → **Delete → success**.
- The pre-existing board spec (`saved-views-board.spec.ts:102`) also passes (board render, card-click, live card move, save).

**PASS — 26/26 e2e including both Phase 3E specs.**

## 10. Forged Scope Attack (client cannot self-grant)

Real binary, read-only gateway, `workspace.views.write` attempted via:

| Vector                           | Result             |
| -------------------------------- | ------------------ |
| request body `{ scopes: [...] }` | 403 (no elevation) |
| query parameter `?scopes=...`    | 403 (no elevation) |
| header `x-openob-scopes: ...`    | 403 (no elevation) |
| body scope on note create        | 403 (no elevation) |

Scopes are server-configured only (`server.ts:301` — `scopes: scopes ?? defaultScopes` from `GatewayOptions`, never from request input). MCP exposes read-only tools only (`openob_list_views/get_view/run_view`).

**PASS.**

## 11. Gateway `--help` (REAL built binary)

`node apps/gateway/dist/bin/gateway.js --help` → **exit 0**. Output truthfully documents:

- Options: `--vault`, `--port`, `--host`, `--token`, `--scopes`, `--serve-web`, `--web-dist`, `--help/-h` (all real flags — none invented).
- Full scope vocabulary incl. **`workspace.views.write`** ("Create, update, and delete persisted saved views in .openob/views/").
- Default behavior: "By default, the gateway runs in READ-ONLY mode with scopes: workspace.read, workspace.search" — truthful.
- Writable example matches the docs exactly.

**PASS — no documentation for nonexistent flags.**

## 12. Unknown Flag

`node apps/gateway/dist/bin/gateway.js --definitely-not-a-real-flag` → **exit 1**, stderr: `Error: Unknown or invalid command line option: "--definitely-not-a-real-flag". Use --help for usage.` No silent ignore.

**PASS — P3 CLI defect closed.**

## 13. R3E-3 Comment Accuracy (saved-views create path)

`saved-views.ts:400-403` now reads:

```ts
// Creation safety is guaranteed by high-entropy UUID-based view ID uniqueness and path validation.
// expectedVersion: null indicates no version precondition is required on initial file creation.
```

Verified against `SafeWriter.safeSave` (`packages/vault/src/safe-writer.ts:52-73`): `expectedVersion: null` performs **no** version check — unconditional write, safe only because IDs are `view_<uuid32>` and the path is generated+validated. The comment no longer claims `expectedVersion: null` "ensures absence". **Truthful.**

**PASS.**

## 14. Saved View Security Spot-Checks

| Check                                          | Result                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated-ID filenames                         | `view_<uuid32>.json` only (`generateSavedViewId`, saved-views.ts:38-43)                                                                      |
| Hostile names display-only                     | `../evil`, `..\evil`, `a/b`, `C:\evil`, unicode, 300-char → all land at `.openob/views/view_<uuid>.json`; 120-char name bound enforced (400) |
| Hostile IDs rejected                           | `..%2F..%2F..`, `%2e%2e%2f`, backslash, `a/b`, `....//x`, short `x` → **400** each (live probe)                                              |
| `.openob` hidden from notes/query/search/graph | `listEntries` filters it; `rebuildIndex` skips it; search returns 0 (committed test #5); graph/index build exclude it                        |
| Symlink containment                            | `resolveToDiskSafe` realpath ancestor checks (committed `symlink-security.test.ts` — PASS in the 346)                                        |
| No note-body leakage into views                | envelope = config only (`schemaVersion, id, name, type, filters, sorts, groupBy, visibleProperties, folderScope, createdAt, updatedAt`)      |
| No query-row persistence                       | probe: view file on disk contains no `rows`/`total`/`indexStatus` keys                                                                       |
| No secret persistence                          | probe: view file text does not contain the gateway token                                                                                     |
| **`.openob` isolated from note API**           | **FAIL — see P3E-P4 below**                                                                                                                  |

## 14a. P3E-P4 (NEW — **P1, second canonical write authority / scope-model bypass**)

The **note REST API does not exclude the reserved `.openob/` namespace** in `readNote`, `createNote`, or `updateNote` (only `deleteNote` is incidentally protected, because it forces a `.md` suffix — workspace.ts:1662). `normalizeVaultPath` (packages/core/src/path.ts:11) contains traversal/UNC/drive-letter guards but **no `.openob` guard**. Live probes against the real built gateway, scopes = `workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete` (i.e. **no** `workspace.views.write`):

1. `GET /api/v1/notes/.openob/views/<id>.json` → **200**, returns the full saved-view envelope as a "note". (The original audit §8 recorded 400/404 for this — that appears to have been a false negative: a _missing_ file 404s, but an **existing** view file returns 200. No `.openob` guard exists in the note read path at `ff5b122` either — the code was identical. This is a pre-existing gap the original audit misreported, not a remediation regression.)
2. `POST /api/v1/notes` with `path: ".openob/views/view_<valid-id>.json"` and a **fully valid envelope** (`schemaVersion: 1`, `id`, `name`, `type`, `createdAt`, `updatedAt` numbers) → **201**, and the forged view **appears in `listSavedViews` and runs via `GET /api/v1/views/<id>/query` → 200**. A client with only note-write scope can **create saved views** without `workspace.views.write`.
3. `PUT /api/v1/notes/.openob/views/<id>.json` with the file's version token (obtained from the note-read) → **200**; the view is then **corrupted/destroyed** (`listSavedViews` drops it, `runSavedView` → 400 "corrupted"). A client with only `workspace.write` can **destroy saved views** that the operator deliberately gated behind `workspace.views.write`.
4. `POST /api/v1/notes` with `path: ".openob/evil.md"` → **201** — arbitrary file creation inside the reserved namespace (not indexed, but pollutes it).

**Impact:** the R3E-2 acceptance criterion "explicit scopes can still deny `workspace.views.write` independently" (§8 of this audit) holds at the `/api/v1/views` layer but is **bypassable through `/api/v1/notes`**. This is a second canonical write path into `.openob/views/` with a weaker permission model than the intended `SavedViewStore`/`workspace.views.write` gate, and it permits cross-scope corruption of saved-view state (view deletion-equivalent via overwrite; forged view creation).

**Severity:** **P1** — per the audit's own ladder: "second canonical authority" + authorization-scope separation defeat. Not P0 (no outside-vault write, no filesystem catastrophe, notes untouched, OCC at the file level still applies to the note-write itself).

**Smallest compatible remediation direction (for Gemini):** add a `.openob` guard to the workspace note paths (`readNote`, `createNote`, `updateNote` — and ideally a consistent guard shared with `listEntries`/`rebuildIndex`) rejecting or isolating any path under the reserved `.openob/` prefix, with a regression test asserting note-API create/read/update on `.openob/...` fail while saved-view APIs keep working. (Boundary task; not executed here — audit only.)

## 15. Note Byte Immutability

SHA-256 corpus (BOM+CRLF+unicode+nested `.md`) hashed before/after saved-view **create → update(rename) → delete** through the real gateway: **every path, every hash byte-identical**; raw file contents also re-read and compared byte-for-byte.

**PASS.**

## 16. OCC Regression (real gateway)

| Scenario                                | Result                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Two concurrent updates, same version    | `[200, 409]` — exactly one winner, loser 409                              |
| Stale update (old token after winner)   | **409**                                                                   |
| Update vs delete, same version          | one compatible winner (200), other 409; **no resurrection, no duplicate** |
| Stale delete (old token)                | 409 (or 404 when delete already won)                                      |
| Failed writes → no false `view.*` event | publish happens only after the store call returns (workspace.ts:452-503)  |

**PASS.**

## 17. Board Regression Spot-Check

- One query authority: `BoardView` receives `rows`/`total` from `ViewContainer`'s single `queryNotes` result (no second engine).
- Deterministic grouping: pure `useMemo` over `rows` + `groupBy` (BoardView.tsx:30-97); `No <field>` and `Other / Unsupported` columns; `localeCompare` ordering; numeric-aware sorting.
- Truthful truncation: `BOARD_PAGE_SIZE = 500`, `isTruncated = total > rows.length` with explicit banner (ViewContainer.tsx:38, BoardView.tsx:107).
- Live card move + read-only Board: covered by committed e2e (26/26) incl. external property mutation moving a card without refresh.
- No new evidence of regression; feature not reopened.

**PASS.**

## 18. Full Clean Gate

From clean generated state (`rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci` — 0 vulnerabilities):

| Gate                            | Result                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| `npm run format:check`          | **PASS**                                                                   |
| `npm run lint`                  | **PASS** — 0 errors, 7 pre-existing warnings (unchanged from prior audits) |
| `npm run typecheck`             | **PASS**                                                                   |
| `npm test` (Vitest)             | **PASS — 61 files / 346 tests**                                            |
| `npm run build`                 | **PASS** (gateway + web bundles)                                           |
| `npm run test:e2e` (Playwright) | **PASS — 26/26**                                                           |
| `npm run verify:full`           | **PASS (exit 0)**                                                          |

**Vitest count:** 61 files / 346 tests. **Playwright count:** 26/26.

## 19. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `c83d022` == local HEAD. GitHub web/API return **404** (private repo, no auth token) → actual workflow-run status at this exact HEAD is **not observable** from this environment. Workflow `.github/workflows/ci.yml` runs Node 20.x/22.x matrix (format:check, lint, typecheck, build, packaging checks, test) plus a separate Playwright (Node 22, Chromium) job. CI existence is not denied; the full gate was replayed locally and is green.

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**

---

## 20. Severity Summary

| ID  | Severity                                                                                                                                                                                                                                                     | Status                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| P0  | —                                                                                                                                                                                                                                                            | none                                                           |
| P1  | P3E-P4 — note API second canonical write authority into `.openob/views/`; `workspace.views.write` scope separation bypassable via `/api/v1/notes` (forged view create + view corruption/destruction with note-write scope only); `.openob` readable as notes | **OPEN**                                                       |
| P2  | P3E-P1 (read-only view-write bypass)                                                                                                                                                                                                                         | **CLOSED** (workspace.ts:1807 + useVault.ts `readOnly: false`) |
| P2  | P3E-P2 (views.write absent from writable defaults / undocumented)                                                                                                                                                                                            | **CLOSED** (server.ts:281-291, docs, `--help`)                 |
| P2  | OCC regression                                                                                                                                                                                                                                               | none found                                                     |
| P3  | P3E-P3 comment                                                                                                                                                                                                                                               | **CLOSED** (saved-views.ts:400-401 truthful)                   |
| P3  | gateway `--help` / unknown-flag strictness                                                                                                                                                                                                                   | **CLOSED** (exit 0 / exit 1)                                   |

---

## 21. Verdict

**STOP — exact blocker: P3E-P4 (P1).**

All three remediation items (R3E-1, R3E-2, R3E-3) are correctly implemented and individually verified: read-only workspace rejects every view write context-less; standalone mode works via explicit writable construction; default gateway stays read-only; documented writable gateway serves the full Saved View CRUD without hidden scope injection; explicit scopes still deny `workspace.views.write` at the views API; the scope vocabulary is documented and `--help` is truthful; unknown flags fail fast; the create-comment is accurate; OCC/Board/security spot-checks pass; note bytes are untouched; `format:check` and `verify:full` pass from a clean install (61 files / 346 Vitest, 26/26 Playwright).

**The blocker is new, pre-existing (not a remediation regression), and outside the three R3E items as scoped:** the note REST API can read (`200`), forge-create (`201`, view then lists+runs), and corrupt/delete (`200` via overwrite) files under the reserved `.openob/views/` namespace using only note-write scopes — defeating the `workspace.views.write` gate the original audit's §8 isolation contract and R3E-2's independent-denial criterion require. The original audit's §8 claim that `.openob` "cannot be read as a note (400/404)" does not hold for existing files and was a false negative; the guard never existed in the note paths.

Until P3E-P4 is remediated (a `.openob` guard on the workspace note paths + regression tests) and re-audited, the Phase 3E closure verdict **cannot** be issued as SAVED VIEWS + BOARD FOUNDATION COMPLETE.

Phase 3F not audited per instruction.
