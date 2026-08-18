# OpenOb — Phase 3E Saved Views + Board Adversarial Audit

**Audited HEAD:** `ff5b122824acec06d613e8d8f95fe00adff71d2e` (`ff5b122 feat(views): implement saved views persistence, OCC, and read-only Board view (Phase 3E)`) — verified `origin/main` == local HEAD via `git ls-remote`.
**Audit mode:** read-only; no production code modified; temporary probes built from current source, run, and removed; working tree clean.
**Scope:** Phase 3E (Saved Views + Board) only. Phase 3F not audited. Phase 3D re-opened only for the closure-hygiene check (§24), no new 3D evidence required.

---

## 1. Baseline

| Step                                                 | Result                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `git rev-parse HEAD`                                 | `ff5b122`; `origin/main` == `ff5b122`                     |
| Working tree                                         | clean at audit start and end                              |
| `rm -rf apps/gateway/dist packages/*/dist && npm ci` | PASS (0 vulnerabilities)                                  |
| `npm run format:check`                               | **PASS**                                                  |
| `npm run lint`                                       | PASS (0 errors / 7 pre-existing warnings)                 |
| `npm run typecheck`                                  | PASS                                                      |
| `npm test`                                           | **PASS — 61 files / 340 tests** (matches Phase 3E report) |
| `npm run build`                                      | PASS (2.39s)                                              |
| `npm run test:e2e`                                   | **PASS — 25/25** (incl. `saved-views-board.spec.ts`)      |
| `npm run verify:full`                                | **PASS (exit 0)**                                         |

(The one transient test failure and format warning observed mid-audit were caused by the temporary audit probe files themselves being inside vitest's `tests/**` glob; after probe removal the clean gate passes entirely.)

## 2. Phase 3D Must Stay Closed

- Strict mixed-type comparisons: Phase 3D matrix tests still green within the 340 (query-engine R3D-1 suite).
- Memory/SQLite parity: differential suite green.
- Table/List/Board equivalence: all three render from the single `queryResult` state in `ViewContainer` (lines 683-715), same `backend.queryNotes` authority.
- Query read-only authority: unchanged; `runSavedView` executes `executeProtocolPropertyQuery` on the live index.
- Format gate: green (see §1).
- **No Phase 3D regression found; Phase 3D remains closed.**

## 3. Saved View Storage Authority

Traced end-to-end:

- **Web (gateway mode):** `ViewContainer` save/load → `WorkspaceBackend.createSavedView/updateSavedView/deleteSavedView/runSavedView` → `GatewayWorkspaceBackend` → `OpenObGatewayClient` → `POST/PUT/DELETE /api/v1/views...` → `server.ts` → `workspace.*SavedView` → `SavedViewStore` → `SafeWriter.safeSave` / `storage.remove`.
- **Web (standalone):** same backend interface → `LocalWorkspaceBackend` → `OpenObWorkspace` directly (same store).
- **MCP:** `openob_list_views` / `openob_get_view` / `openob_run_view` only — read-only; no `.openob` write path exists in MCP.
- **CLI:** `openob views list|get|run` → REST client only (verified `runCliRemote`); CLI has no view-mutation commands.
- **Rejected patterns:** no UI direct filesystem writes; no MCP `.openob` writes; no CLI direct vault access; **no `localStorage` saved views** (only `okw_ai_provider` preference and `openob_gateway_*` session connection state exist in the web app).

**PASS — single authority: everything routes through `OpenObWorkspace` → `SavedViewStore` → `SafeWriter`.**

## 4. Saved View Content (`.openob/views/<id>.json`)

Envelope shape (verified from written files): `{ schemaVersion: 1, id, name, type, filters, sorts, groupBy, visibleProperties, folderScope, createdAt, updatedAt }` — configuration only.

- **No** note bodies, query-result rows, index snapshots, secrets, bearer tokens, or absolute filesystem paths (probe: file text of a saved view contains no note content, no `rows`/`total`/`indexStatus` keys).
- Index delete/rebuild leaves views untouched (committed `saved-views-persistence.test.ts` #2; probe #6 restarts a fresh workspace over the same storage and all valid views survive).

**PASS.**

## 5. Notes Remain Untouched

Probe: SHA-256 of every `.md` file in a corpus containing BOM + CRLF + unicode + nested files, hashed before and after saved-view **create → update(rename) → delete → create(board)** through the real REST gateway — **byte-identical corpus** (every path, every hash equal).

**PASS — any note mutation from saved-view CRUD would be P1; none found.**

## 6. OCC

Probe against the real gateway (plus committed `saved-views-concurrency.test.ts` 3/3):

| Scenario                              | Result                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Two concurrent updates, same version  | `[200, 409]` — exactly one winner, loser gets `CONFLICT`                  |
| Update vs delete, same version        | one compatible winner (`200`), other `409`; no resurrection, no duplicate |
| Stale update (old token after winner) | `409 CONFLICT`                                                            |
| Stale delete (old token)              | `409 CONFLICT`                                                            |
| Double delete                         | second → `404`/`409`                                                      |
| JSON corruption                       | none — SafeWriter + per-view lock (`withViewLock`)                        |

**PASS — no force/retry paths; OCC is pre-flight checked (store) plus re-checked at write time (SafeWriter).**

## 7. Path Safety

- Filenames are **generated IDs only**: `view_<uuid32>` (`generateSavedViewId`), regex-validated `/^[a-zA-Z0-9_-]{4,64}$/` on any user-supplied ID (`validateViewId`).
- Hostile **IDs** in URLs (`..%2F..%2F..`, `%2e%2e%2f`, backslash, `....//`) → **400** (probe).
- Hostile **names** (`../evil`, `..\evil`, `a/b`, `a\b`, `/abs`, `C:\evil`, `\u0000null`, unicode, 300 chars): names are display-only JSON fields — every view still lands at `.openob/views/view_<uuid>.json`; 300-char name → 400 (bounds); **no outside-vault write** (probe enumerated `.openob` contents).
- Symlink escape: `NodeFsVaultStorage.resolveToDiskSafe` enforces `realpath` containment incl. ancestor checks → symlinked `.openob/views` pointing outside the vault throws `SecurityError` (same machinery as the existing `symlink-security.test.ts`).

**PASS.**

## 8. Reserved `.openob` Isolation

Probe + committed test (#5 unit, persistence #2): `.openob/views/*.json` —

- never appears in the ordinary note tree (`listEntries('')` filters it),
- never appears in property query results (even `folderScope: '.openob'` → `total: 0`),
- never appears in search (`search({query:'schemaVersion'})` → 0),
- cannot be read as a note (`GET /api/v1/notes/.openob/...` → 400/404),
- no graph node / no wikilink participation (index build skips `.openob/` — `rebuildIndex` filters, and `rebuildVaultIndex` shares the same scanner).

**PASS.**

## 9. Authorization

| Scenario                                                                         | Result                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| No token → view mutation                                                         | 401 (probe)                                                            |
| Bad token                                                                        | 401 (probe)                                                            |
| Default read-only gateway → view mutation                                        | 403 (committed gateway test #2)                                        |
| `workspace.write` **without** `workspace.views.write` (server-configured scopes) | **403** (probe)                                                        |
| Forged client scopes                                                             | impossible — scopes are server-configured only (`server.ts:300`)       |
| MCP self-grant                                                                   | impossible — MCP exposes read-only tools only, no create/update/delete |

**PASS on the scopes mechanism.** One gap found — see **P3E-P1** (read-only workspace guard omits `workspace.views.write` for context-less calls).

## 10. Corrupted View

Probe: wrote a truncated/garbage JSON view on disk, restarted the workspace/gateway over the same storage:

- `listSavedViews` — corrupt file silently skipped; valid sibling views present.
- `getSavedView` on the corrupt id — truthful **400** (InvalidRequestError "corrupted or contains an invalid schema"), no crash, no 500.
- Other saved views run fine; notes query fine (3/3 notes).
- The corrupt file is **not** silently rewritten/destroyed by reads (bytes verified unchanged).

**PASS.**

## 11. Saved View Semantics

Probe: saved view `{filters: status=active, sorts: priority asc}` —

- `runSavedView` result paths == direct `queryNotes` with the same config (exact set equality).
- The view file contains configuration only — no cached rows/materialized results.
- After mutating a note's property (`status: inactive → active` via REST `setProperty`) and re-running the same view, the result **reflects the current index** (`note-b.md` appears).
- `indexStatus` propagates truthfully from `workspace.indexHealth`.

**PASS — a saved view is a query config, never a row cache.**

## 12. Board Query Authority

`BoardView` receives `rows` (and `total`) as props from `ViewContainer` — the exact same `queryResult` produced by `backend.queryNotes` (single engine, single query, same as Table/List). Rejected patterns absent: no client-side filesystem scanning, no second query engine, no different filter semantics, no Markdown parsing in Board.

**PASS.**

## 13. Board Grouping

Code-inspected grouping semantics (`BoardView.tsx`):

| Value                     | Column                                         |
| ------------------------- | ---------------------------------------------- |
| missing / `null` / `''`   | `No <field>` (last column)                     |
| string / number / boolean | `String(value)` — direct, no `[object Object]` |
| array (empty)             | `No <field>`                                   |
| array (single scalar)     | that element                                   |
| array (multi/complex)     | `Other / Unsupported`                          |
| object/map                | `Other / Unsupported`                          |

Deterministic (pure function of `rows` + `groupBy` in a `useMemo`); each row lands in exactly one column (no duplicate cards); unicode column names preserved (`localeCompare` for ordering).

**PASS.**

## 14. Board Ordering

- Regular columns sorted: numeric when both names numeric, else `localeCompare`; `Other / Unsupported` then `No <field>` always last — deterministic across identical results.
- Cards inside each column preserve the query's sort order (rows pushed in query order).
- E2E 25/25 includes repeated render stability via the live-update spec.

**PASS.**

## 15. Board Truncation

`ViewContainer` uses `BOARD_PAGE_SIZE = 500` (limit 500, offset 0) for board queries; `BoardView` renders `isTruncated = total > rows.length` → explicit banner _"Showing first {rows.length} of {total} cards. Refine filters to display the complete board."_ `total` remains the truthful full match count. No silent omission, no unbounded 10k-card render.

**PASS.**

## 16. Table / List / Board Equivalence

Same `ViewConfig` (folderScope + filters + sorts) → same `queryResult` → same matching path set in all three views; grouping changes layout only. Presentation switch does not re-run different filter semantics (single `runQuery`).

**PASS.**

## 17. Live Board

Committed e2e `saved-views-board.spec.ts` (real Chromium + real gateway): connects, renders Board columns, card-click navigation, saves a view, then an external property mutation moves a card to the correct group **without refresh** (change stream → `refreshKey` → re-query → re-render). The mutation in the spec is performed via REST (the same event stream an MCP change would produce); Markdown property remains authoritative — no optimistic local fake move.

**PASS.**

## 18. Saved View Live Events

`view.created` / `view.updated` / `view.deleted` are published by the workspace **only after successful persistence** (workspace.ts:452-503) and flow through the SSE change stream (server.ts generic `sendEvent`). `ViewContainer` re-fetches saved views on `refreshKey` (bumped by every stream event), so the picker updates. Locally-dirty builder state (filters/sorts/etc.) is only ever overwritten by explicit `handleLoadSavedView` — external updates merely refresh the version token; **external update/delete never overwrites local builder state** (verified at source; 409 handling preserves configuration).

**PASS.**

## 19. External Delete

If the active saved view is deleted externally: `fetchSavedViews` marks `isDeletedRemotely` → red banner _"deleted externally. Your current query is preserved."_ + explicit **Save As New** action (creates a new ID). Ordinary save cannot silently resurrect the old ID: `updateSavedView` requires a matching token and `getSavedView` throws `NotFoundError` on a missing file; a subsequent update attempt yields an error rather than a silent recreate.

**PASS.**

## 20. Event Privacy

`view.*` events carry only `{ type, viewId, operation, version, requestId, clientId }` — no query config, no tokens, no note content, no secrets, no absolute paths. Failed OCC mutations throw before the publish call → **no successful `view.*` event is emitted for a failed mutation** (workspace.ts publish happens after the store call returns).

**PASS.**

## 21. Standalone Mode

No gateway: the local `OpenObWorkspace` (MemoryDocumentIndex) + `LocalWorkspaceBackend` create/list/get/run/delete saved views with identical semantics; no `localStorage` canonical persistence (state is React + `.openob/views/` files). Close/reopen survives (committed persistence test #1). Board renders from the same local `queryResult`.

**PASS functionally — but see P3E-P1 for the read-only-workspace consistency gap this mode exposes.**

## 22. CLI / MCP

- CLI `openob views list|get|run [--json]` — routes through `OpenObGatewayClient` (REST); results equal REST/Web behavior (committed gateway test #4 + probe CLI parity in Phase 3D round).
- MCP `openob_list_views` / `openob_get_view` / `openob_run_view` — route through `workspace.*` with the gateway context; results equal REST behavior (committed test #3).
- No direct metadata-file access in either.

**PASS.**

## 23. Degrade / Recover

- Saved-view configs live in `.openob/views/` (independent of the derived index) → remain available while the index is degraded.
- `runSavedView` returns `indexStatus` from `workspace.indexHealth` (truthful degraded flag); `ViewContainer` shows the amber degraded banner for board/table/list alike.
- `index.recovered` bumps `refreshKey` → saved-view list re-fetch + query re-run.

**PASS.**

## 24. P3D Doc Hygiene

`PHASE3D_REMEDIATION_CLOSURE_REPORT.md` no longer contains the dangling `ad9608a6...` SHA; it now records the accurate pair: remediation implementation `64e102c` and closure-audit HEAD `e582250`. **P3D-P1/P3D-P2 remain closed.** (Not treated as reopening Phase 3D.)

**PASS.**

## 25. Full Gate

| Gate           | Result                                    |
| -------------- | ----------------------------------------- |
| `format:check` | PASS                                      |
| `lint`         | PASS (0 errors / 7 pre-existing warnings) |
| `typecheck`    | PASS                                      |
| `test`         | PASS (61 files / 340 tests)               |
| `build`        | PASS                                      |
| `test:e2e`     | PASS (25/25)                              |
| `verify:full`  | **PASS (exit 0)**                         |

**ALL PASS from a clean install.**

## 26. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `ff5b122` == local HEAD. GitHub web/API return 404 (private repo, no token) → actual workflow-run status at this exact HEAD is not observable from this environment. Workflow file (`.github/workflows/ci.yml`) runs Node 20/22, Playwright, packaging. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.** CI existence is not denied; the full gate was replayed locally and is green.

## 27. Severity Mapping

- **P0:** none.
- **P1:** none — no note mutation, no second canonical authority, no saved-view-overwrites-notes, no auth bypass at the gateway, no outside-vault write.
- **P2:**
  - **P3E-P1** — read-only workspace capability guard omits `workspace.views.write` (workspace.ts:1801-1807): a read-only `OpenObWorkspace` invoked without a client-scope context permits saved-view create/update/delete, contradicting its own advertised capabilities (`[workspace.read, workspace.search]` only). Verified live: same workspace → `createNote` Forbidden, `createSavedView` succeeded. The standalone web mode works only by virtue of this gap; genuinely read-only vault mounts leak `.openob` writes to context-less callers.
  - **P3E-P2** — `workspace.views.write` is undocumented and absent from the default scope sets: server.ts default writable scopes omit it; the production gateway default (`gateway.ts:60`) is read-only `[workspace.read, workspace.search]`; the gateway binary has no `--help`; no doc (API_CONTRACTS/SECURITY/CONTEXT/EXTERNAL_ACCESS) mentions scopes. In default gateway-managed web mode, the Save-View UI **always gets 403**; the feature is unreachable without operator configuration that nothing documents. Committed tests/e2e mask this by injecting the scope explicitly.
- **P3:** **P3E-P3** — `saved-views.ts` create comment _"Expected absence (null) ensures we don't accidentally overwrite"_ is inaccurate: `safeSave({ expectedVersion: null })` performs **no** version check (unconditional write); safe only because generated UUIDs do not collide. Also: gateway binary lacks any `--help` output (pre-existing).

## 28. Findings (numbered)

**P0/P1: none.**

**P3E-P1 (P2, authorization consistency):** `checkCapability` (workspace.ts:1800-1818) read-only guard list covers `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete` — but **not `workspace.views.write`**. Live reproduction: an `OpenObWorkspace` constructed exactly as the standalone app does (`readOnly` unset → `true`) rejects `createNote` (Forbidden) yet accepts `createSavedView`/`updateSavedView`/`deleteSavedView` when no client context is supplied. The workspace advertises `capabilities: [workspace.read, workspace.search]` while enforcing no view-write restriction context-less. Gateway mode is safe (server always injects scopes); the defect surface is context-less callers (local backend, direct API use, MCP-less embedding) against intentionally read-only mounts.

**P3E-P2 (P2, ops/config + documentation):** `workspace.views.write` required for view mutation but (a) not in `server.ts` default writable scopes, (b) not in the production gateway's default scopes (read-only by default), (c) documented nowhere (no gateway help, no doc file mentions scopes). Result: **default gateway-managed mode cannot save/update/delete views (403)**; the Phase 3E flagship feature is operator-unreachable without undocumented configuration. All committed tests/e2e inject the scope explicitly, so the default-path defect is untested.

**P3E-P3 (P3, docs/comment):** `saved-views.ts:400-403` comment misstates `expectedVersion: null` semantics; recommend clarifying the comment (create is safe by generated-ID uniqueness, not by absence-check). Gateway binary lacks `--help` (pre-existing).

## 29. Verdict

**SAVED VIEWS + BOARD FOUNDATION COMPLETE — CONDITIONAL.**

All architectural gates pass with independent evidence: saved views are durable configuration only (`schemaVersion: 1`, config fields, no rows/bodies/secrets); Markdown byte-identical across view CRUD; OCC safe (single winner, 409s, no resurrection, no corruption); `.openob` namespace fully isolated (never a note/query/search/graph/wikilink); Local/Gateway semantics agree; Board is a pure presentation of the existing query authority with deterministic grouping/ordering and truthful 500-cap truncation; live view/Board updates work over SSE (e2e 25/25); CLI/MCP read-only and REST-routed; degraded-index truthful; P3D closure hygiene fixed; `verify:full` green from clean install.

**Exact blockers to flip to unconditional:**

1. **P3E-P1** — read-only workspace guard must also enforce `workspace.views.write` (or the standalone workspace must be constructed as explicitly non-read-only so the guard list and the mode's actual role agree; both together keeps standalone view CRUD working while closing the read-only-mount leak).
2. **P3E-P2** — `workspace.views.write` must be documented and included in the writable-gateway default scope set (or the web UI must surface a truthful "gateway lacks views.write" state), otherwise saved views are unreachable in default gateway-managed mode.

Phase 3F not audited per instruction. See `ANTIGRAVITY_PHASE3E_REMEDIATION.md`.
