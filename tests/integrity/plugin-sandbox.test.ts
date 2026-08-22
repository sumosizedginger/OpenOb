import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  OpenObWorkspace,
  LocalWorkspaceBackend,
  createWorkspacePluginHostServices,
} from '@okw/workspace';
import {
  PluginHost,
  PluginManifest,
  Plugin,
  PluginAPI,
  PermissionDeniedError,
  wordCountManifest,
  WordCountPlugin,
  dailyNotesManifest,
  DailyNotesPlugin,
} from '@okw/plugin';
import { ConflictError, VaultPath } from '@okw/core';

function createHarness(options?: { activeNotePath?: string | null }) {
  const storage = new MemoryVaultStorage();
  const index = new MemoryDocumentIndex();
  const parser = new DefaultDocumentParser();

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    readOnly: false,
  });
  const backend = new LocalWorkspaceBackend(workspace);

  let currentActiveNote = options?.activeNotePath ?? null;
  let openedNote: string | null = null;

  const services = createWorkspacePluginHostServices(backend, undefined, {
    getActiveNotePath: () => currentActiveNote as any,
    openNote: async (p) => {
      openedNote = p;
      currentActiveNote = p;
    },
    showNotice: () => {},
  });

  const host = new PluginHost({ services });
  return {
    host,
    workspace,
    backend,
    storage,
    index,
    getOpenedNote: () => openedNote,
    setActiveNote: (p: string | null) => {
      currentActiveNote = p;
    },
  };
}

describe('Phase 9 Exit Gate: Plugin SDK, Isolated Capability Host & Crash Containment (Constitution Law 20)', () => {
  it('Law 20 (F-007): Crashing plugin does not crash workspace or interfere with other plugins', async () => {
    const { host, workspace, storage, index } = createHarness({ activeNotePath: 'Important.md' });

    // 1. Seed vault
    const noteContent = `# Critical Work\n\nCore notes that must remain intact.`;
    await workspace.createNote({ path: 'Important.md', content: noteContent });

    // 2. Register well-behaved plugin
    host.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    await host.enablePlugin(wordCountManifest.id);

    // 3. Register malicious / buggy crashing plugin
    const crashingManifest: PluginManifest = {
      id: 'malicious.crasher',
      name: 'Host Destroyer',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read'],
    };

    class ExplodingPlugin implements Plugin {
      onload() {
        throw new Error('Explosive runtime crash during plugin initialization!');
      }
      onunload() {}
    }

    host.registerPlugin(crashingManifest, () => new ExplodingPlugin());
    const crashEnableResult = await host.enablePlugin(crashingManifest.id);

    // Assert crash was contained cleanly
    expect(crashEnableResult).toBe(false);
    expect(host.getPlugin(crashingManifest.id)?.status).toBe('error');

    // 4. Verify healthy plugin is STILL 100% operational
    expect(host.getPlugin(wordCountManifest.id)?.status).toBe('enabled');
    const wordCountRun = await host.executeCommand('wordCount.compute');
    expect(wordCountRun.success).toBe(true);

    // 5. Verify core workspace operations remain 100% operational
    const diskText = new TextDecoder().decode((await storage.read('Important.md')).content);
    expect(diskText).toBe(noteContent);

    const searchRes = await index.query({ query: 'Critical' });
    expect(searchRes).toHaveLength(1);

    const graph = await buildGraphData(index);
    expect(graph.nodes).toHaveLength(1);
  });

  it('Law 20 (F-006): Unauthorized capability calls fail closed with PermissionDeniedError', async () => {
    const { host, workspace, storage } = createHarness();
    await workspace.createNote({ path: 'Confidential.md', content: '# Confidential Data' });

    const unauthorizedManifest: PluginManifest = {
      id: 'unauthorized.reader',
      name: 'Unauthorized Reader',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: [], // Declares ZERO permissions!
    };

    let attemptReadError: any = null;
    let attemptCreateError: any = null;
    let attemptOpenNoteError: any = null;

    class SnoopingPlugin implements Plugin {
      onload(api: PluginAPI) {
        api.commands.registerCommand({
          id: 'snoop.attack',
          name: 'Snoop Attack',
          callback: async () => {
            try {
              await api.vault.read('Confidential.md');
            } catch (e) {
              attemptReadError = e;
            }

            try {
              await api.vault.create('Injected.md', 'Data');
            } catch (e) {
              attemptCreateError = e;
            }

            try {
              await api.workspace.openNote('Confidential.md');
            } catch (e) {
              attemptOpenNoteError = e;
            }
          },
        });
      }
      onunload() {}
    }

    host.registerPlugin(unauthorizedManifest, () => new SnoopingPlugin());
    await host.enablePlugin(unauthorizedManifest.id);

    // Execute the unauthorized command
    await host.executeCommand('snoop.attack');

    // Law 20: Every unauthorized capability access MUST throw PermissionDeniedError
    expect(attemptReadError).toBeInstanceOf(PermissionDeniedError);
    expect(attemptCreateError).toBeInstanceOf(PermissionDeniedError);
    expect(attemptOpenNoteError).toBeInstanceOf(PermissionDeniedError);

    // Disk MUST NOT contain any injected file
    const exists = await storage.exists('Injected.md');
    expect(exists).toBe(false);
  });

  it('P9-2 (F-030) Regression: Self-escalation via api.manifest mutation fails closed', async () => {
    const { host, workspace, storage } = createHarness();
    await workspace.createNote({ path: 'Shared.md', content: '# Initial' });

    const readOnlyManifest: PluginManifest = {
      id: 'escalation.attacker',
      name: 'Escalation Attacker',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read'], // ONLY read, NOT write
    };

    let writeError: any = null;

    class SelfEscalatingPlugin implements Plugin {
      async onload(api: PluginAPI) {
        // Attempting to mutate returned manifest permissions array
        try {
          (api.manifest.permissions as any).push('vault.write');
        } catch {
          // Object.freeze might throw in strict mode
        }

        // Attempt create/write after mutation
        try {
          await api.vault.create('HackedByEscalation.md', 'Malicious Data');
        } catch (err) {
          writeError = err;
        }
      }
      onunload() {}
    }

    host.registerPlugin(readOnlyManifest, () => new SelfEscalatingPlugin());
    await host.enablePlugin(readOnlyManifest.id);

    // Gatekeeper MUST throw PermissionDeniedError despite mutation attempt
    expect(writeError).toBeInstanceOf(PermissionDeniedError);

    // Disk MUST NOT contain the malicious file
    const fileExists = await storage.exists('HackedByEscalation.md');
    expect(fileExists).toBe(false);
  });

  it('P9-1 (F-031) Regression: Plugin write does not force-overwrite concurrent disk changes', async () => {
    const { host, workspace } = createHarness();

    const initialContent = `# Original Note\n\nInitial version.`;
    const initialNote = await workspace.createNote({
      path: 'SharedNote.md',
      content: initialContent,
    });

    const writeManifest: PluginManifest = {
      id: 'writer.plugin',
      name: 'Writer Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read', 'vault.write'],
    };

    let pluginApiHandle: PluginAPI | null = null;

    class SafeWriterPlugin implements Plugin {
      onload(api: PluginAPI) {
        pluginApiHandle = api;
      }
      onunload() {}
    }

    host.registerPlugin(writeManifest, () => new SafeWriterPlugin());
    await host.enablePlugin(writeManifest.id);
    expect(pluginApiHandle).not.toBeNull();

    // 1. Plugin reads note at version v1
    const v1Snap = await pluginApiHandle!.vault.read('SharedNote.md');

    // 2. User modifies file concurrently on disk to version v2
    const userEdits = `# Original Note\n\nUser edited this in parallel.`;
    await workspace.updateNote({
      path: 'SharedNote.md',
      content: userEdits,
      expectedVersion: initialNote.currentVersion,
    });

    // 3. Plugin tries to write with stale snapshot v1
    let caughtConflict: any = null;
    try {
      await pluginApiHandle!.vault.update('SharedNote.md', 'Stale Plugin Data', v1Snap.version);
    } catch (err) {
      caughtConflict = err;
    }

    // Must throw ConflictError and NEVER overwrite user edits
    expect(caughtConflict).toBeInstanceOf(ConflictError);

    const currentDisk = (await workspace.readNote('SharedNote.md')).textContent;
    expect(currentDisk).toBe(userEdits);
    expect(currentDisk).not.toContain('Stale Plugin Data');
  });

  it('First-party plugins (DailyNotes) execute completely using public API contracts', async () => {
    const { host, workspace, getOpenedNote } = createHarness();

    host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
    await host.enablePlugin(dailyNotesManifest.id);

    const runRes = await host.executeCommand('dailyNotes.openToday');
    expect(runRes.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(getOpenedNote()).toBe(`Daily/${today}.md`);

    const createdDoc = await workspace.readNote(`Daily/${today}.md`);
    expect(createdDoc.textContent).toContain(`# Daily Note: ${today}`);
  });

  it('P1-PLUGIN-001 (F-032): Documents same-realm capability facade boundary and fail-closed permission enforcement', async () => {
    const { host, workspace } = createHarness();
    await workspace.createNote({ path: 'Secret.md', content: '# Secret Note' });

    const readOnlyManifest: PluginManifest = {
      id: 'readonly.plugin',
      name: 'ReadOnly Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read'],
    };

    let pluginApi: PluginAPI | null = null;

    class ReadOnlyPlugin implements Plugin {
      onload(api: PluginAPI) {
        pluginApi = api;
      }
      onunload() {}
    }

    host.registerPlugin(readOnlyManifest, () => new ReadOnlyPlugin());
    await host.enablePlugin(readOnlyManifest.id);

    expect(pluginApi).not.toBeNull();

    // Permitted call succeeds
    const snap = await pluginApi!.vault.read('Secret.md');
    expect(snap.content).toBe('# Secret Note');

    // Undeclared write capability fails closed
    await expect(pluginApi!.vault.create('Secret2.md', '# Hijacked')).rejects.toThrow(
      PermissionDeniedError
    );

    // Undeclared search capability fails closed
    await expect(pluginApi!.search.query('Secret')).rejects.toThrow(PermissionDeniedError);

    // Undeclared AI capability fails closed
    await expect(pluginApi!.ai.chat('test')).rejects.toThrow(PermissionDeniedError);
  });
});
