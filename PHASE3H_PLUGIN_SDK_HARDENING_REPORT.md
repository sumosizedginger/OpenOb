# Phase 3H: Plugin SDK Authority & Capability Hardening — Architecture & Closure Report

## Executive Summary

Phase 3H hardens the OpenOb `@okw/plugin` SDK, establishing strict workspace authority, optimistic concurrency control (OCC), permission enforcement, reserved metadata isolation, and lifecycle error containment for all plugins.

All five first-party plugins (Daily Notes, Templates, Word Count, Character Bible, Manuscript Tools) have been upgraded to the 2.x API surface and dogfood the hardened contracts with zero private or internal imports.

---

## 1. Core Architectural Enhancements

### 1.1 Minimal Abstract Host Services (`PluginHostServices`)

Previously, `PluginHost` and `createPluginAPI` held ambient references to internal structures (`storage`, `index`, `aiManager`).
In Phase 3H, `@okw/plugin` defines an abstract, framework-agnostic `PluginHostServices` interface:

```ts
export interface PluginHostServices {
  readonly notes: {
    read(path: VaultPath): Promise<PluginNoteSnapshot>;
    create(path: VaultPath, content: string): Promise<PluginNoteMutationResult>;
    update(
      path: VaultPath,
      content: string,
      expectedVersion: DocumentVersionToken
    ): Promise<PluginNoteMutationResult>;
    delete(path: VaultPath, expectedVersion: DocumentVersionToken): Promise<void>;
    list(folderPrefix?: string): Promise<VaultPath[]>;
  };
  readonly search: {
    query(text: string, options?: { limit?: number }): Promise<PluginSearchResult[]>;
  };
  readonly ai?: {
    chat(prompt: string, options?: { model?: string }): Promise<string>;
  };
  readonly workspace: {
    getActiveNotePath(): VaultPath | null;
    openNote(path: VaultPath): Promise<void>;
    showNotice(message: string): void;
  };
}
```

`createWorkspacePluginHostServices(backend, aiBackend, uiCallbacks)` in `@okw/workspace` bridges `WorkspaceBackend` (in either Gateway REST or Local FSA mode) to `PluginHostServices`.

### 1.2 Version-Aware Optimistic Concurrency Control (OCC)

- `api.vault.read(path)` returns `PluginNoteSnapshot { path, content, version }`.
- `api.vault.update(path, content, expectedVersion)` requires passing the snapshot's concurrency token. Blind updates or fetch-then-blind-overwrite are impossible.
- Stale update attempts fail with `409 ConflictError`, protecting against concurrent MCP, agent, or user edits.

### 1.3 Reserved `.openob` Metadata Boundary Guard

All plugin note operations (`read`, `create`, `update`, `delete`, `openNote`, `list`, `search`) enforce `isReservedWorkspacePath`. Any access to `.openob`, `.OPENOB`, or arbitrary case variants throws an `InvalidPathError` / is filtered out of listing.

### 1.4 Read-Only Workspace Enforcement

When a workspace is mounted in read-only mode, plugin mutation APIs (`create`, `update`, `delete`) fail closed with `403 ForbiddenError`.

### 1.5 Manifest Validation & Contribution Ownership

- Manifest fields (`id`, `name`, `version`, `apiVersion`, `permissions`, `contributes`) are rigorously validated at registration.
- Unknown permissions or duplicate permission declarations are rejected with `InvalidManifestError`.
- Plugins can only register commands and views explicitly declared in their `contributes` section (`UndeclaredContributionError`).
- Cross-plugin ID collisions are detected and rejected (`DuplicateContributionError`).
- Disabling a plugin removes all registered commands and views from the host.

### 1.6 AI Gateway Integration & Zero-Secret Leakage

- Plugin AI requests execute through `api.ai.chat(prompt)` which invokes the host's AI service.
- API keys, BYOK credentials, secret stores, and provider configuration remain completely inaccessible to plugins.

### 1.7 Crash & UI Containment

- Unhandled errors during `onload` set plugin status to `'error'` without crashing the host.
- Exceptions during `onunload` log warnings and still transition the plugin to `'disabled'`.
- Command execution exceptions return `{ success: false, error: err.message }`.
- Plugin view render failures render a fallback error element without unmounting the host application container.

---

## 2. First-Party Plugins Upgrade (API Version 2.x)

1. **Daily Notes** (`@okw/plugin/plugins/daily-notes`):
   - Manifest declares `apiVersion: "2.x"`, permissions `["vault.read", "vault.write", "workspace.modify"]`.
   - Uses `api.vault.create` (gracefully handling concurrent creation) and `api.workspace.openNote`.
2. **Templates** (`@okw/plugin/plugins/templates`):
   - Manifest declares `apiVersion: "2.x"`, permissions `["vault.read", "vault.write", "workspace.modify"]`.
   - `templates.insertDefault` reads current snapshot, modifies content, and writes with OCC `expectedVersion`.
3. **Word Count** (`@okw/plugin/plugins/word-count`):
   - Manifest declares `apiVersion: "2.x"`, permissions `["vault.read"]`.
   - Reads active note snapshot and computes stats.
4. **Character Bible** (`@okw/plugin/plugins/character-bible`):
   - Manifest declares `apiVersion: "2.x"`, permissions `["vault.read", "vault.write", "workspace.modify"]`.
   - Creates structured character cards under `Characters/` and lists roster via `api.vault.list`.
5. **Manuscript Tools** (`@okw/plugin/plugins/manuscript-tools`):
   - Manifest declares `apiVersion: "2.x"`, permissions `["vault.read"]`.
   - Scans `Manuscript/` and `Chapters/` notes to calculate progress against target word counts.

---

## 3. Developer Experience

A standard starter template is provided in `examples/plugin-template/`:

- `package.json`: standard metadata and `@okw/plugin` dependency.
- `src/index.ts`: demonstrates manifest declaration, lifecycle hooks, version-bound note updates, and commands.
- `README.md`: complete guide for authoring OpenOb plugins.

---

## 4. Truth on Security Boundaries

- **In-Process Capability Facade**: Built-in and first-party plugins execute in the same JavaScript runtime realm. The permission checks enforce contract correctness and fail-closed capability gates.
- **Third-Party Out-of-Process Isolation**: As documented in `docs/PLUGIN_ARCHITECTURE.md`, full sandbox isolation (Web Workers / sandboxed iframes with postMessage proxying and strict CSP) is scheduled prior to untrusted third-party distribution.

---

## 5. Verification Matrix

| Suite                                               | Tests        | Result     |
| --------------------------------------------------- | ------------ | ---------- |
| `packages/plugin/src/__tests__/plugin-host.test.ts` | 5            | PASSED     |
| `tests/integrity/plugin-sandbox.test.ts`            | 6            | PASSED     |
| `tests/integrity/first-party-plugins.test.ts`       | 4            | PASSED     |
| `tests/integrity/plugin-sdk-hardening.test.ts`      | 15           | PASSED     |
| `tests/e2e/plugin-gateway.spec.ts`                  | 1 (Chromium) | PASSED     |
| Full Workspace & Core Suite                         | All          | Clean Gate |
