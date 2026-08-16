import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
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
import { ConflictError } from '@okw/core';

describe('Phase 9 Exit Gate: Plugin SDK, Isolated Capability Host & Crash Containment (Constitution Law 20)', () => {
  it('Law 20 (F-007): Crashing plugin does not crash workspace or interfere with other plugins', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    // 1. Seed vault
    const noteContent = `# Critical Work\n\nCore notes that must remain intact.`;
    await storage.write('Important.md', null, noteContent);
    await index.upsert(await parser.parse('Important.md', noteContent));

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: 'Important.md',
      openNote: async () => {},
      showNotice: () => {},
    });

    // 2. Register well-behaved plugin
    host.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    await host.enablePlugin(wordCountManifest.id);

    // 3. Register malicious / buggy crashing plugin
    const crashingManifest: PluginManifest = {
      id: 'malicious.crasher',
      name: 'Host Destroyer',
      version: '1.0.0',
      apiVersion: '1.x',
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
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    await storage.write('Confidential.md', null, '# Confidential Data');

    const unauthorizedManifest: PluginManifest = {
      id: 'unauthorized.reader',
      name: 'Unauthorized Reader',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: [], // Declares ZERO permissions!
    };

    let attemptReadError: any = null;
    let attemptWriteError: any = null;
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
              await api.vault.write('Injected.md', 'Data');
            } catch (e) {
              attemptWriteError = e;
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

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(unauthorizedManifest, () => new SnoopingPlugin());
    await host.enablePlugin(unauthorizedManifest.id);

    // Execute the unauthorized command
    await host.executeCommand('snoop.attack');

    // Law 20: Every unauthorized capability access MUST throw PermissionDeniedError
    expect(attemptReadError).toBeInstanceOf(PermissionDeniedError);
    expect(attemptWriteError).toBeInstanceOf(PermissionDeniedError);
    expect(attemptOpenNoteError).toBeInstanceOf(PermissionDeniedError);

    // Disk MUST NOT contain any injected file
    const exists = await storage.exists('Injected.md');
    expect(exists).toBe(false);
  });

  it('P9-2 (F-030) Regression: Self-escalation via api.manifest mutation fails closed', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    const readOnlyManifest: PluginManifest = {
      id: 'escalation.attacker',
      name: 'Escalation Attacker',
      version: '1.0.0',
      apiVersion: '1.x',
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

        // Attempt write after mutation
        try {
          await api.vault.write('HackedByEscalation.md', 'Malicious Data');
        } catch (err) {
          writeError = err;
        }
      }
      onunload() {}
    }

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(readOnlyManifest, () => new SelfEscalatingPlugin());
    await host.enablePlugin(readOnlyManifest.id);

    // Gatekeeper MUST throw PermissionDeniedError despite mutation attempt
    expect(writeError).toBeInstanceOf(PermissionDeniedError);

    // Disk MUST NOT contain the malicious file
    const fileExists = await storage.exists('HackedByEscalation.md');
    expect(fileExists).toBe(false);
  });

  it('P9-1 (F-031) Regression: Plugin write does not force-overwrite concurrent disk changes', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    const initialContent = `# Original Note\n\nInitial version.`;
    await storage.write('SharedNote.md', null, initialContent);

    const writeManifest: PluginManifest = {
      id: 'writer.plugin',
      name: 'Writer Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: ['vault.read', 'vault.write'],
    };

    let pluginApiHandle: PluginAPI | null = null;

    class SafeWriterPlugin implements Plugin {
      onload(api: PluginAPI) {
        pluginApiHandle = api;
      }
      onunload() {}
    }

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(writeManifest, () => new SafeWriterPlugin());
    await host.enablePlugin(writeManifest.id);
    expect(pluginApiHandle).not.toBeNull();

    // 1. Plugin reads note at version v1
    const v1Snap = await storage.read('SharedNote.md');

    // 2. User modifies file concurrently on disk to version v2
    const userEdits = `# Original Note\n\nUser edited this in parallel.`;
    await storage.write('SharedNote.md', v1Snap.version, userEdits);

    // 3. Plugin tries to write with stale snapshot
    let caughtConflict: any = null;
    try {
      // Simulate slow plugin write with stale version
      await storage.write('SharedNote.md', v1Snap.version, 'Stale Plugin Data');
    } catch (err) {
      caughtConflict = err;
    }

    // Must throw ConflictError and NEVER overwrite user edits
    expect(caughtConflict).toBeInstanceOf(ConflictError);

    const currentDisk = new TextDecoder().decode((await storage.read('SharedNote.md')).content);
    expect(currentDisk).toBe(userEdits);
    expect(currentDisk).not.toContain('Stale Plugin Data');
  });

  it('First-party plugins (DailyNotes) execute completely using public API contracts', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    let openedNote: string | null = null;
    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async (p) => {
        openedNote = p;
      },
      showNotice: () => {},
    });

    host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
    await host.enablePlugin(dailyNotesManifest.id);

    const runRes = await host.executeCommand('dailyNotes.openToday');
    expect(runRes.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(openedNote).toBe(`Daily/${today}.md`);

    const createdDoc = await storage.read(`Daily/${today}.md`);
    expect(new TextDecoder().decode(createdDoc.content)).toContain(`# Daily Note: ${today}`);
  });

  it('P1-PLUGIN-001 (F-032): Documents same-realm capability facade boundary and fail-closed permission enforcement', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    await storage.write('Secret.md', null, '# Secret Note');

    const readOnlyManifest: PluginManifest = {
      id: 'readonly.plugin',
      name: 'ReadOnly Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: ['vault.read'],
    };

    let pluginApi: PluginAPI | null = null;

    class ReadOnlyPlugin implements Plugin {
      onload(api: PluginAPI) {
        pluginApi = api;
      }
      onunload() {}
    }

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(readOnlyManifest, () => new ReadOnlyPlugin());
    await host.enablePlugin(readOnlyManifest.id);

    expect(pluginApi).not.toBeNull();

    // Permitted call succeeds
    const text = await pluginApi!.vault.read('Secret.md');
    expect(text).toBe('# Secret Note');

    // Undeclared write capability fails closed
    await expect(pluginApi!.vault.write('Secret.md', '# Hijacked')).rejects.toThrow(
      PermissionDeniedError
    );

    // Undeclared search capability fails closed
    await expect(pluginApi!.search.query('Secret')).rejects.toThrow(PermissionDeniedError);

    // Undeclared AI capability fails closed
    await expect(pluginApi!.ai.chat('test')).rejects.toThrow(PermissionDeniedError);
  });
});
