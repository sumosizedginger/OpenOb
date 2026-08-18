# OpenOb Phase 3F Completion Report: Inline Property Editing & Board Drag Mutation with OCC

## Executive Summary

Phase 3F turns the existing derived Table and Board views into safe, type-preserving mutation surfaces with strict Optimistic Concurrency Control (OCC).

All architecture invariants from `CONSTITUTION.md` and `AGENTS.md` remain strictly preserved:

1. **Zero New Mutation Endpoints**: Mutations strictly reuse the canonical `setProperty` contract (`WorkspaceBackend.setProperty` -> Gateway REST `PATCH /api/v1/notes/:path/properties` -> `OpenObWorkspace.setProperty` -> `SafeWriter`). No `tableCellWrite()`, `boardMove()`, `databaseUpdate()`, or frontmatter bypassing was introduced.
2. **Strict Optimistic Concurrency Control (OCC)**: Every mutation uses the explicit version token associated with the displayed row/card (`row.version`). Stale edits are rejected with `409 Conflict`, draft changes are preserved in the editor, and silent overwrites are impossible.
3. **Canonical YAML Type Preservation**: Property scalar types (`string`, `number`, `boolean`, `null`/deletion) are strictly preserved across both Table inline editing and Board drag-and-drop / move menus. Grouping by a numeric or boolean property writes true YAML numbers/booleans, not stringified representations.
4. **Markdown Truth & Pure Derived Index**: Notes on disk remain the single canonical source of truth. Mutations update the file through `SafeWriter` and immediately update the derived `DocumentIndex` with durable version tokens.

---

## Architectural & Subsystem Implementation

### 1. Table View Inline Scalar Property Editing (`apps/web/src/components/views/TableView.tsx`)

- **Interactive Cell Activation**: Clicking any dynamic property cell opens an inline editor if the workspace is writable (`canEdit && onSetProperty`).
- **Scalar Type Detection & Preservation**:
  - `number`: Renders `<input type="number">`, parses draft to JS `number` before calling `onSetProperty`.
  - `boolean`: Renders `<select>` with `"true"` / `"false"` options, parses draft to JS `boolean`.
  - `string`: Renders text `<input>`, passes trimmed/original string value.
  - Property deletion: Provides a "Clear property" button calling `onSetProperty(path, col, null, expectedVersion)` to remove the key from frontmatter.
- **Keyboard & Lifecycle Semantics**:
  - `Enter` commits the edit.
  - `Escape` cancels the edit without mutation.
  - In-flight operations lock the input control (`isSaving: true`) to prevent double submits.
  - Stopping propagation prevents row-level note navigation while editing.
- **409 Conflict Handling**:
  - On `409 Conflict`, the draft input remains preserved in the cell.
  - Displays conflict alert: `"Modified externally (409 Conflict). Draft preserved."`
  - Prevents automated retries or silent overwrites.

### 2. Board View Kanban Drag-and-Drop & Move Mutation (`apps/web/src/components/views/BoardView.tsx`)

- **Typed Column Groups**: Refactored `ColumnGroup` so each column retains the canonical scalar `value: string | number | boolean | null`.
- **HTML5 Drag-and-Drop Mutation**:
  - Cards are draggable when `canEdit` is true.
  - Dropping a card onto a column executes `onSetProperty(path, effectiveGroupBy, targetCol.value, card.version)`.
  - Type-preserving: Dropping into a number column (e.g. `priority: 2`) writes numeric `2`; dropping into a boolean column writes `true`/`false`.
  - Ungrouped column (`No <groupBy>`) always generated; dropping onto it executes `setProperty(value: null)` which deletes the property from frontmatter.
  - "Other / Unsupported" column (for complex arrays or nested objects) prohibits drop operations.
- **Accessible Move Menu**:
  - Added card dropdown menu (`MoreVertical` button) listing available target columns with exact test IDs (`move-to-<colName>`).
  - Executes identical mutation and OCC validation as drag-and-drop.
- **Conflict & Error Surface**:
  - Surfaces a prominent banner on 409 Conflict: `"Card modified externally (409 Conflict). Authoritative position restored."`

### 3. View Container & OCC Version Propagation (`apps/web/src/components/views/ViewContainer.tsx`)

- **Writable Capabilities Check**: Wires `canEdit = !backend.isReadOnly`.
- **Handler Implementation**: `handleSetProperty(path, key, value, expectedVersion)` delegates to `backend.setProperty`.
- **Truthful Index Notification**: Handles degraded index notifications gracefully without blocking durable file saves.
- **Post-Mutation Re-query**: Automatically triggers `runQuery()` after successful mutations to refresh query results and populate updated version tokens.
- **Auto Re-query on GroupBy Change**: Triggers re-query when `groupBy` input changes in Board mode.

### 4. Query Engine & Workspace Version Token Propagation

- **`packages/index/src/query-engine.ts`**:
  - Updated `executeProtocolPropertyQuery` to populate `row.version` with `createVersionToken(doc.sourceHash, doc.modifiedAt, doc.size)`.
- **`packages/workspace/src/workspace.ts`**:
  - Updated `createNote`, `updateNote`, and `setProperty` to pass `{ ...parsed, modifiedAt, size, version: durableVersion }` when upserting to `this.index`, ensuring query tokens match canonical durable file versions.
- **`packages/workspace/src/backend.ts` & `apps/web/src/hooks/useVault.ts`**:
  - Fixed `GatewayWorkspaceBackend` constructor and initialization to call `await gatewayBackend.getWorkspaceInfo()` so `_isReadOnly` truthfully reflects gateway write permissions.

---

## Test & Verification Evidence

### 1. Dedicated Integrity Unit & Integration Suite (`tests/integrity/view-mutations.test.ts`)

11 rigorous tests covering:

- String property editing preserving string value.
- Numeric property editing preserving YAML number type.
- Boolean property editing preserving YAML boolean type.
- Deleting property via `value: null` removing key from frontmatter.
- Empty string value remaining a valid string.
- Stale row version $V1$ rejected with `ConflictError` (409) when note modified to $V2$.
- Rapid sequential edits serializing cleanly when using updated versions.
- Read-only workspace rejecting `setProperty` with `ForbiddenError` (403).
- Reserved `.openob` namespace rejected across case variants.
- Moving card between numeric Board columns preserving number type.
- Moving card to ungrouped column deleting property.

### 2. End-to-End Playwright Concurrency Tests

- **`tests/e2e/table-mutations.spec.ts`**:
  - Inline editing of string, number, and boolean properties against real running gateway with on-disk verification.
  - Concurrency: External agent mutates note ($V1 \to V2$) while human draft is open -> human commit fails with 409 Conflict, draft is preserved, and agent $V2$ is not overwritten.
- **`tests/e2e/board-mutations.spec.ts`**:
  - Moving cards between status columns, ungrouped column, and numeric priority columns with on-disk YAML type verification.
  - Concurrency: External agent mutates card to `blocked` ($V1 \to V2$) -> human commit using stale $V1$ fails with 409 Conflict and agent $V2$ is preserved on disk.

### 3. Full Repository Verification Suite

```text
> open-knowledge-workspace@0.1.0 verify:full

✔ npm run format:check (clean)
✔ npm run lint (0 errors)
✔ npm run typecheck (0 errors)
✔ npm test (63 test files, 371 tests passed)
✔ npm run build (gateway + web bundles compiled)
✔ npm run test:e2e (30 Playwright tests passed in real Chromium)
```

---

## Conclusion

Phase 3F is fully implemented, verified, and complete. Both Table and Board views are active, type-preserving mutation surfaces with zero data loss risk and strict OCC guarantees.
