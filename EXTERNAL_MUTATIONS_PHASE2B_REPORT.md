# OpenOb — External Mutations Phase 2B Report

## Rename + Delete Structural Mutations Closure

### 1. Overview & Architectural Compliance

Phase 2B extends the single authoritative `OpenObWorkspace` application boundary with safe external structural mutations:

1. **`renameNote`**: Safely renames markdown documents on disk and safely refactors incoming wikilinks (subpaths, headings, aliases, embeds, nested paths, and self-links) across the entire vault without mutating code blocks or frontmatter.
2. **`deleteNote`**: Safely deletes a markdown document on disk with OCC version gating. Inbound wikilinks remain canonical Markdown without silent cascading mutations.

All external access surfaces (REST API, CLI, MCP tools) delegate exclusively to `OpenObWorkspace` and cannot bypass storage or index boundaries.

---

### 2. Capabilities & Scopes

- **`workspace.rename`**: Explicit scope required for note renaming.
- **`workspace.delete`**: Explicit scope required for note deletion.
- **Scope Hierarchy**:
  - Default gateway remains strictly read-only (`workspace.read`, `workspace.search`).
  - `workspace.write` does NOT grant rename or delete.
  - `workspace.rename` does NOT grant delete.
  - `workspace.delete` does NOT grant rename.
  - Read-only workspaces reject all mutations with `ReadOnlyWorkspaceError` (HTTP 403 / `WORKSPACE_READ_ONLY`).
  - Missing required scopes reject with `ForbiddenError` (HTTP 403 / `FORBIDDEN`).

---

### 3. Structural Concurrency Gate (`StructuralGate`)

- Implemented a Readers-Writer lock on `OpenObWorkspace`:
  - **Shared operations (`withShared`)**: `createNote`, `updateNote`, `setProperty` execute concurrently on distinct paths while acquiring individual per-path locks.
  - **Exclusive operations (`withExclusive`)**: `renameNote` and `deleteNote` queue behind active operations, drain in-flight mutations, block new mutations during structural file moves / backlink refactorings, and release upon completion.
- Zero race condition between note updates and rename/delete operations.

---

### 4. Concurrency & Data Safety Guarantees

- **Mandatory OCC (`expectedVersion.token`)**: Both rename and delete require valid version tokens. Stale version tokens immediately reject with `ConflictError` (HTTP 409 / `CONFLICT`). Force / overwrite / LWW modes are strictly disallowed.
- **Transactional Rollback Journal**: In `renameNote`, all backlink rewrites capture original snapshots and use OCC version tokens on write. If any backlink write fails midway, all previously modified files are rolled back using OCC tokens to prevent corrupting third-party edits, and the moved file is restored. If rollback fails, `RecoveryRequiredError` is surfaced and `indexHealth` is marked `'degraded'`.
- **Pre-Delete Version Re-check (P4-1R)**: Before removing the old path on disk, the version is re-checked to abort if modified concurrently.
- **Index Degradation Protection**: Pre-rename check ensures `indexHealth` is healthy before attempting backlink resolution; returns `IndexDegradedError` (HTTP 409) if degraded.

---

### 5. Access Surface Integration

#### A. REST API

- `POST /api/v1/notes/:path/rename`: JSON payload `{ newPath, expectedVersion, updateLinks? }` -> `RenameResultDTO`.
- `DELETE /api/v1/notes/:path`: Supports JSON body `{ expectedVersion }` or `If-Match: "<token>"` HTTP header -> `DeleteResultDTO`.

#### B. CLI

- `openob rename <old> <new> --expected-version <token> [--json]`
- `openob delete <path> --expected-version <token> [--json]`
- Fully supported in both Direct workspace mode and Remote REST mode (`--url`, `--token`).

#### C. MCP Tools

- `openob_rename_note`: Arguments `{ oldPath, newPath, expectedVersion, updateLinks? }`.
- `openob_delete_note`: Arguments `{ path, expectedVersion }`.

---

### 6. Verification Results

| Suite                  | Target                                               | Status   | Result                                        |
| :--------------------- | :--------------------------------------------------- | :------- | :-------------------------------------------- |
| **Formatting**         | `prettier --check .`                                 | **PASS** | 0 style issues                                |
| **Linting**            | `eslint .`                                           | **PASS** | 0 errors (4 non-blocking React hook warnings) |
| **Typecheck**          | `tsc --build`                                        | **PASS** | 0 type errors                                 |
| **Unit & Integration** | `vitest run`                                         | **PASS** | **51 files / 263 tests passed (100%)**        |
| **Process Packaging**  | `tests/integrity/gateway-external-mutations.test.ts` | **PASS** | Real CLI + gateway process lifecycle          |
| **E2E Playwright**     | `playwright test`                                    | **PASS** | **9 tests passed**                            |
| **Full Gate**          | `npm run verify:full`                                | **PASS** | Complete verification pipeline exit code 0    |

---

### 7. Touched Contracts & Files

- `packages/workspace/src/types.ts`: Added `RenameNoteRequest`, `DeleteNoteRequest`, `RenameResultDTO`, `DeleteResultDTO`, `SingleNoteMutationResultDTO`.
- `packages/workspace/src/errors.ts`: Added `IndexDegradedError`, `RecoveryRequiredError`.
- `packages/workspace/src/workspace.ts`: Implemented `StructuralGate`, `renameNote()`, `deleteNote()`, and capability checks.
- `packages/workspace/src/mcp.ts`: Added `openob_rename_note` and `openob_delete_note` tools.
- `apps/gateway/src/server.ts`: Added `POST .../rename` and `DELETE ...` routes.
- `apps/gateway/src/cli.ts`: Added `rename` and `delete` CLI commands.
- `EXTERNAL_ACCESS.md`: Updated external access documentation.
- `packages/workspace/src/__tests__/workspace-structural.test.ts`: 15 comprehensive structural mutation tests.
- `apps/gateway/src/__tests__/gateway.test.ts`: REST and CLI integration tests for rename/delete.
- `tests/integrity/gateway-external-mutations.test.ts`: Real bundled binary process testing.
