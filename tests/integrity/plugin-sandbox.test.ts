import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { MemoryDocumentIndex, executePropertyQuery, buildGraphData } from '@okw/index';
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
});
