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
  "apiVersion": "1.x",
  "permissions": ["vault.read", "workspace.modify"],
  "contributes": {
    "commands": ["characterBible.create"],
    "views": ["characterBible.sidebar"]
  }
}
```

## Public API Surface

Potential namespaces:

```ts
app.commands;
app.workspace;
app.editor;
app.vault;
app.search;
app.graph;
app.ai;
app.settings;
app.ui;
```

Plugins must not import internal modules.

## Isolation

Current runtime model (First-Party Plugins):

- First-party plugins execute in the same JavaScript realm against `PluginHost` and `PluginAPI`.
- Capability permissions are validated fail-closed against an immutable snapshot of declared permissions (`F-006`, `F-030`).
- Runtime crashes during plugin lifecycle (load, unload, command execution) are trapped and contained, preventing workspace failure (`F-007`).
- Note: This is a permission facade, not an execution isolation boundary (`F-032`).

Target model (Required before third-party plugin distribution):

- Plugin logic in a dedicated Web Worker or isolated iframe.
- Message-based capability proxy over `postMessage`.
- Strict CSP and capability token isolation to prevent access to DOM or ambient storage (`sessionStorage`).

A plugin crash is recoverable:

```text
Plugin failed
[Restart]
[Disable]
[Report]
```

## Permissions

Potential capabilities:

```text
vault.read
vault.write
vault.delete
workspace.modify
editor.extend
search.query
graph.read
graph.extend
ai.use
ai.provider
network
clipboard
filesystem.external
```

Permission changes across plugin upgrades must be shown to the user.

## First-Party Dogfooding

Where practical, build non-core features through the same plugin API exposed to third parties.

Candidate first-party plugins:

- Daily Notes
- Templates
- Calendar
- Kanban
- Character Bible
- Manuscript Tools
- Git
- Citation Manager
- Publishing
- Advanced Graph
- AI providers

If a first-party plugin needs an undocumented escape hatch, treat that as evidence the public API is incomplete.

## Developer Experience

Target workflow:

```bash
npm create <project>-plugin
npm install
npm run dev
```

Development mode should support:

- local plugin folder
- hot reload
- manifest validation
- permission debugging
- API typing
- example plugins

## Registry

Do not build a marketplace before the API is stable.

Later registry metadata may include:

- plugin ID
- version
- API compatibility
- repository
- release artifact URL
- checksum
- permissions
- author
- license

Installation should eventually support:

- registry
- GitHub release
- URL
- ZIP
- local development folder

Alternative registries should be technically possible.

## API Stability

Once public:

- use semantic API versions
- deprecate before removal
- document breaking changes
- provide migration guidance
- maintain compatibility tests
