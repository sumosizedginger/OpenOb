# OpenOb — Phase 3F Property Mutation Views Adversarial Audit

**Audited HEAD:** `2b9f6862e1f9a9e5789bafc0edd79aa2e000a475` (`2b9f686 feat(views): inline table property editing and board drag mutation with OCC`) — `origin/main` == local HEAD (verified `git ls-remote origin HEAD`). Working tree clean.
**Audit mode:** read-only; no production code modified; temporary probes in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway and real Chromium, then removed; working tree clean at end.
**Scope:** Phase 3F (Table inline property editing + Board drag mutation) only. Next phase not audited.
**Reference:** `PHASE3F_PROPERTY_MUTATION_VIEWS_REPORT.md` (informational; all findings re-derived from live probes and source).

---

## 1. Baseline

| Step                                                               | Result                                |
| ------------------------------------------------------------------ | ------------------------------------- |
| `git rev-parse HEAD`                                               | `2b9f686`; `origin/main` == `2b9f686` |
| `git status --short`                                               | clean (0 entries)                     |
| `rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci` | PASS (0 vulnerabilities)              |
| `npm run verify:full`                                              | **PASS (exit 0)** — see §30           |

## 2. Single Mutation Authority

Traced end-to-end:

- **Table:** `TableView.handleCommitEdit` → `onSetProperty(path, col, finalVal, activeEditor.expectedVersion)` (TableView.tsx:126-131) → `ViewContainer.handleSetProperty` (ViewContainer.tsx:353-372) → `backend.setProperty`.
- **Board:** `BoardView.handleDrop` → `onSetProperty(path, effectiveGroupBy, targetCol.value, draggedCard.version)` (BoardView.tsx:229) and accessible menu `handleMoveViaMenu` → `onSetProperty(row.path, effectiveGroupBy, targetCol.value, row.version)` (BoardView.tsx:252) — **identical path**.
- **Backend:** `WorkspaceBackend.setProperty` → `LocalWorkspaceBackend.setProperty` (direct) or `GatewayWorkspaceBackend.setProperty` → `PATCH /api/v1/notes/:path/properties` (server.ts:416-464) → `OpenObWorkspace.setProperty` (workspace.ts:990-1165).
- **Canonical write:** `setProperty` → `resolveNotePath` (reserved-path guard) → OCC pre-check (workspace.ts:1033) → `parseFrontmatter` + `updateDocumentFrontmatter` → `safeWriter.safeSave` (second OCC check at write) → `index.upsert` with durable version.

Rejected patterns confirmed absent: **no** direct YAML edits, **no** browser filesystem writes (web uses only the gateway/local backend), **no** board-specific or table-specific writer (both call the same `setProperty`), **no** direct index mutation (index only updated after canonical save via upsert).

**PASS — exactly one canonical write path; no second mutation authority.**

## 3. Displayed-Version OCC (most important semantic check)

- **Table:** `handleStartEdit` captures `expectedVersion = row.version` **from the row the human actually viewed** (TableView.tsx:66), stored in `activeEditor.expectedVersion` at edit start (line 96). `handleCommitEdit` uses that captured version (line 130). **No fetch-latest-before-commit.**
- **Board:** `handleDragStart` captures `row.version` at drag start (BoardView.tsx:185-189); `handleDrop` uses `draggedCard.version` — the version from when the drag began (line 224-229). **No fetch-on-drop.**
- Query rows always expose `version` (query-engine.ts:318-334: from doc version, else derived `createVersionToken(doc.sourceHash, modifiedAt, size)`); storage uses the same `createVersionToken` (node-fs-storage.ts), and the rebuilder (rebuilder.ts:31-36) + `setProperty` (workspace.ts:1109-1115) persist `modifiedAt`/`size`/`version` so tokens match. **Verified live**: a PATCH with a query-returned token succeeded; a PATCH with a stale token 409'd.

**PASS — displayed version is used; no "display V1 / fetch V2 / blindly apply" pattern.**

## 4. Table Stale Edit

Live probe (real gateway): human sees `score=1 V1`, MCP sets `score=3` (V1→V2, 200), human commits `score=2` with stale V1:

- Commit → **409 CONFLICT**
- Disk remains `score: 3` (external update preserved)
- UI: draft preserved in cell with "Modified externally (409 Conflict). Draft preserved." (TableView.tsx:139-150), input not cleared, `isSaving` reset to false
- No automatic retry

Also covered by committed e2e `table-mutations.spec.ts` #2 (draft `99` preserved, disk `3`). **PASS — value 2 does not overwrite 3; no P1 lost-update.**

## 5. External Event While Editing

External `note.property_changed`/`note.modified` events bump `eventRefreshCounter` → `refreshKey` → `runQuery()` (ViewContainer.tsx:161). The draft lives in `TableView`'s `activeEditor` state (keyed by path+col), **not** derived from row data, so a re-query re-renders rows but does not touch the draft. The captured `expectedVersion` (V1) is retained, so a later commit conflicts truthfully. Board has no persistent draft (drag state is transient; a conflict surfaces the banner and the authoritative position is restored by re-query).

**PASS — draft survives, no auto-reload over draft, commit uses the old displayed version.**

## 6. Type Preservation

Live probes (real gateway, on-disk YAML verified):

| Edit                             | Result                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| number `1` → `2`                 | `priority: 2` (YAML number, unquoted)                               |
| boolean `false` → `true`         | `done: true` (YAML boolean)                                         |
| string `"plain"` → edited        | stays string                                                        |
| string `"false"` typed as string | `status: "false"` (quoted YAML string — **not** coerced to boolean) |

`serializeYamlValue` (frontmatter.ts:158-199) quotes strings that would be misparsed (booleans, null, numbers, `0x…`, leading zeros, YAML special chars, padding, newlines); numbers/booleans serialize raw. Table's number editor parses via `Number()` (validates NaN → inline error, TableView.tsx:111-117); boolean editor uses a select with real booleans.

**PASS — no generic stringification.**

## 7. Empty vs Delete

Live probes:

- `setProperty(key, '')` → disk `name: ""` (quoted empty string, property **remains**) ✓
- `setProperty(key, null)` (Clear Property button / ungrouped drop) → `delete updatedProperties[key]` (workspace.ts:1072-1074), key **removed** from frontmatter ✓

UI exposes both: empty string via the text input, explicit "Clear property" button (TableView.tsx:357-364) and ungrouped column (BoardView). **PASS — not conflated.**

## 8. Board String Move

`groupBy=status`, card `todo` → drop on `done` column → `onSetProperty(path, 'status', 'done', card.version)` → disk `status: done`. Verified via committed e2e (`board-mutations.spec.ts` #1) and the DataTransfer drag probe (real Chromium). After the canonical event + re-query (`handleSetProperty` calls `runQuery()`), the card moves.

**PASS.**

## 9. Board Numeric Type

`groupBy=priority`, columns derived as numbers `1`, `2`, `3` (BoardView.tsx:80-82 `canonicalVal = Number(rawVal)`, column sort numeric at 152-159). Drag/menu to column `2` → `onSetProperty(path, 'priority', 2, version)` (the column's canonical numeric value) → disk `priority: 2` (number, verified live and by committed test 4.1). **Rejected pattern (`priority: "2"`) absent.**

**PASS.**

## 10. Board Boolean Type

`groupBy=done`: `canonicalVal = Boolean(rawVal)` (BoardView.tsx:77-79). Move `false` → `true` column → disk `done: true` (boolean, live probe). **`"true"` stringification rejected.**

**PASS.**

## 11. Ungrouped

Ungrouped column (`No <groupBy>`) is always generated with `value: null` (BoardView.tsx:66, 116, 125-131). Drop/menu onto it → `setProperty(value: null)` → property **removed** from frontmatter (live probe: `status` absent from disk; committed test 4.2 + e2e). No `status: null`, no `status: ""`, no `status: "No status"` — deletion contract is property removal, matching the actual file behavior.

**PASS.**

## 12. Unsupported Bucket

`Other / Unsupported` column (`isUnsupported: true`) — `handleDragOver` returns without `preventDefault` (no drop target, BoardView.tsx:194-197), `handleDrop` returns early (line 213), menu filters it out (line 390), `handleMoveViaMenu` refuses (line 246). Programmatic drop on it is a no-op. **Verified at source + committed suite; no mutation possible.**

**PASS.**

## 13. Board Stale Drag

Committed e2e `board-mutations.spec.ts` #2 + live probe: browser shows `A V1 status=todo`, MCP sets `status=blocked` (V1→V2), human drag/menu commits with stale V1 → **409**, disk remains `blocked`, after re-query the card is in Blocked. No automatic reapply.

**PASS.**

## 14. Mid-Drag Race

`handleDragStart` captures `row.version` at drag start; the drop uses that captured version, **not** a fetch-latest-on-drop. Live probe: captured V1 at "drag start", external mutation V1→V2, drop with V1 → **409 CONFLICT**, disk remains the external value. No "fetch latest on drop then write" behavior.

**PASS.**

## 15. Rapid Same-Note Edit

Committed test 2.2 + live probe: edit A commits (V1→V2); edit B attempted with the **stale** pre-A version → **409** (no silent lost update); edit B with the fresh version returned by A → 200. UI serializes via `isSaving` lock (input disabled during in-flight commit, TableView.tsx:325/337) preventing double-submit; the post-commit `runQuery()` refreshes versions. A stale B cannot be written without a truthful conflict.

**PASS.**

## 16. Different-Note Concurrency

Live probe: parallel PATCHes to two different notes with fresh versions → **both 200** (13 ms, no global mutation mutex). `setProperty` uses per-path `withPathLock` (workspace.ts:1009); `structuralGate.withShared` allows concurrent shared-path operations across distinct paths.

**PASS — mutations to different rows are independent.**

## 17. Read-Only

- Gateway without `properties.write`: live probe `PATCH /api/v1/notes/.../properties` → **403 FORBIDDEN**.
- `readOnly: true` workspace → `ForbiddenError` (committed test 3.1).
- UI: `canEdit = !backend.isReadOnly` (ViewContainer.tsx:351) — Table cells non-editable (`handleStartEdit` early-returns, TableView.tsx:65), Board cards non-draggable (`draggable={canEdit && Boolean(row.version)}`, BoardView.tsx:350) and no move menu (line 369). `GatewayWorkspaceBackend` now initializes `_isReadOnly` from `getWorkspaceInfo()` (useVault.ts:688-693, backend.ts:189-193) so the gateway UI truthfully reflects server scopes. UI state cannot grant permission (server enforces scope).

**PASS.**

## 18. Saved View Filter Movement

Live probe: saved view `status=active` (rows T1,T2); edit T1 `active→inactive` via `setProperty` → Markdown changed; re-run view → T1 gone (rows = T2 only). **Saved view JSON byte-identical** (verified on disk). Works because views are config only; results come from the live query.

**PASS.**

## 19. Sort Movement

Live probe: `sort priority ASC` (T1:1, T2:2, T3:3); edit T2 `priority 2→0` → re-query → **T2:0, T1:1, T3:3** (position per authoritative query result). `handleSetProperty` calls `runQuery()` after success, so ordering reflects the query, not stale local state.

**PASS.**

## 20. Index Degradation

Code path (workspace.ts:1106-1120): canonical save happens first (SafeWriter); index upsert failure is caught → `indexStatus = 'degraded'`, `indexHealth = 'degraded'`, but `durableSuccess: true` and the result still returns the new version. UI (ViewContainer.tsx:365-367) logs a warning but does not treat it as save failure; the degraded banner renders from `queryResult.indexStatus` (line 382-387). No retry write, no false "save failed". Recovery via `index.recovered` event → re-query (useVault.ts:479-481).

**PASS (verified at source; the degraded path returns durable success with truthful status).**

## 21. Self-Event Loop

- One Table edit → **exactly one** `setProperty` call (`handleSetProperty` → `backend.setProperty` once, then `runQuery()`).
- One Board move → **exactly one** `setProperty` call.
- The workspace publishes `note.property_changed` after persistence (workspace.ts:1157-1165); the web app's event handler bumps `eventRefreshCounter` → re-query (read-only). Re-query never triggers a write; there is no code path from an event to `setProperty`.
- Live probe: single PATCH → 200 with no follow-up writes.

**PASS — no self-event write loop.**

## 22. Table Row Navigation

`<tr onClick={() => onNavigate(row.path)}>` navigates on non-editable areas (title/path/tags). Cell editing stops propagation (`handleStartEdit` calls `e.stopPropagation()`, TableView.tsx:64; the editing `<td>` also stops propagation at line 299), so clicking/editing a cell does **not** navigate while committing. Commit buttons stop propagation (within the editing td).

**PASS.**

## 23. Board Click vs Drag

- Simple click on a card → `onClick={() => onNavigate(row.path)}` (BoardView.tsx:352) → opens note.
- Drag → `onDragStart` sets `dataTransfer` (initiates native DnD; HTML5 suppresses the click after a real drag), `handleDrop` calls `e.preventDefault()` and does **not** navigate.
- **Real-Chromium probe** (DataTransfer dispatch): drag move committed (`status: done` on disk) and **no editor/navigation opened** — verified in this audit. Move-menu button stops propagation (line 370).

**PASS — click opens, drag mutates without accidental navigation.**

## 24. Accessible Move Path

`handleMoveViaMenu` uses the exact same `onSetProperty(row.path, effectiveGroupBy, targetCol.value, row.version)` — same `setProperty`, same displayed `row.version`, same type-preserving column value (string/number/boolean/null). No separate semantics. Verified live (menu-equivalent call → 200, typed correctly) and by committed e2e (`move-to-done`, `move-to-No status`, `move-to-3`).

**PASS.**

## 25. Gateway / Standalone Parity

- Gateway: `GatewayWorkspaceBackend` → REST `PATCH` → workspace `setProperty` (probed live).
- Standalone: `LocalWorkspaceBackend` → workspace `setProperty` directly (committed `view-mutations.test.ts` uses `LocalWorkspaceBackend`; all 11 tests pass).
- Same Markdown result, same typing, same OCC (both go through the identical `OpenObWorkspace.setProperty`). No mode-specific shortcut found.

**PASS.**

## 26. Reserved Metadata (P3E-P4 must stay closed)

Committed `view-mutations.test.ts` 3.2 rejects `setProperty` on `.openob`/`.OPENOB`/`.OpenOb`/`.oPeNoB` with `InvalidPathError`; the full `reserved-metadata-boundary.test.ts` suite (case variants, HTTP REST, byte integrity) still passes (21/21 across both suites in this audit). Phase 3F did not reopen P3E-P4.

**PASS.**

## 27. Security / Value Input

- `serializeYamlValue` quotes strings that could change meaning (`"false"`, `"null"`, `"1e3"`, `"yes"`, `0x…`, leading zeros, YAML punctuation, newlines) — live probe `status="false"` stayed `"false"` on disk.
- Number editor validates `NaN` and refuses to commit (inline error).
- Long/Unicode strings pass through the serializer unchanged (JSON.stringify for quoted form handles Unicode; no length cap issues).
- No code execution / template injection surface: values are serialized as YAML scalars only; no HTML/JS interpolation into the editor (React escapes).

**PASS.**

## 28. Query Row Version Completeness

- Query rows always expose `version` (query-engine.ts:318-334) — live probe: 1/1 rows had a token.
- Defensive fallback `row.version ?? { token: '' }` (TableView.tsx:66) **fails closed**: an empty token never matches a real storage token → server returns **409** (live probe), disk unchanged. No blind write, no working-token fabrication. Board guards with `Boolean(row.version)` before enabling drag/menu.

**PASS.**

## 29. Real Artifacts

- Production gateway (`apps/gateway/dist/bin/gateway.js` + `startGateway`) — live REST probes.
- Production web assets (`serveWeb: true`, real Chromium) — committed e2e **30/30** incl. 4 Phase 3F specs + this audit's DataTransfer drag probe in real Chromium.
- Real MCP/concurrency semantics — the external mutations in the e2e concurrency tests use a real `OpenObGatewayClient` (the same authority an MCP change produces).
- Concurrency is proven at the real-artifact level (e2e #2 in both specs), not unit-only.

**PASS.**

## 30. Full Gate

| Gate                   | Result                                    |
| ---------------------- | ----------------------------------------- |
| `npm run format:check` | **PASS**                                  |
| `npm run lint`         | PASS (0 errors / 7 pre-existing warnings) |
| `npm run typecheck`    | PASS                                      |
| `npm test`             | **PASS — 63 files / 371 tests**           |
| `npm run build`        | PASS                                      |
| `npm run test:e2e`     | **PASS — 30/30**                          |
| `npm run verify:full`  | **PASS (exit 0)**                         |

20× adversarial loop on `view-mutations.test.ts`: **20/20 passed, 0 failures**.

## 31. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `2b9f686` == local HEAD. GitHub web/API return **404** (private repo, no token) → actual workflow-run status at this exact HEAD is not observable from this environment. Workflow `.github/workflows/ci.yml` runs Node 20/22 matrix + Playwright + packaging. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.** CI existence not denied; full gate replayed locally and green.

## 32. Severity

| ID                                | Severity | Status                                                              |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| Lost external update / OCC bypass | P1       | none found — stale versions always 409, disk preserved              |
| Second mutation authority         | P1       | none — single canonical `setProperty` path                          |
| Metadata namespace regression     | P1       | none — P3E-P4 stays closed (case variants rejected)                 |
| Auth bypass                       | P1       | none — read-only 403 at REST and UI                                 |
| Wrong scalar type                 | P2       | none — number/boolean/string preserved (live on-disk YAML verified) |
| Incorrect Board movement          | P2       | none — typed column values, ungrouped removes, unsupported rejects  |
| Draft loss                        | P2       | none — draft preserved on 409                                       |
| Event loop                        | P2       | none — re-query never writes                                        |
| Index-status lie                  | P2       | none — `durableSuccess` + truthful `degraded`                       |
| Gateway/Standalone divergence     | P2       | none — same canonical path                                          |
| P0                                | —        | none                                                                |

**No P0/P1/P2 findings.**

---

## 33. Verdict

**PROPERTY MUTATION VIEWS COMPLETE.**

All closure criteria met, with independent live evidence:

- Table edits use the **displayed row OCC version** (captured at edit start; no fetch-latest-before-commit) — stale edits get 409, disk keeps the external update, draft preserved.
- Dirty drafts survive conflicts (no auto-reload over draft; commit uses the captured version).
- Scalar types preserved (number/boolean/string) — verified as real YAML on disk, including YAML-ambiguous strings quoted.
- Board moves mutate only `groupBy` through the one canonical `setProperty`, using the card's displayed version; numeric/boolean group values preserve type.
- Stale drags cannot overwrite agent changes (409, mid-drag race safe); no fetch-on-drop.
- Ungrouped removes the property (deletion contract); `Other / Unsupported` cannot accept drops (drag/drop/menu all blocked).
- No self-event loops (one edit = one canonical mutation; re-query is read-only).
- Gateway/Standalone semantics match (same `OpenObWorkspace.setProperty`).
- `.openob` isolation remains closed across case variants (P3E-P4 not reopened).
- Table cell editing does not navigate; board click opens, native drag mutates without navigation (real Chromium probe).
- Read-only: cells non-editable, cards non-draggable, forged REST mutation 403.
- Saved-view filter/sort movement re-queries authoritatively; view JSON byte-identical.
- Index degradation truthfully reported as durable save + degraded; no retry/false-failure.
- `verify:full` passes from clean `npm ci` (63 files / 371 Vitest, 30/30 Playwright).

No remediation required. Next phase not audited per instruction.
