import { describe, expect, it, vi } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
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
} from '../index.js';

describe('Plugin SDK & Isolated Capability Host (Constitution Law 20)', () => {
  it('Law 20 (F-006): Throws PermissionDeniedError when plugin accesses undeclared capabilities', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    await storage.write('Secret.md', null, 'Classified document');

    const unauthorizedManifest: PluginManifest = {
      id: 'unauthorized-plugin',
      name: 'Unauthorized Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: ['workspace.modify'], // ONLY workspace.modify, NO vault.read or vault.write
    };

    let caughtVaultReadError: Error | null = null;
    let caughtVaultWriteError: Error | null = null;
    let caughtSearchError: Error | null = null;

    class TestPlugin implements Plugin {
      async onload(api: PluginAPI) {
        try {
          await api.vault.read('Secret.md');
        } catch (e: any) {
          caughtVaultReadError = e;
        }

        try {
          await api.vault.write('Hacked.md', 'Data');
        } catch (e: any) {
          caughtVaultWriteError = e;
        }

        try {
          await api.search.query('Secret');
        } catch (e: any) {
          caughtSearchError = e;
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

    host.registerPlugin(unauthorizedManifest, () => new TestPlugin());
    const enabled = await host.enablePlugin(unauthorizedManifest.id);

    expect(enabled).toBe(true);
    expect(caughtVaultReadError).toBeInstanceOf(PermissionDeniedError);
    expect(caughtVaultWriteError).toBeInstanceOf(PermissionDeniedError);
    expect(caughtSearchError).toBeInstanceOf(PermissionDeniedError);
  });

  it('Law 20 (F-007): Crashing plugin during onload is safely contained and marked as error', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    const buggyManifest: PluginManifest = {
      id: 'buggy-plugin',
      name: 'Buggy Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: ['vault.read'],
    };

    class CrashingPlugin implements Plugin {
      onload() {
        throw new Error('Fatal unhandled runtime exception in plugin onload');
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

    host.registerPlugin(buggyManifest, () => new CrashingPlugin());
    const enabled = await host.enablePlugin(buggyManifest.id);

    // Host must NOT throw, return false, and isolate error
    expect(enabled).toBe(false);

    const inst = host.getPlugin(buggyManifest.id);
    expect(inst?.status).toBe('error');
    expect(inst?.error).toContain('Fatal unhandled runtime exception');
  });

  it('controls plugin lifecycle: enable, disable, and restart', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    let loaded = false;
    let unloaded = false;

    const lifecycleManifest: PluginManifest = {
      id: 'lifecycle-test',
      name: 'Lifecycle Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: [],
    };

    class LifecyclePlugin implements Plugin {
      onload() {
        loaded = true;
      }
      onunload() {
        unloaded = true;
      }
    }

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(lifecycleManifest, () => new LifecyclePlugin());
    expect(host.getPlugin(lifecycleManifest.id)?.status).toBe('loaded');

    await host.enablePlugin(lifecycleManifest.id);
    expect(loaded).toBe(true);
    expect(host.getPlugin(lifecycleManifest.id)?.status).toBe('enabled');

    await host.disablePlugin(lifecycleManifest.id);
    expect(unloaded).toBe(true);
    expect(host.getPlugin(lifecycleManifest.id)?.status).toBe('disabled');

    await host.restartPlugin(lifecycleManifest.id);
    expect(host.getPlugin(lifecycleManifest.id)?.status).toBe('enabled');
  });

  it('runs first-party plugins (WordCount and DailyNotes) cleanly via public API', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    await storage.write('Notes/Doc.md', null, '# Title\n\nOne two three four five words.');

    const noticeSpy = vi.fn();
    const openNoteSpy = vi.fn();

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: 'Notes/Doc.md',
      openNote: openNoteSpy,
      showNotice: noticeSpy,
    });

    // 1. Word Count Plugin
    host.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    await host.enablePlugin(wordCountManifest.id);

    const execWordCount = await host.executeCommand('wordCount.compute');
    expect(execWordCount.success).toBe(true);
    expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining('8 words'));

    // 2. Daily Notes Plugin
    host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
    await host.enablePlugin(dailyNotesManifest.id);

    const execDaily = await host.executeCommand('dailyNotes.openToday');
    expect(execDaily.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(openNoteSpy).toHaveBeenCalledWith(`Daily/${today}.md`);

    const createdNote = await storage.read(`Daily/${today}.md`);
    expect(new TextDecoder().decode(createdNote.content)).toContain(`# Daily Note: ${today}`);
  });

  it('P1-UI-001: enabled plugins dynamically observe updated context (no mount-time freezing)', async () => {
    const storageA = new MemoryVaultStorage();
    const storageB = new MemoryVaultStorage();
    const indexA = new MemoryDocumentIndex();
    const indexB = new MemoryDocumentIndex();

    let capturedAPI: PluginAPI | null = null;
    const dynamicManifest: PluginManifest = {
      id: 'dynamic-context-plugin',
      name: 'Dynamic Context Plugin',
      version: '1.0.0',
      apiVersion: '1.x',
      permissions: ['vault.read', 'vault.write', 'workspace.modify'],
    };

    class ContextTestPlugin implements Plugin {
      async onload(api: PluginAPI) {
        capturedAPI = api;
      }
      onunload() {}
    }

    const host = new PluginHost({
      storage: storageA,
      index: indexA,
      activeNotePath: 'Initial.md',
      openNote: async () => {},
      showNotice: () => {},
    });

    host.registerPlugin(dynamicManifest, () => new ContextTestPlugin());
    await host.enablePlugin(dynamicManifest.id);

    expect(capturedAPI).not.toBeNull();

    // 1. Initial write lands in storageA
    await capturedAPI!.vault.write('TestA.md', 'Content in A');
    expect(await storageA.exists('TestA.md')).toBe(true);
    expect(await storageB.exists('TestA.md')).toBe(false);
    expect(capturedAPI!.workspace.getActiveNotePath()).toBe('Initial.md');

    // 2. Switch context to storageB (simulating real vault opening in UI)
    host.updateContext({
      storage: storageB,
      index: indexB,
      activeNotePath: 'ActiveInB.md',
    });

    // 3. Write through previously enabled plugin MUST land in storageB, not storageA
    await capturedAPI!.vault.write('TestB.md', 'Content in B');
    expect(await storageB.exists('TestB.md')).toBe(true);
    expect(await storageA.exists('TestB.md')).toBe(false);

    // 4. Workspace active note path MUST reflect updated context
    expect(capturedAPI!.workspace.getActiveNotePath()).toBe('ActiveInB.md');
  });
});
