import { describe, expect, it, vi } from 'vitest';
import {
  PluginHost,
  PluginManifest,
  Plugin,
  PluginAPI,
  PluginHostServices,
  PermissionDeniedError,
  wordCountManifest,
  WordCountPlugin,
  dailyNotesManifest,
  DailyNotesPlugin,
} from '../index.js';

function createMockServices(initialNotes: Record<string, string> = {}): {
  services: PluginHostServices;
  store: Map<string, { content: string; version: string }>;
  activeNote: { path: string | null };
} {
  const store = new Map<string, { content: string; version: string }>();
  let vCounter = 1;
  for (const [k, v] of Object.entries(initialNotes)) {
    store.set(k, { content: v, version: `v${vCounter++}` });
  }

  const activeNote = { path: null as string | null };

  const services: PluginHostServices = {
    notes: {
      read: async (path) => {
        const item = store.get(path);
        if (!item) throw new Error(`Note not found: ${path}`);
        return { path, content: item.content, version: { token: item.version } };
      },
      create: async (path, content) => {
        if (store.has(path)) throw new Error(`Note already exists: ${path}`);
        const ver = `v${vCounter++}`;
        store.set(path, { content, version: ver });
        return { path, version: { token: ver } };
      },
      update: async (path, content, expected) => {
        const item = store.get(path);
        if (!item) throw new Error(`Note not found: ${path}`);
        if (item.version !== expected.token) throw new Error('Version conflict');
        const ver = `v${vCounter++}`;
        store.set(path, { content, version: ver });
        return { path, version: { token: ver } };
      },
      delete: async (path, expected) => {
        const item = store.get(path);
        if (!item) throw new Error(`Note not found: ${path}`);
        if (item.version !== expected.token) throw new Error('Version conflict');
        store.delete(path);
      },
      list: async (prefix) => {
        return Array.from(store.keys()).filter((p) => !prefix || p.startsWith(prefix)) as any[];
      },
    },
    search: {
      query: async (query) => {
        const res = [];
        for (const [p, item] of store.entries()) {
          if (item.content.includes(query) || p.includes(query)) {
            res.push({ path: p as any, title: p, score: 1 });
          }
        }
        return res;
      },
    },
    workspace: {
      getActiveNotePath: () => activeNote.path as any,
      openNote: async (p) => {
        activeNote.path = p;
      },
      showNotice: () => {},
    },
  };

  return { services, store, activeNote };
}

describe('Plugin SDK & Isolated Capability Host (Constitution Law 20)', () => {
  it('Law 20 (F-006): Throws PermissionDeniedError when plugin accesses undeclared capabilities', async () => {
    const { services } = createMockServices({ 'Secret.md': 'Classified document' });

    const unauthorizedManifest: PluginManifest = {
      id: 'unauthorized-plugin',
      name: 'Unauthorized Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
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
          await api.vault.create('Hacked.md', 'Data');
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

    const host = new PluginHost({ services });

    host.registerPlugin(unauthorizedManifest, () => new TestPlugin());
    const enabled = await host.enablePlugin(unauthorizedManifest.id);

    expect(enabled).toBe(true);
    expect(caughtVaultReadError).toBeInstanceOf(PermissionDeniedError);
    expect(caughtVaultWriteError).toBeInstanceOf(PermissionDeniedError);
    expect(caughtSearchError).toBeInstanceOf(PermissionDeniedError);
  });

  it('Law 20 (F-007): Crashing plugin during onload is safely contained and marked as error', async () => {
    const { services } = createMockServices();

    const buggyManifest: PluginManifest = {
      id: 'buggy-plugin',
      name: 'Buggy Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read'],
    };

    class CrashingPlugin implements Plugin {
      onload() {
        throw new Error('Fatal unhandled runtime exception in plugin onload');
      }
      onunload() {}
    }

    const host = new PluginHost({ services });

    host.registerPlugin(buggyManifest, () => new CrashingPlugin());
    const enabled = await host.enablePlugin(buggyManifest.id);

    // Host must NOT throw, return false, and isolate error
    expect(enabled).toBe(false);

    const inst = host.getPlugin(buggyManifest.id);
    expect(inst?.status).toBe('error');
    expect(inst?.error).toContain('Fatal unhandled runtime exception');
  });

  it('controls plugin lifecycle: enable, disable, and restart', async () => {
    const { services } = createMockServices();

    let loaded = false;
    let unloaded = false;

    const lifecycleManifest: PluginManifest = {
      id: 'lifecycle-test',
      name: 'Lifecycle Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
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

    const host = new PluginHost({ services });

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
    const { services, store, activeNote } = createMockServices({
      'Notes/Doc.md': '# Title\n\nOne two three four five words.',
    });
    activeNote.path = 'Notes/Doc.md';

    const noticeSpy = vi.fn();
    const openNoteSpy = vi.fn(async (p: any) => {
      activeNote.path = p;
    });

    const hostServices: PluginHostServices = {
      ...services,
      workspace: {
        ...services.workspace,
        getActiveNotePath: () => activeNote.path as any,
        openNote: openNoteSpy,
        showNotice: noticeSpy,
      },
    };

    const host = new PluginHost({ services: hostServices });

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

    const createdNote = store.get(`Daily/${today}.md`);
    expect(createdNote?.content).toContain(`# Daily Note: ${today}`);
  });

  it('P1-UI-001: enabled plugins dynamically observe updated context (no mount-time freezing)', async () => {
    const { services: servicesA, store: storeA } = createMockServices({
      'Initial.md': 'Initial content',
    });
    const { services: servicesB, store: storeB } = createMockServices();

    let capturedAPI: PluginAPI | null = null;
    const dynamicManifest: PluginManifest = {
      id: 'dynamic-context-plugin',
      name: 'Dynamic Context Plugin',
      version: '1.0.0',
      apiVersion: '2.x',
      permissions: ['vault.read', 'vault.write', 'workspace.modify'],
    };

    class ContextTestPlugin implements Plugin {
      async onload(api: PluginAPI) {
        capturedAPI = api;
      }
      onunload() {}
    }

    const host = new PluginHost({ services: servicesA });

    host.registerPlugin(dynamicManifest, () => new ContextTestPlugin());
    await host.enablePlugin(dynamicManifest.id);

    expect(capturedAPI).not.toBeNull();

    // 1. Initial write lands in storeA
    await capturedAPI!.vault.create('TestA.md', 'Content in A');
    expect(storeA.has('TestA.md')).toBe(true);
    expect(storeB.has('TestA.md')).toBe(false);

    // 2. Switch context to servicesB (simulating real vault switching in UI)
    host.updateContext({ services: servicesB });

    // 3. Write through previously enabled plugin MUST land in storeB, not storeA
    await capturedAPI!.vault.create('TestB.md', 'Content in B');
    expect(storeB.has('TestB.md')).toBe(true);
    expect(storeA.has('TestB.md')).toBe(false);
  });
});
