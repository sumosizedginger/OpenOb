# OpenOb Plugin Template

This directory contains a developer starter template demonstrating how to build and structure an OpenOb plugin adhering to the **Phase 3H Hardened Plugin SDK**.

---

## Architectural Rules

1. **Declared Permissions (`manifest.permissions`)**:
   Plugins must explicitly declare every capability they require (`vault.read`, `vault.write`, `vault.delete`, `workspace.modify`, `search.query`, `ai.use`). Undeclared access fails closed with a `PermissionDeniedError`.

2. **Strict OCC Mutation Safety**:
   All note mutations are version-aware:
   - `api.vault.read(path)` returns `{ path, content, version }`.
   - `api.vault.create(path, content)` creates a new note.
   - `api.vault.update(path, content, expectedVersion)` updates an existing note and throws a 409 `ConflictError` if the note was changed concurrently.
   - `api.vault.delete(path, expectedVersion)` deletes a note with OCC checking.

3. **Reserved Metadata Isolation**:
   Plugins cannot access internal workspace metadata under `.openob/`. Any attempt to read or mutate `.openob` files will be rejected.

4. **Contribution Declaration**:
   All commands and views registered via `api.commands.registerCommand` or `api.ui.registerView` must be pre-declared in `manifest.contributes`.

---

## Example Usage

```ts
import { Plugin, PluginAPI, PluginManifest } from '@okw/plugin';

export const myPluginManifest: PluginManifest = {
  id: 'com.example.my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  apiVersion: '2.x',
  permissions: ['vault.read', 'vault.write', 'workspace.modify'],
  contributes: {
    commands: [{ id: 'myPlugin.run', name: 'Run My Plugin' }],
  },
};

export class MyPlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'myPlugin.run',
      name: 'Run My Plugin',
      callback: async () => {
        const activePath = api.workspace.getActiveNotePath();
        if (!activePath) return;

        const snap = await api.vault.read(activePath);
        await api.vault.update(activePath, snap.content + '\n# Appended', snap.version);
        api.ui.showNotice('Updated note!');
      },
    });
  }

  onunload(): void {}
}
```
