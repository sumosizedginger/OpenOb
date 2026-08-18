# OpenOb — Phase 3D Query + Table/List Adversarial Audit

**HEAD:** `ff6d0aa4a822936925be4cee076d27eb50a73c23` (`ff6d0aa feat(phase-3d): property query foundation and table/list views`)

**Audit mode:** read-only; no production code modified; temporary probes built from current source, run, and removed; working tree clean.

## 0. Re-audit Verification Run (same HEAD, adversarial re-execution)

Fresh adversarial re-execution of this audit against the same `main` HEAD (`ff6d0aa`), clean-installed from scratch. All prior findings reproduced with new live evidence; no new findings beyond the original set. No production code was modified.

| Step                                                 | Result (this run)                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD`                                 | `ff6d0aa` — unchanged; working tree clean apart from this audit doc, `ANTIGRAVITY_PHASE3D_REMEDIATION.md`, and the environment's `reasonix.toml` permission allowlist (non-production) |
| `rm -rf apps/gateway/dist packages/*/dist && npm ci` | PASS (exit 0, 0 vulnerabilities)                                                                                                                                                       |
| `npm run format:check`                               | **FAIL — `PHASE3D_QUERY_TABLE_LIST_REPORT.md` not Prettier-clean (P3D-P2 reproduced)**                                                                                                 |
| `npm run lint`                                       | PASS (0 errors, 8 pre-existing `react-hooks/exhaustive-deps` warnings)                                                                                                                 |
| `npm run typecheck`                                  | PASS                                                                                                                                                                                   |
| `npm test`                                           | PASS — 57 files / 317 tests (incl. `query-differential.test.ts`, `notion-views.test.ts`, `scale-benchmark.test.ts`)                                                                    |
| `npm run build`                                      | PASS (2.48s)                                                                                                                                                                           |
| `npm run test:e2e`                                   | PASS — 24/24, incl. `gateway-views.spec.ts` Phase 3D live table-update spec                                                                                                            |
| `npm run verify:full`                                | **FAIL at `format:check` — single cause P3D-P2**                                                                                                                                       |

**Live REST probe (real gateway + SQLite index + temp vault, 12 seeded notes), fresh this run:**

- **P3D-P1 reproduced exactly.** `f > 10` matched `["expo.md","junk.md","march.md","num.md"]` — `f:'hello'` and `f:'March-ish'` match a numeric target. `d > 2026-08-01` matched `["baddate.md","falsy.md","junk.md","march.md","num.md"]` — `'2026-99-99'`, `false`, `'hello'`, `'March-ish'` all match a date target. Source: query-engine.ts:185/201 localeCompare fallback.
- **NEW coercion evidence (same root cause, P3D-P1 scope):** `f > -1` matched `f:''` (`Number('') === 0`); `f > 100` matched `f:'1e3'` (`Number('1e3') === 1000`); and the incoherence is stark: `f > 1000` matched `f:'hello'`/`f:'March-ish'` via `localeCompare` while `f:'1e3'` (numerically exactly 1000) did **not** match. Same junk-string/`Number()` coercion path at query-engine.ts:180-185 / 196-201.
- **Folder scope:** `folderScope:'foo'` returned only `foo/bar/deep.md` (exact boundary; `scope-foobar.md` excluded); `folderScope:'../'` → **400** `INVALID_PATH` ("Path traversal attempt detected").
- **Pagination:** `limit:0` → 1 row (limit reported 1, P3D-P4); `limit:1e6` → capped at 500; `offset:-5` → offset 0, full page; `offset:99999` → 0 rows, `total` correct.
- **Auth:** no token → 401; bad token → 401.
- **SQL-injection shapes** (field name `x' OR 1=1 --`, sort field `y; DELETE FROM documents`, value `' OR '1'='1`) → all 200 with safe/inert results; corpus fully served after (14/14 notes).
- **Privacy:** response payload contains no note bodies, no absolute paths, no vault path.

**Re-verified at source (no changes since first audit):** single query authority (`ViewContainer → backend.queryNotes → workspace.queryNotes → executeProtocolPropertyQuery`; MCP `openob_query_notes` → same; CLI → REST client → same); query path strictly read-only (`checkCapability('workspace.read')` + index read only); scopes server-configured (`server.ts:300`, never client-forged); SSE subscription gated on `GatewayWorkspaceBackend` (standalone never subscribes, useVault.ts:455-462); dirty editor buffers preserved by event handler (useVault.ts:500-550); degraded-index banner + `index.recovered` auto-refresh (ViewContainer.tsx:161, useVault.ts:477-479); BoardView unwired; no saved-view persistence (only `openob_gateway_url`/`openob_gateway_token` session storage for connection state).

**Net:** prior verdict stands — **QUERY + TABLE/LIST FOUNDATION COMPLETE — CONDITIONAL**, same two P2s (P3D-P1 filtering, P3D-P2 gate), now with independent live evidence.

## 1. Baseline

| Step                                                 | Result                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `git rev-parse HEAD`                                 | `ff6d0aa` (Phase 3D implementation commit)                                           |
| `rm -rf apps/gateway/dist packages/*/dist && npm ci` | PASS                                                                                 |
| `npm run format:check`                               | **FAIL — tracked `PHASE3D_QUERY_TABLE_LIST_REPORT.md` is not Prettier-clean** (P2-2) |
| `npm run lint`                                       | PASS — 0 errors, 8 pre-existing `react-hooks/exhaustive-deps` warnings               |
| `npm run typecheck`                                  | PASS                                                                                 |
| `npm test`                                           | PASS — 57 files / 317 tests                                                          |
| `npm run build`                                      | PASS (2.47s)                                                                         |
| `npm run test:e2e`                                   | PASS — 24/24 (incl. committed `gateway-views.spec.ts` live-update test)              |

## 2. Query Authority

**PASS — single query authority in all modes.**

- **Web (gateway mode):** `ViewContainer → backend.queryNotes(queryDto)` → `GatewayWorkspaceBackend.queryNotes` → `OpenObGatewayClient` → `POST /api/v1/query` → `server.ts` → `workspace.queryNotes` → `executeProtocolPropertyQuery(this.index, …)`.
- **MCP:** `openob_query_notes` → `workspace.queryNotes` (gateway-mode MCP proxies through the REST client; bundle verified to contain only `OpenObGatewayClient`/`/api/v1/query` refs, zero storage/index/fs symbols).
- **CLI:** `openob query` → REST gateway (pure client).
- **Local/Standalone:** `LocalWorkspaceBackend.queryNotes` → `workspace.queryNotes` over the `MemoryDocumentIndex` (derived state); the shared `ViewContainer` entry point is `backend.queryNotes(queryDto)` in both modes — verified statically (`backend.ts`, `useVault.ts:216`, `ViewContainer.tsx:93`).
- **No second gateway-mode browser query authority exists** — no index in the browser in gateway mode, no OPFS/FSA query path.

## 3. Canonical State

**PASS — query/table/list code is strictly read-only.**

- `queryNotes` requires `workspace.read`, calls only `index.getAll()` + in-memory filter/sort/paginate; no Markdown/VaultStorage/SafeWriter/NoteWriteCoordinator touch.
- Table/List components (`TableView`/`ListView`/`ViewContainer`) call only `backend.queryNotes` + `discoverProperties`; no persistence of view content; no hidden copies of note bodies (query rows carry `path,title,properties,tags,wordCount,lineCount` only).
- The frontmatter writer/parser round-trip serializes nested objects as JSON strings (see P3D-P3) — values are query-consistent strings, never a second database.

## 4. Query Engine Reuse

**PASS — one implementation, one semantics.**

- Single `executeProtocolPropertyQuery` (query-engine.ts:276) serves REST, MCP, CLI, and web. One `matchPropertyFilter`, one `sortDocuments`, one `matchesFolderScope`.
- Memory/SQLite differential suite green: `query-differential.test.ts` + `query-engine.test.ts` + `gateway-query.test.ts` — 24/24.

## 5. Filter Semantics

**PASS on typed paths; P2 finding on mixed-type ordering (see §Findings).**

Real-REST matrix (8 operators × string/number/boolean/null/array/missing/empty):

- `equals`/`not_equals`: exact typed equality; `'hello' ≠ 42`; booleans matched only via boolean parsing (`'false'` string ≠ `true`); arrays match if any element equals.
- `contains`/`not_contains`: substring on strings, element-substring on arrays; null/missing excluded.
- `greater_than`/`less_than`: numeric on numbers, ISO-date on dates, localeCompare fallback on mixed types (**P3D-P1**).
- `is_empty`/`is_not_empty`: null, missing, `''`, `[]`, `{}` are empty; others not.

## 6. Date Semantics

**PASS on ISO; P2 finding on mixed-type fallback.**

- `isIsoDate` = strict `^\d{4}-\d{2}-\d{2}([T\s]…Z|±hh:mm)?$` + `Date.parse` validation → `'2026-99-99'`, `'hello'`, `'March-ish'`, `'01/02/03'`, `'false'` are NOT dates.
- ISO-vs-ISO comparisons verified (2026-08-17 > 2026-08-01; 2026-01-01T12:00:00Z not).
- **P3D-P1:** when the target is a valid ISO date (or number) but the value is a non-ISO string, the engine falls back to `localeCompare` — `date > 2026-08-01` matches `'hello'`, `'March-ish'`, `'false'`, `'2026-99-99'`; `f > 10` matches `f: 'hello'`. Materially incorrect matches for date/numeric fields with junk string values.

## 7. Object / YAML Edge Cases

**PASS (truthful, documented behavior).**

- No crash on nested maps; `equals '[object Object]'` matches nothing (guard at query-engine.ts:93).
- `serializeYamlValue` (frontmatter.ts:192) JSON-stringifies nested objects; the line-based `parseFrontmatter` reads them back as **strings** — so `contains 'nested'` matches the JSON-string representation (consistent string semantics, P3D-P3 note; no structured-object query, which is truthful to the storage format).
- SQL-injection-shaped field names/values are inert (see §12).

## 8. Folder Scope

**PASS — boundary exact, no traversal, no escape.**

- `foo` ≠ `foobar` (no prefix alias); `foo/bar/note.md` included; `ünïcødé` unicode works.
- `..`, `../foo` → **400** (`normalizeVaultPath` throws `SecurityError` on root traversal, path.ts:48); `foo/../bar` → resolves inside vault (no escape); `....//..` → empty result; `/foo` and `foo/` normalize to `foo`; `foo\bar` canonicalizes to `foo/bar` (Windows path handling, in-vault).

## 9. Deterministic Sorting

**PASS.** 30 rows with identical primary sort value → identical ordering across repeated runs; stable path tie-breaker (lexicographic); pagination pages compose to the full order with no shuffle/duplicate; missing values sort last in ASC (documented in `compareScalars`).

## 10. Pagination

**PASS (bounded).** default limit 100 (≤50 asserted bounded), max clamp 500, negative limit → 1, `limit: 0` → **clamped to 1** (P3D-P4 note), `limit: 1_000_000` → capped at 30 rows (no unlimited response), offset beyond total → 0 rows, negative offset → 0. `total` = full match count; `rows` = page count.

## 11. Memory vs SQLite Differential

**PASS.** Identical corpus, broad filter/sort/scope matrix — same matching paths, same deterministic order, same pagination (committed differential suite 24/24). No semantic divergence.

## 12. SQL Injection

**PASS — structurally impossible.**

- Query filtering/sorting/scoping happen **in memory** after `index.getAll()` — there is no filter pushdown to SQL.
- SQLite index statements are fully parameterized (`?` placeholders; `sql.exec` only on constant strings) — verified in sqlite-index.ts.
- 7 attack shapes (quotes, comments, `DROP TABLE`, `OR 1=1` in field/value/scope/sort) all returned 200 with safe results; vault intact after; corpus fully served after.

## 13. Index Degraded

**PASS — truthful.**

- Injected `index.upsert` failure → `createNote` returns `durableSuccess:true, indexStatus:'degraded'`; subsequent `queryNotes` returns `indexStatus:'degraded'` (no false "verified").
- `rebuildIndex` → back to `verified`.
- UI renders an amber banner: _"Derived index is currently degraded. Query results may be partial or stale."_ (ViewContainer.tsx).
- `index.recovered` event bumps `eventRefreshCounter` → ViewContainer automatically re-queries (useVault.ts:467-479).

## 14. Live Table Update

**PASS — real gateway + Chromium + MCP-equivalent client.**

- Filter `status = active`; A(active)/B(inactive) → table shows A only. MCP flips B→active, A→inactive → **without any refresh**, table shows B only (row set flipped, row count 1). Rename B→B2, delete A, create C(active) → table follows each structural change via the change stream.
- Committed `gateway-views.spec.ts` (external property change reflected in table) also green.

## 15. Dirty Editor Interaction

**PASS.** Human dirty buffer on D.md; MCP property change → editor still contains the exact human draft, disk untouched (server content authoritative), event handler only sets conflict status/reads disk content for the conflict modal — it never overwrites the buffer (useVault.ts:600-650). No event-driven query refresh can touch the editor.

## 16. Table/List Equivalence

**PASS.** Same `ViewConfig` → identical matching note set in Table and List (EqA present in both, EqB inactive absent from both). Presentation differs; filtering semantics identical (same `backend.queryNotes`).

## 17. Authorization

**PASS.** `POST /api/v1/query`: no token → 401, bad token → 401. Read-only gateway (workspace.read,search only): query 200, note create → 403. MCP cannot forge scopes (server-side scope enforcement). Query grants zero mutation capability (read-only path, no side effects).

## 18. Data Privacy

**PASS.** Query payload contains no note bodies (`body content SECRET_IN_BODY_ONLY` absent), no bearer token, no absolute paths, no gateway secrets. Row shape: `path,title,properties,tags,wordCount,lineCount[,version]`.

## 19. 10,000 Notes

**PASS (with environment note).** Committed 10k SQLite benchmark and 1k-file real pipeline pass on idle runs (2/2 repeat). One isolated run measured 785ms vs 500ms threshold under concurrent probe load — same environmental timing-flake class documented in Phases 3A/3B (machine runs ~20 IDE node processes); no algorithmic rescan of canonical files in the query path (queries operate on the derived index in memory).

## 20. Live Event Storm

**PASS.** 30-note burst → **29-30 `POST /api/v1/query` requests (≈1:1 with events, bounded)**; final table shows all 30 storm notes (authoritative); request count stable after settling (no runaway loop; queries are reads, no feedback cycle). No debounce/coalescing in the view (one re-query per event is bounded 1:1) — acceptable per spec; P3 note.

## 21. Standalone Mode

**PASS.** Local mode = `MemoryDocumentIndex` + `LocalWorkspaceBackend` wrapping `OpenObWorkspace` (useVault.ts:216/233); the shared `ViewContainer` runs the same `backend.queryNotes` against the local index; no gateway, no SSE subscription in local paths.

## 22. No Saved-View Backdoor

**PASS.** No `localStorage` persistence of view definitions/filters/sorts/columns; no hidden `.openob` state file; view state is transient React state only.

## 23. No Board Scope Creep

**PASS.** `BoardView.tsx` exists but is **unwired** (imported nowhere, absent from the view switcher); no Kanban/board behavior shipped in Phase 3D. `groupDocumentsByProperty` remains a dormant helper.

## 24. Full Gate

| Gate           | Result                                                                     |
| -------------- | -------------------------------------------------------------------------- |
| `format:check` | **FAIL — tracked `PHASE3D_QUERY_TABLE_LIST_REPORT.md` unformatted (P2-2)** |
| `lint`         | PASS (0 errors / 8 pre-existing warnings)                                  |
| `typecheck`    | PASS                                                                       |
| `test`         | PASS (57 files / 317 tests)                                                |
| `build`        | PASS                                                                       |
| `test:e2e`     | PASS (24/24)                                                               |
| `verify:full`  | **FAIL at format:check step — same single cause**                          |

## 25. Remote CI

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — GitHub API 404 for both actions-runs and repo endpoints (private repo). Not claimed non-existent; full gate replayed locally.

## 26. Severity Mapping

- **P0:** none.
- **P1:** none — no filesystem escape, no query mutation, no SQL injection impact, no auth bypass, no dirty-buffer destruction, no second authority.
- **P2:** P3D-P1 (incorrect filtering via mixed-type localeCompare fallback); P3D-P2 (tracked doc breaks `format:check`/`verify:full` gate).
- **P3:** P3D-P3 (nested objects stored/queried as JSON strings — document); P3D-P4 (`limit: 0` clamps to 1); P3D-P5 (no view re-query debounce; 1:1 per event, bounded).

## 27. Findings

**P0/P1: none.**

**P3D-P1 (P2, incorrect filtering):** `greater_than`/`less_than` fall back to `String.localeCompare` when value and target types mismatch. Evidence (real REST): `f > 10` matches `f:'hello'`; `date > 2026-08-01` matches `'hello'`, `'March-ish'`, `'false'`, `'2026-99-99'`. A user querying numeric/date fields gets materially wrong rows. Root cause: query-engine.ts greater_than/less_than — after the numeric/ISO-date branches fail, `String(val).localeCompare(String(target))` executes. Fix direction: on type mismatch (number target vs non-number value; ISO-date target vs non-ISO value) return `false` for `greater_than`/`less_than` instead of ordering strings; keep the fallback only when BOTH are plain strings.

**P3D-P2 (P2, gate):** tracked `PHASE3D_QUERY_TABLE_LIST_REPORT.md` (88 lines) is not Prettier-clean → `npm run format:check` fails → `verify:full` red at baseline. One-line `npx prettier --write` fix; CI would fail on this commit.

**P3D-P3 (P3):** nested YAML objects are JSON-stringified by the frontmatter writer and parsed back as strings; `contains`/`equals` match the JSON-string form. Truthful, no crash, no `[object Object]`; document that object-valued properties are queried as their JSON string representation.

**P3D-P4 (P3):** `limit: 0` returns 1 row (clamped to minimum page size). Bounded and deterministic; document.

**P3D-P5 (P3):** each change-stream event triggers one view re-query (no debounce). Bounded 1:1, converges, no runaway; consider coalescing under very high event rates.

## 28. Verdict

**QUERY + TABLE/LIST FOUNDATION COMPLETE — CONDITIONAL.**

All product gates pass: single query authority across Web/CLI/MCP/Standalone; query path read-only; memory/SQLite differential exact; deterministic sorting + bounded pagination; SQL injection impossible; degraded index truthful (UI banner + `index.recovered` auto-refresh); live table updates verified on real artifacts (flips, rename, delete, create); dirty editor buffer untouched; table/list equivalence; auth/privacy clean; 10k scale green on idle; event storm bounded; no saved-view backdoor; no board scope creep; 24/24 committed e2e.

**Blocker to flip to unconditional:** P3D-P2 — `verify:full` is red at baseline solely because the tracked Phase 3D report doc is unformatted. The audit's own required gate ("verify:full passes") is therefore **NOT satisfied at HEAD as committed**. Fix is a formatting-only change to a doc (no product code); after `npx prettier --write PHASE3D_QUERY_TABLE_LIST_REPORT.md`, `verify:full` passes and the foundation is complete.

**P3D-P1 (incorrect mixed-type ordering) is a real P2 product finding** that should be remediated before heavy query reliance (see `ANTIGRAVITY_PHASE3D_REMEDIATION.md`).

**REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**

Phase 3E (Board) not audited per instruction.
