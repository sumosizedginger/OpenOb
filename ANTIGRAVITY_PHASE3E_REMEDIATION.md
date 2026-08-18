# ANTIGRAVITY_PHASE3E_REMEDIATION.md

Remediation items for the Phase 3E adversarial audit (`PHASE3E_SAVED_VIEWS_BOARD_AUDIT.md`). Audit-only run; production code untouched. Fix scope defined for the Foreman (Gemini).

## R3E-1 — Read-only workspace guard omits `workspace.views.write` (P2)

- **ID:** R3E-1
- **Severity:** P2
- **Scope:** `packages/workspace/src/workspace.ts` (`checkCapability`, lines ~1800-1818); `apps/web/src/hooks/useVault.ts` (standalone workspace construction, lines ~225-232)
- **Problem:** `checkCapability`'s read-only blocklist covers `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete` — but **not** `workspace.views.write`. An `OpenObWorkspace` mounted `readOnly: true` invoked **without a client-scope context** permits saved-view create/update/delete, while rejecting note writes. This contradicts the workspace's own advertised capabilities (read-only → `[workspace.read, workspace.search]` only) and the read-only contract.
- **Evidence (live probe):** workspace constructed exactly as the standalone app does (`readOnly` unset → defaults to `true`): `createNote` → `ForbiddenError` ("Workspace is mounted in read-only mode... workspace.write"); `createSavedView` → **SUCCEEDED**; `deleteSavedView` → succeeded. Gateway mode is safe because the server always injects scopes (`server.ts` defaultScopes / explicit scopes), which is why committed tests (which use scopes) never exposed this.
- **Required change (minimal):**
  1. Add `'workspace.views.write'` to the read-only blocklist in `checkCapability` (workspace.ts).
  2. Construct the standalone web workspace with `readOnly: false` in `useVault.ts` (it is a fully-capable local app; note writes already flow through the coordinator, and this makes its advertised capabilities truthful: `workspace.write`, `properties.write`, `workspace.views.write`, etc.).
  3. Verify the standalone StatusBar / capability display does not regress from the `readOnly` flag change (it should reflect the actual capability set).
- **Required regression test:** unit test asserting a `readOnly: true` workspace with **no** client context throws `ForbiddenError` for `createSavedView`/`updateSavedView`/`deleteSavedView` (mirroring the existing `createNote` read-only test); integration test asserting the standalone-mode flow (`readOnly: false` local workspace) can create/list/run/delete a saved view end-to-end.
- **Acceptance criteria:** read-only mounts enforce view-write denial for context-less callers; standalone saved-view CRUD still works; `verify:full` green.
- **What NOT to do:** do not remove the read-only flag from the workspace entirely; do not special-case the store; keep the gateway scopes mechanism unchanged.

## R3E-2 — `workspace.views.write` undocumented and absent from default writable-gateway scopes (P2)

- **ID:** R3E-2
- **Severity:** P2
- **Scope:** `apps/gateway/src/server.ts` (defaultScopes), `apps/gateway/src/bin/gateway.ts` (default scopes + `--help`), docs (`docs/API_CONTRACTS.md`, `docs/SECURITY.md`, gateway README/help text)
- **Problem:** Saved-view mutation requires `workspace.views.write`, but:
  1. `server.ts` default writable-gateway scopes = `[workspace.read, workspace.search, workspace.write, properties.write, workspace.rename, workspace.delete]` — **no `workspace.views.write`** → `POST /api/v1/views` → 403 on a default writable gateway.
  2. Production gateway default (no `--scopes`) = `[workspace.read, workspace.search]` (read-only).
  3. The scope is documented **nowhere**: no gateway `--help` (the gateway binary currently has no help output at all), no doc file mentions scopes.
     → In default gateway-managed web mode the Save-View UI always 403s; the feature is unreachable without operator configuration that nothing documents. Committed tests/e2e inject the scope explicitly, masking the default path.
- **Evidence (live probe):** `POST /api/v1/views` with server-configured scopes `[workspace.read, workspace.write]` → 403; with full scope set incl. `workspace.views.write` → 201. `grep -rn "workspace.views.write" docs/ apps/gateway/src` → only source references.
- **Required change (choose A, B, or both — recommend A+B):**
  - **A (defaults):** add `'workspace.views.write'` to `server.ts` defaultScopes for non-read-only workspaces and to the production gateway's writable default (when the operator requests write capability) — mirroring how `workspace.write` is handled today.
  - **B (documentation):** document the full scope vocabulary — including `workspace.views.write` — in `docs/API_CONTRACTS.md` (or `docs/SECURITY.md`) and add a `--help`/usage text to the gateway binary listing `--scopes` values and defaults.
- **Required regression test:** integration test asserting a default (non-read-only) gateway can create/update/delete a saved view without explicit `--scopes`; keep the read-only default test asserting 403.
- **Acceptance criteria:** default writable gateway supports saved-view CRUD; scope vocabulary documented; `verify:full` green.
- **What NOT to do:** do not remove the read-only default of the gateway; do not add `workspace.views.write` to the read-only default; do not weaken the explicit-scope override.

## R3E-3 — Correct the `expectedVersion: null` comment + add gateway `--help` (P3)

- **ID:** R3E-3
- **Severity:** P3
- **Scope:** `packages/workspace/src/saved-views.ts` (comment, ~line 400); `apps/gateway/src/bin/gateway.ts` (help output)
- **Problem:** the create comment _"Expected absence (null) ensures we don't accidentally overwrite"_ is inaccurate: `safeSave` with `expectedVersion: null` performs **no** version check (unconditional write); overwrite-safety comes from generated UUIDs not colliding. Also, the gateway binary silently ignores unknown flags and has no `--help`.
- **Fix:** reword the comment to state that create relies on generated-ID uniqueness (and optionally pass `expectedVersion: null` explicitly documented as "no precondition"); add a `--help`/usage block to the gateway binary listing `--vault/--port/--host/--token/--scopes/--serve-web/--web-dist` and scope vocabulary.
- **Acceptance criteria:** comment truthful; `openob-gateway --help` exits 0 and prints usage.
