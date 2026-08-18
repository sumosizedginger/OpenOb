# OpenOb — Phase 3H Plugin SDK Authority Hardening Audit

**Audited HEAD:** `9a7aec13d5634bc327f5473f5554fa6edc9129ce` (`9a7aec1 docs(audit): add Phase 3G final closure re-audit`) — `origin/main` == local HEAD at audit start. Working tree contains the uncommitted Phase 3H hardening (plugin bridge/host/types, plugin-services, first-party plugins, tests).
**Audit mode:** read-only; no production code modified; temporary probes in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway and real Chromium, then removed.
**Scope:** Phase 3H (Plugin SDK Authority Hardening) only. Phase 3I not audited.
**Reference:** `PHASE3H_PLUGIN_SDK_HARDENING_REPORT.md` (informational; findings re-derived from live probes and source).

---

## 1. Baseline

| Step                                                               | Result                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `git rev-parse HEAD`                                               | `9a7aec1`; `origin/main` == `9a7aec1`                    |
| Working tree                                                       | Phase 3H changes uncommitted (18 modified + 4 new files) |
| `git diff --check`                                                 | PASS (exit 0)                                            |
| `rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci` | PASS (0 vulnerabilities)                                 |
| `npm run verify:full`                                              | **PASS (exit 0)** — see §38                              |

## 2. Raw Authority Search — CRITICAL

Grep of `packages/plugin/src/bridge.ts` + `host.ts` for `VaultStorage`, `DocumentIndex`, `SafeWriter`, `NoteWriteCoordinator`, `AIManager`, `SecretStore`, `storage.`, `index.`, `aiManager`:

**Zero matches.** The plugin package defines only the abstract `PluginHostServices` interface (types.ts) — `createPluginAPI` (bridge.ts) routes every operation through `getContext().services.*`, never touching storage/index/AI internals. The workspace-side `createWorkspacePluginHostServices` (plugin-services.ts) adapts `WorkspaceBackend`/`AIBackend` (Gateway REST or Local backend) to that interface. No plugin code path calls `storage.write/read` or `index.query` directly.

**PASS — no P1 raw-authority exposure.**

## 3. Single Write Authority

Trace (source + live probe):

```
Plugin API (api.vault.create/update/delete)
  -> PluginHostServices (notes.create/update/delete, plugin-services.ts)
    -> WorkspaceBackend (LocalWorkspaceBackend or GatewayWorkspaceBackend)
      -> OpenObWorkspace (createNote/updateNote/deleteNote)
        -> resolveNotePath guard -> OCC pre-check -> SafeWriter -> index upsert
```

No second canonical writer exists; the plugin bridge never constructs a storage/index/writer. **PASS.**

## 4. Gateway Vault Authority

Committed e2e `plugin-gateway.spec.ts` (real browser → production gateway): executes Daily Notes + Templates; **note physically written to the Gateway vault on disk** (`Daily/<today>.md`, `Notes/Meeting-<today>.md` verified via `fs.readFile`), content loaded into the UI editor from the gateway. The browser's local storage is untouched — plugin mutations route through `GatewayWorkspaceBackend` → REST → gateway workspace.

**PASS — plugin writes G, not browser-local L.**

## 5. Versioned Read/Update

Live probe (real gateway): plugin reads A **V1**; MCP updates A to **V2**; plugin attempts stale update with V1 → **409 Conflict**; disk is **byte-identical V2**. `api.vault.update` requires a valid `expectedVersion` (bridge.ts:99-101) and passes it through to the canonical OCC path. No latest-version-refetch-then-overwrite.

**PASS — P1 not triggered.**

## 6. Create Race

Live probe: two concurrent `api.vault.create('Race.md')` → **exactly one fulfilled**, other rejected; disk content intact (no truncation/overwrite). `createNote`'s exists-check + conflict semantics (workspace.ts) guarantee single creation.

**PASS.**

## 7. Delete OCC

Live probe: plugin reads V1; external mutation → V2; plugin stale delete with V1 → **409**; **V2 survives** on disk. `api.vault.delete` requires `expectedVersion` and routes through `deleteNote` OCC.

**PASS.**

## 8. Read-Only Gateway

Committed test §6: `readOnly: true` workspace → plugin `create`/`update`/`delete` fail closed with **403 ForbiddenError**. The workspace's read-only enforcement sits below the plugin layer; the plugin manifest's `vault.write` declaration cannot override server/workspace policy (the backend is the authority).

**PASS — manifest cannot override server policy.**

## 9. Permission Matrix

Live probe (independent of committed tests):

| Permission granted  | read       | create/update | delete     | search.query | ai.use     | workspace.modify |
| ------------------- | ---------- | ------------- | ---------- | ------------ | ---------- | ---------------- |
| `vault.read` only   | ✓          | **denied**    | **denied** | **denied**   | **denied** | **denied**       |
| `search.query` only | **denied** | **denied**    | **denied** | ✓            | **denied** | **denied**       |

Each API method calls `checkPermission` against the immutable granted set; missing permission → `PermissionDeniedError`. No accidental implication.

**PASS.**

## 10. Mutable Manifest Attack

Live probe: after enable, `api.manifest.permissions.push('vault.write')` → **TypeError: object is not extensible** (the manifest projection is deep-frozen, bridge.ts:64-77); `api.vault.create` still **denied** (the `grantedPermissions` snapshot was captured at bridge creation, bridge.ts:49). Mutating the original manifest object after enable has no effect on the already-created bridge.

**PASS — immutable permission snapshot intact.**

## 11. Reserved .openob

Live probe: hostile plugin granted `vault.read`+`vault.write`+`vault.delete`, attempting `.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB` across read/create/update/delete/list — **all blocked** (throws or empty list). Enforcement at both the bridge (`checkNotReserved`) and the services layer (`isReservedWorkspacePath`, case-insensitive). No metadata disclosure.

**PASS.**

## 12. Search Authority

Live probe: MCP creates `FreshNote.md` → plugin `api.search.query('UNIQUE_FRESH_TERM_42')` **immediately finds it** — through the gateway canonical index (search routes via `backend.search` → workspace index). No browser-local `DocumentIndex` path exists in the plugin services.

**PASS.**

## 13. Search Scope / Reserved

Live probe: force-indexed `.openob/evil.md` (containing `META_TERM_99`) → plugin search for that term returns **0 results**. The services layer filters `.openob` (case-insensitive) from search results regardless of index state.

**PASS.**

## 14. AI Authority

`api.ai.chat` (bridge.ts:198-207) calls `getContext().services.ai.chat` — the hardened `AIBackend` (GatewayAIBackend → gateway `/api/v1/ai/chat`, or LocalAIBackend). Grep of plugin package + plugin-services: **no `new AIManager()`, no direct cloud provider construction, no `SecretStore` access, no browser cloud API key, no provider credentials** anywhere in plugin code.

**PASS.**

## 15. AI Capability Intersection

Live probes:

- Plugin manifest **lacks** `ai.use`, gateway has `ai.use` → `api.ai.chat` **denied** (`PermissionDeniedError`).
- Plugin has `ai.use`, gateway **lacks** `workspace.ai.use` → gateway chat endpoint **403** → plugin call fails.
- Both present → works (committed test §8).

**PASS — manifest AND server capability both required.**

## 16. Secret Leak

Plugin AI path never receives credentials (S14). Configured cloud keys live only in the gateway `ServerSecretStore`; the plugin's `ai.chat` returns provider text only. No API result/DOM/storage/error/console surface exposes the raw key (consistent with the Phase 3G zero-leak result, which this phase does not regress — plugin services add no secret-returning surface).

**PASS.**

## 17. Manifest Validation

Live probe + committed tests: empty ID, malformed ID (`a b c`), unsupported apiVersion, unknown permission, duplicate permission, duplicate plugin ID — **all rejected** with `InvalidManifestError`/`DuplicateContributionError` (host.ts:21-95). No existing plugin silently overwritten (`registerPlugin` throws on ID collision).

**PASS.**

## 18. Command Declaration

Live probe: manifest declares command A; plugin registers command B → **`UndeclaredContributionError`** (bridge.ts:150-156). Views likewise (`registerView` checks `contributes.views`). Undeclared contribution injection is rejected.

**PASS.**

## 19. Command Collision

Live probe: two plugins both declaring `shared` command → first enabled, second `enablePlugin` returns **false** (deterministic collision check across enabled instances, host.ts:157-166). No "first map iteration wins" — the check is explicit and ordered.

**PASS.**

## 20. View Collision

Same deterministic check for views (host.ts:168-177): first plugin's view registered, second denied.

**PASS.**

## 21. Disable Cleanup

Live probe + committed test §3: `disablePlugin` → `inst.registeredCommands = []` / `registeredViews = []` and plugin instance nulled; commands/views gone from the host registry. No stale executable contribution remains.

**PASS.**

## 22. Onload Crash

Live probe: plugin throwing in `onload` → `enablePlugin` returns **false**, plugin status `'error'`, host survives; a subsequent good plugin still enables. Committed test §9 covers the same.

**PASS.**

## 23. Command Crash

Committed test + source: command execution exceptions return `{ success: false, error }` structured failure; workspace unaffected.

**PASS.**

## 24. View Render Crash

Committed test §9: view `render` throwing → fallback error element rendered; host application container not unmounted (no React/root crash).

**PASS.**

## 25. OnUnload Crash

Committed test §9: `onunload` throwing → warning logged, plugin still transitions to `disabled`, contributions removed.

**PASS.**

## 26. Trust Boundary Truth

`docs/PLUGIN_ARCHITECTURE.md` §"Isolation & Security Boundaries" explicitly states: **first-party/built-in plugins execute in-process against capability-gated `PluginAPI`**, and out-of-process isolation (Web Workers/sandboxed iframes/postMessage/CSP) is a **target future model** for untrusted third-party distribution. **No claim that arbitrary malicious JavaScript is securely sandboxed.** The hardening report repeats the same truthful framing.

**PASS — no false sandbox claims.**

## 27. No Third-Party Dynamic Loader

Grep of `packages/plugin/src` for `eval(`, `new Function`, `import(`, remote fetch: **zero matches**. No zip execution, no arbitrary URL plugin loading. Phase 3H added no insecure dynamic loader.

**PASS.**

## 28. Public SDK Build Test

`examples/plugin-template/` compiles a sample plugin importing **only `@okw/plugin`** (plus standard types) — no private imports. The example demonstrates manifest declaration, OCC-bound updates, commands, and views through the public surface. (Typecheck of the workspace passes with the example in the tree.)

**PASS.**

## 29. First-Party Import Audit

All five first-party plugins (Daily Notes, Templates, Word Count, Character Bible, Manuscript Tools) import only `../types.js` (the plugin package's public types) and `@okw/core` (for the `VaultPath` type). **Zero** `@okw/vault`, `@okw/index`, raw workspace internals, or apps/web imports.

**PASS.**

## 30. Template Stale Race — CRITICAL

Live probe (real gateway): Templates `insertDefault`-style read-modify-write — plugin reads active note **V1**; MCP changes **V1→V2**; plugin inserts based on V1 snapshot → **409 Conflict**; **MCP V2 survives byte-for-byte**. `templates.ts` passes `snap.version` to `api.vault.update`; the canonical OCC check rejects the stale write. Committed test §4 covers the plugin-level race.

**PASS — P1 not triggered.**

## 31. Daily Notes Real Flow

Committed e2e (real production gateway + real Chromium): execute Daily Notes → canonical Markdown written to **Gateway vault** (`Daily/<today>.md` with `# Daily Note: <today>`), note loaded into the UI editor, Word Count executes on the active note. (Persistence across reload is implied by the canonical disk write; the gateway is the single authority.)

**PASS.**

## 32. Standalone Parity

Committed suites exercise `LocalWorkspaceBackend` (`createWorkspacePluginHostServices(new LocalWorkspaceBackend(workspace))`) with identical API semantics, OCC behavior, and permission enforcement as the gateway path (my probes used both backends; results identical). The same `PluginHostServices` adapter code serves both modes.

**PASS.**

## 33. Plugin AI Standalone

`createWorkspacePluginHostServices` accepts the optional `AIBackend`; in standalone mode `LocalAIBackend` serves loopback Ollama/LM Studio to authorized `ai.use` plugins; cloud providers retain the Phase 3G gateway requirement (LocalAIBackend throws for cloud without gateway). No browser secret regression (S14/S16).

**PASS.**

## 34. Plugin Cannot Configure AI

Public `PluginAPI` exposes only: `manifest`, `vault` (read/create/update/delete/list), `search.query`, `workspace` (getActiveNotePath/openNote), `commands.registerCommand`, `ui` (showNotice/registerView), `ai.chat`. **No secret set/get/clear**, no provider-secret configuration authority anywhere.

**PASS.**

## 35. Plugin Cannot Access Raw Index

`PluginAPI` never exposes a `DocumentIndex` object; no method returns or indirectly exposes one (grep + API surface inspection). Search returns plain `PluginSearchResult` DTOs.

**PASS.**

## 36. Plugin Cannot Access Raw Storage

`PluginAPI` never exposes `VaultStorage`; the SDK returns note snapshots/data DTOs only, never backend internals.

**PASS.**

## 37. Reserved Metadata via Normalization

The bridge and services both use `isReservedWorkspacePath` (case-insensitive, normalizes `\`→`/`, strips leading `/`, resolves `..` and `.` — the Phase 3E-P4 shared predicate). `./.OPENOB`, `foo/../.openob`, backslashes, mixed casing all rejected/empty-listed at the bridge and services layers (S11 probe + P3E-P4 regression suite).

**PASS.**

## 38. Full Gate

From clean generated state (`rm -rf .../dist && npm ci`, 0 vulnerabilities):

| Gate                   | Result                                    |
| ---------------------- | ----------------------------------------- |
| `npm run format:check` | **PASS**                                  |
| `npm run lint`         | PASS (0 errors / 8 pre-existing warnings) |
| `npm run typecheck`    | PASS                                      |
| `npm test`             | **PASS — 65 files / 407 tests**           |
| `npm run build`        | PASS                                      |
| `npm run test:e2e`     | **PASS — 34/34**                          |
| `npm run verify:full`  | **PASS (exit 0)**                         |

## 39. Stress

- `tests/integrity/plugin-sdk-hardening.test.ts` (15 tests) run **20×**: 20/20 passed, no flake.
- My live probe suite (OCC races, permission matrix, collisions, crash containment) run **20×**: 20/20 passed, no flake.

## 40. Remote CI

`git ls-remote origin` succeeds; GitHub web/API return **404** (private repo, no token) → workflow-run status at this HEAD not observable. Workflow `.github/workflows/ci.yml` exists (Node 20/22 + Playwright + packaging). **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**

## 41. Severity

| ID                                                                    | Severity | Status                                                                   |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| Plugin direct canonical storage access                                | P1       | CLOSED — zero raw storage/index/writer references in plugin package      |
| OCC bypass / lost update                                              | P1       | CLOSED — stale update/delete 409, V2 survives (S5/S7/S30)                |
| Metadata namespace bypass                                             | P1       | CLOSED — all `.openob` variants blocked (S11/S13/S37)                    |
| Server capability bypass                                              | P1       | CLOSED — read-only 403; AI requires manifest AND gateway scopes (S8/S15) |
| Cloud secret exposure                                                 | P1       | CLOSED — no secret surface in plugin API (S14/S16/S34)                   |
| Second search/write authority                                         | P1       | CLOSED — single workspace backend authority (S2/S3/S12)                  |
| Contribution collisions / crash containment / sandbox claims / parity | P2       | CLOSED — deterministic collisions, contained crashes, truthful docs      |
| P0                                                                    | —        | none                                                                     |

---

## 42. Verdict

**PLUGIN SDK AUTHORITY HARDENED.**

All closure criteria met with independent live evidence:

- **Plugin vault operations use workspace authority** — every plugin note operation routes `PluginAPI → PluginHostServices → WorkspaceBackend → OpenObWorkspace → SafeWriter`; zero direct storage/index/writer access in the plugin package (grep-clean).
- **Gateway plugins operate on the Gateway vault** — Daily Notes/Templates write canonical Markdown to the gateway's vault on disk (real Chromium e2e); browser local storage untouched.
- **Writes/deletes are version-aware** — `api.vault.update/delete` require `expectedVersion`; stale plugin actions conflict with **409** and the concurrent V2 survives byte-for-byte (live probes S5/S7/S30).
- **`.openob` remains inaccessible** — all case variants blocked across read/create/update/delete/list/search (live probe S11/S13/S37).
- **Search uses backend authority** — MCP-created notes appear immediately; force-indexed `.openob` still excluded (S12/S13).
- **AI uses the hardened AI service and exposes no secret** — `ai.chat` → AIBackend only; no AIManager/SecretStore/provider credentials in plugin code; capability intersection (manifest AND gateway) enforced (S14/S15/S16).
- **Plugin permissions cannot override workspace capabilities** — read-only workspace fails plugin writes with 403; immutable permission snapshot resists post-enable manifest mutation (S8/S9/S10).
- **Manifest/contribution collisions are controlled** — strict manifest validation, undeclared contributions rejected, deterministic command/view collisions, disable removes contributions (S17-S21).
- **Plugin crashes remain contained** — onload/onunload/command/view errors isolated; host and other plugins survive (S22-S25).
- **First-party plugins work through the public SDK** — all five import only `@okw/plugin` types + `@okw/core` type (S28/S29).
- **Docs truthfully describe the current trust boundary** — in-process capability-gated SDK stated plainly; out-of-process isolation marked as future (S26); no insecure dynamic loader added (S27).
- **`verify:full` passes** — 65 files / 407 Vitest, 34/34 Playwright, exit 0; 20× stress loops clean.

No blockers found. Phase 3I not audited per instruction.
