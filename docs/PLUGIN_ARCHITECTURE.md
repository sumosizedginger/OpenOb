# PLUGIN ARCHITECTURE

## Objective

Allow third parties to extend the application without editing core.

The plugin system must be:

- permissioned
- versioned
- inspectable
- isolated
- developer-friendly
- optional

## Manifest

Example:

```json
{
  "id": "author.character-bible",
  "name": "Character Bible",
  "version": "1.0.0",
  "apiVersion": "2.x",
  "permissions": ["vault.read", "vault.write", "workspace.modify"],
  "contributes": {
    "commands": [
      { "id": "characterBible.create", "name": "Create Character Profile" },
      { "id": "characterBible.list", "name": "List Character Roster" }
    ],
    "views": [{ "id": "characterBible.sidebar", "name": "Character Bible" }]
  }
}
```

## Public API Surface (API Version 2.x)

```ts
// PluginAPI namespaces:
app.vault; // read(path), create(path, content), update(path, content, expectedVersion), delete(path, expectedVersion), list(folderPrefix?)
app.commands; // registerCommand({ id, name, callback })
app.workspace; // getActiveNotePath(), openNote(path)
app.search; // query(text, options?)
app.ai; // chat(prompt, options?)
app.ui; // registerView({ id, name, render }), showNotice(message)
app.manifest; // Read-only copy of plugin manifest
```

Plugins interact exclusively through `PluginAPI` backed by `PluginHostServices`. Internal storage, direct index mutations, and secret stores are completely inaccessible to plugins.

## Host Services Architecture & Dual-Mode Backend

`@okw/plugin` defines abstract `PluginHostServices`:

- `notes`: read, create, update, delete, list
- `search`: query
- `ai`: chat
- `workspace`: getActiveNotePath, openNote, showNotice

`createWorkspacePluginHostServices(backend, aiBackend, uiCallbacks)` in `@okw/workspace` bridges the workspace backend to host services:

- **Gateway Mode**: Routes plugin calls through `GatewayWorkspaceBackend` (HTTP REST).
- **Standalone Mode**: Routes plugin calls through `LocalWorkspaceBackend` (in-memory / FSA).
- **Read-Only Enforced**: If the workspace is mounted read-only, mutating note APIs fail closed with `403 ForbiddenError`.
- **Reserved Metadata Namespace Guard**: Plugin operations targeting `.openob/`, `.OPENOB/`, etc. are rejected immediately with `InvalidPathError`.

## Version-Aware Optimistic Concurrency Control (OCC)

Plugins cannot perform blind writes or fetch-latest-then-overwrite mutations:

1. `api.vault.read(path)` returns `PluginNoteSnapshot { path, content, version }`.
2. `api.vault.update(path, content, expectedVersion)` requires passing the snapshot's concurrency token.
3. If an external process or user modified the note in the interim, the update throws `409 ConflictError`.

## Isolation & Security Boundaries

### Current Runtime Model (Phase 3H: Built-In & First-Party Plugins)

- First-party and built-in plugins execute in-process against `PluginHost` and capability-gated `PluginAPI`.
- Permissions are strictly validated fail-closed on every API call against an immutable snapshot of declared permissions.
- Manifests are strictly validated at registration (`id` syntax, required fields, permission whitelist, duplicate prevention).
- Declared contribution enforcement: Plugins can only register commands and views explicitly declared in their `contributes` section.
- Registration collision prevention: Duplicate command and view IDs across plugins are rejected.
- Lifecycle & UI Crash Containment: Unhandled exceptions during `onload`, `onunload`, command execution, and view `render` are caught and isolated, preventing host or container crashing.
- AI Zero-Secret Leakage: AI prompts route through host `ai.chat`; API keys and credentials are never exposed to plugins.

### Target Future Model (Untrusted / Third-Party Marketplace Distribution)

- Out-of-process isolation using Web Workers or sandboxed iframes.
- Structured asynchronous message proxying across postMessage boundaries.
- Tight Content Security Policy (CSP) forbidding ambient global access.

## Permissions

Active capabilities in 2.x:

```text
vault.read        - Read notes and list folders
vault.write       - Create and update notes (requires OCC token)
vault.delete      - Delete notes (requires OCC token)
search.query      - Execute keyword search queries
ai.use            - Send chat queries through configured AI backend
workspace.modify  - Open notes in the active workspace editor
```

Permission changes across plugin upgrades must be shown to the user.

## First-Party Plugins

All five first-party plugins are fully implemented on top of the 2.x Plugin SDK:

1. **Daily Notes** (`@okw/plugin/plugins/daily-notes`): Opens/creates today's daily note under `Daily/YYYY-MM-DD.md`.
2. **Templates** (`@okw/plugin/plugins/templates`): Creates notes from templates and inserts default templates using OCC-guarded updates.
3. **Word Count** (`@okw/plugin/plugins/word-count`): Reads the active note snapshot and calculates word, character, and line stats.
4. **Character Bible** (`@okw/plugin/plugins/character-bible`): Creates character sheets under `Characters/` and lists roster.
5. **Manuscript Tools** (`@okw/plugin/plugins/manuscript-tools`): Aggregates chapter word counts and reports progress towards manuscript goals.

## Developer Experience & Template

A standalone developer template is provided in `examples/plugin-template/`:

- Complete `package.json` with `@okw/plugin` dependencies.
- Standard plugin lifecycle (`onload`, `onunload`) with version-aware OCC note updates and command registration.
- Documentation explaining manifest structure and capability gating.
