import { describe, expect, it, vi } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  OpenObWorkspace,
  LocalWorkspaceBackend,
  createWorkspacePluginHostServices,
  ForbiddenError,
  AIBackend,
} from '@okw/workspace';
import {
  PluginHost,
  PluginManifest,
  Plugin,
  PluginAPI,
  PermissionDeniedError,
  InvalidManifestError,
  UndeclaredContributionError,
  DuplicateContributionError,
  templatesManifest,
  TemplatesPlugin,
  dailyNotesManifest,
  DailyNotesPlugin,
} from '@okw/plugin';
import { ConflictError, VaultPath } from '@okw/core';
import { AIModel, AIProviderId, AIProviderInfo } from '@okw/ai';

async function setupWorkspace(options?: {
  readOnly?: boolean;
  initialNotes?: Record<string, string>;
  activeNotePath?: string | null;
  aiBackend?: AIBackend;
}) {
  const storage = new MemoryVaultStorage();
  const index = new MemoryDocumentIndex();
  const parser = new DefaultDocumentParser();

  if (options?.initialNotes) {
    for (const [p, content] of Object.entries(options.initialNotes)) {
      await storage.write(p, null, content);
      await index.upsert(await parser.parse(p, content));
    }
  }

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    readOnly: options?.readOnly ?? false,
  });
  const backend = new LocalWorkspaceBackend(workspace);

  let activePath = options?.activeNotePath ?? null;
  let lastOpenedNote: string | null = null;
  let lastNotice: string | null = null;

  const services = createWorkspacePluginHostServices(backend, options?.aiBackend, {
    getActiveNotePath: () => activePath as any,
    openNote: async (p) => {
      lastOpenedNote = p;
      activePath = p;
    },
    showNotice: (m) => {
      lastNotice = m;
    },
  });

  const host = new PluginHost({ services });

  return {
    workspace,
    backend,
    storage,
    index,
    host,
    services,
    getActivePath: () => activePath,
    setActivePath: (p: string | null) => {
      activePath = p;
    },
    getLastOpenedNote: () => lastOpenedNote,
    getLastNotice: () => lastNotice,
  };
}

describe('Phase 3H: Plugin SDK Authority & Capability Hardening', () => {
  // ---------------------------------------------------------------------------
  // 1. Permission Matrix
  // ---------------------------------------------------------------------------
  describe('1. Permission Matrix & Fail-Closed Enforcement', () => {
    it('enforces complete capability permission matrix', async () => {
      const { host } = await setupWorkspace({
        initialNotes: { 'Notes/Existing.md': 'Existing content' },
      });

      const fullManifest: PluginManifest = {
        id: 'matrix.full',
        name: 'Full Plugin',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [
          'vault.read',
          'vault.write',
          'vault.delete',
          'search.query',
          'workspace.modify',
        ],
      };

      const emptyManifest: PluginManifest = {
        id: 'matrix.empty',
        name: 'Empty Plugin',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
      };

      let fullApi: PluginAPI | null = null;
      let emptyApi: PluginAPI | null = null;

      class FullPlugin implements Plugin {
        onload(api: PluginAPI) {
          fullApi = api;
        }
        onunload() {}
      }

      class EmptyPlugin implements Plugin {
        onload(api: PluginAPI) {
          emptyApi = api;
        }
        onunload() {}
      }

      host.registerPlugin(fullManifest, () => new FullPlugin());
      host.registerPlugin(emptyManifest, () => new EmptyPlugin());
      await host.enablePlugin(fullManifest.id);
      await host.enablePlugin(emptyManifest.id);

      expect(fullApi).not.toBeNull();
      expect(emptyApi).not.toBeNull();

      // Read
      const snap = await fullApi!.vault.read('Notes/Existing.md');
      expect(snap.content).toBe('Existing content');
      await expect(emptyApi!.vault.read('Notes/Existing.md')).rejects.toThrow(
        PermissionDeniedError
      );

      // List
      const list = await fullApi!.vault.list('Notes');
      expect(list).toContain('Notes/Existing.md');
      await expect(emptyApi!.vault.list('Notes')).rejects.toThrow(PermissionDeniedError);

      // Create
      const created = await fullApi!.vault.create('Notes/New.md', 'New note content');
      expect(created.version).toBeDefined();
      await expect(emptyApi!.vault.create('Notes/New2.md', 'Data')).rejects.toThrow(
        PermissionDeniedError
      );

      // Update
      const updated = await fullApi!.vault.update(
        'Notes/New.md',
        'Updated note content',
        created.version
      );
      expect(updated.version).toBeDefined();
      await expect(emptyApi!.vault.update('Notes/New.md', 'Data', created.version)).rejects.toThrow(
        PermissionDeniedError
      );

      // Search
      const searchRes = await fullApi!.search.query('Updated');
      expect(searchRes.length).toBeGreaterThan(0);
      await expect(emptyApi!.search.query('Updated')).rejects.toThrow(PermissionDeniedError);

      // Workspace modify (openNote)
      await fullApi!.workspace.openNote('Notes/New.md');
      await expect(emptyApi!.workspace.openNote('Notes/New.md')).rejects.toThrow(
        PermissionDeniedError
      );

      // Delete
      await fullApi!.vault.delete('Notes/New.md', updated.version);
      await expect(emptyApi!.vault.delete('Notes/Existing.md', snap.version)).rejects.toThrow(
        PermissionDeniedError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Manifest Validation & Tamper Resistance
  // ---------------------------------------------------------------------------
  describe('2. Manifest Validation & Tamper Resistance', () => {
    it('rejects malformed and invalid manifests at registration', async () => {
      const { host } = await setupWorkspace();

      class DummyPlugin implements Plugin {
        onload() {}
        onunload() {}
      }

      // Invalid ID
      expect(() =>
        host.registerPlugin(
          {
            id: 'invalid id with spaces!',
            name: 'Bad ID',
            version: '1.0.0',
            apiVersion: '2.x',
            permissions: [],
          },
          () => new DummyPlugin()
        )
      ).toThrow(InvalidManifestError);

      // Empty name
      expect(() =>
        host.registerPlugin(
          {
            id: 'bad.name',
            name: '',
            version: '1.0.0',
            apiVersion: '2.x',
            permissions: [],
          },
          () => new DummyPlugin()
        )
      ).toThrow(InvalidManifestError);

      // Unknown permission
      expect(() =>
        host.registerPlugin(
          {
            id: 'bad.perm',
            name: 'Bad Perm',
            version: '1.0.0',
            apiVersion: '2.x',
            permissions: ['super.admin' as any],
          },
          () => new DummyPlugin()
        )
      ).toThrow(InvalidManifestError);

      // Duplicate permission
      expect(() =>
        host.registerPlugin(
          {
            id: 'dup.perm',
            name: 'Dup Perm',
            version: '1.0.0',
            apiVersion: '2.x',
            permissions: ['vault.read', 'vault.read'],
          },
          () => new DummyPlugin()
        )
      ).toThrow(InvalidManifestError);
    });

    it('rejects duplicate plugin registration ID collision', async () => {
      const { host } = await setupWorkspace();
      const manifest: PluginManifest = {
        id: 'dup.plugin',
        name: 'Plugin 1',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
      };

      class P1 implements Plugin {
        onload() {}
        onunload() {}
      }

      host.registerPlugin(manifest, () => new P1());
      expect(() => host.registerPlugin(manifest, () => new P1())).toThrow(
        DuplicateContributionError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Contribution Ownership & Collision Protection
  // ---------------------------------------------------------------------------
  describe('3. Contribution Ownership & Collision Protection', () => {
    it('rejects undeclared command and view registrations', async () => {
      const { host } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'undeclared.test',
        name: 'Undeclared Test',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
        contributes: {
          commands: [{ id: 'declared.cmd', name: 'Declared Command' }],
          views: [{ id: 'declared.view', name: 'Declared View' }],
        },
      };

      let caughtCmdErr: any = null;
      let caughtViewErr: any = null;

      class RoguePlugin implements Plugin {
        onload(api: PluginAPI) {
          try {
            api.commands.registerCommand({
              id: 'rogue.cmd',
              name: 'Rogue Command',
              callback: () => {},
            });
          } catch (e) {
            caughtCmdErr = e;
          }

          try {
            api.ui.registerView({
              id: 'rogue.view',
              name: 'Rogue View',
              render: () => {},
            });
          } catch (e) {
            caughtViewErr = e;
          }
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new RoguePlugin());
      await host.enablePlugin(manifest.id);

      expect(caughtCmdErr).toBeInstanceOf(UndeclaredContributionError);
      expect(caughtViewErr).toBeInstanceOf(UndeclaredContributionError);
    });

    it('rejects command and view collision across enabled plugins', async () => {
      const { host } = await setupWorkspace();

      const manifestA: PluginManifest = {
        id: 'plugin.a',
        name: 'Plugin A',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
        contributes: {
          commands: [{ id: 'shared.cmd', name: 'Shared Command' }],
        },
      };

      const manifestB: PluginManifest = {
        id: 'plugin.b',
        name: 'Plugin B',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
        contributes: {
          commands: [{ id: 'shared.cmd', name: 'Shared Command' }],
        },
      };

      class PluginA implements Plugin {
        onload(api: PluginAPI) {
          api.commands.registerCommand({
            id: 'shared.cmd',
            name: 'Shared Command A',
            callback: () => {},
          });
        }
        onunload() {}
      }

      class PluginB implements Plugin {
        onload(api: PluginAPI) {
          api.commands.registerCommand({
            id: 'shared.cmd',
            name: 'Shared Command B',
            callback: () => {},
          });
        }
        onunload() {}
      }

      host.registerPlugin(manifestA, () => new PluginA());
      host.registerPlugin(manifestB, () => new PluginB());

      const aEnabled = await host.enablePlugin(manifestA.id);
      expect(aEnabled).toBe(true);

      // Plugin B enabling must fail with collision error contained
      const bEnabled = await host.enablePlugin(manifestB.id);
      expect(bEnabled).toBe(false);
      expect(host.getPlugin(manifestB.id)?.status).toBe('error');
      expect(host.getPlugin(manifestB.id)?.error).toContain(
        'Duplicate command registration collision'
      );
    });

    it('cleans up contributions when a plugin is disabled', async () => {
      const { host } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'cleanup.test',
        name: 'Cleanup Test',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
        contributes: {
          commands: [{ id: 'cleanup.cmd', name: 'Cleanup Command' }],
        },
      };

      let executed = false;
      class CleanupPlugin implements Plugin {
        onload(api: PluginAPI) {
          api.commands.registerCommand({
            id: 'cleanup.cmd',
            name: 'Cleanup Command',
            callback: () => {
              executed = true;
            },
          });
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new CleanupPlugin());
      await host.enablePlugin(manifest.id);

      expect(host.getAllCommands().some((c) => c.id === 'cleanup.cmd')).toBe(true);

      await host.disablePlugin(manifest.id);
      expect(host.getAllCommands().some((c) => c.id === 'cleanup.cmd')).toBe(false);

      const execRes = await host.executeCommand('cleanup.cmd');
      expect(execRes.success).toBe(false);
      expect(executed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Strict OCC Mutation Safety & Concurrency
  // ---------------------------------------------------------------------------
  describe('4. Strict OCC Mutation Safety & Concurrency Races', () => {
    it('enforces expectedVersion on vault.update and rejects stale concurrent updates with ConflictError', async () => {
      const { host, workspace } = await setupWorkspace({
        initialNotes: { 'Shared.md': 'V1 by User' },
      });

      const manifest: PluginManifest = {
        id: 'occ.tester',
        name: 'OCC Tester',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: ['vault.read', 'vault.write'],
      };

      let apiHandle: PluginAPI | null = null;
      class OCCPlugin implements Plugin {
        onload(api: PluginAPI) {
          apiHandle = api;
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new OCCPlugin());
      await host.enablePlugin(manifest.id);
      expect(apiHandle).not.toBeNull();

      // 1. Read note at V1
      const snapV1 = await apiHandle!.vault.read('Shared.md');
      expect(snapV1.content).toBe('V1 by User');

      // 2. External MCP / user modifies file to V2
      await workspace.updateNote({
        path: 'Shared.md',
        content: 'V2 by External MCP',
        expectedVersion: snapV1.version,
      });

      // 3. Plugin tries to update using stale V1 snapshot
      let conflictErr: any = null;
      try {
        await apiHandle!.vault.update('Shared.md', 'V1 Plugin Overwrite Attempt', snapV1.version);
      } catch (e) {
        conflictErr = e;
      }

      expect(conflictErr).toBeInstanceOf(ConflictError);

      // Verify V2 was NOT overwritten
      const diskContent = (await workspace.readNote('Shared.md')).textContent;
      expect(diskContent).toBe('V2 by External MCP');
      expect(diskContent).not.toContain('V1 Plugin Overwrite Attempt');
    });

    it('TemplatesPlugin.insertDefault enforces OCC and does not overwrite concurrent changes', async () => {
      const { host, workspace } = await setupWorkspace({
        initialNotes: { 'Project/Meeting.md': '# Project Notes\n' },
        activeNotePath: 'Project/Meeting.md',
      });

      host.registerPlugin(templatesManifest, () => new TemplatesPlugin());
      await host.enablePlugin(templatesManifest.id);

      // 1. Read note initially at V1
      const initialDoc = await workspace.readNote('Project/Meeting.md');

      // 2. External edit changes note to V2
      await workspace.updateNote({
        path: 'Project/Meeting.md',
        content: '# Project Notes\n\n## External Update in parallel\n',
        expectedVersion: initialDoc.version,
      });

      // 3. Run insert meeting template command
      const res = await host.executeCommand('templates.insertDefault');
      expect(res.success).toBe(true);

      // Verify that the template was appended to the current active note snapshot
      const currentDoc = await workspace.readNote('Project/Meeting.md');
      expect(currentDoc.textContent).toContain('## External Update in parallel');
      expect(currentDoc.textContent).toContain('Meeting Notes');
    });

    it('DailyNotesPlugin handles concurrent day-note creation without crashing or losing data', async () => {
      const { host, workspace } = await setupWorkspace();

      host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
      await host.enablePlugin(dailyNotesManifest.id);

      const today = new Date().toISOString().slice(0, 10);
      const dailyPath = `Daily/${today}.md`;

      // Simulate race: external process creates daily note first
      await workspace.createNote({
        path: dailyPath,
        content: `# Pre-existing Daily Note from Mobile\n`,
      });

      // Plugin runs dailyNotes.openToday
      const res = await host.executeCommand('dailyNotes.openToday');
      expect(res.success).toBe(true);

      // Note content must be preserved
      const doc = await workspace.readNote(dailyPath);
      expect(doc.textContent).toBe(`# Pre-existing Daily Note from Mobile\n`);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Reserved .openob Boundary Isolation
  // ---------------------------------------------------------------------------
  describe('5. Reserved .openob Metadata Namespace Isolation', () => {
    it('blocks plugin access to .openob and its case variants across read, create, update, delete, list', async () => {
      const { host } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'attacker.openob',
        name: 'Namespace Attacker',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [
          'vault.read',
          'vault.write',
          'vault.delete',
          'search.query',
          'workspace.modify',
        ],
      };

      let api: PluginAPI | null = null;
      class AttackerPlugin implements Plugin {
        onload(apiHandle: PluginAPI) {
          api = apiHandle;
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new AttackerPlugin());
      await host.enablePlugin(manifest.id);
      expect(api).not.toBeNull();

      const reservedPaths = [
        '.openob/config.json',
        '.OPENOB/views/saved.json',
        '.OpenOb/secrets.json',
        '.oPeNoB/metadata.json',
      ];

      for (const p of reservedPaths) {
        // Read
        await expect(api!.vault.read(p as VaultPath)).rejects.toThrow();

        // Create
        await expect(api!.vault.create(p as VaultPath, '{}')).rejects.toThrow();

        // Update
        await expect(api!.vault.update(p as VaultPath, '{}', { token: 'v1' })).rejects.toThrow();

        // Delete
        await expect(api!.vault.delete(p as VaultPath, { token: 'v1' })).rejects.toThrow();

        // Open
        await expect(api!.workspace.openNote(p as VaultPath)).rejects.toThrow();
      }

      // List under reserved prefix returns empty array
      const listRes = await api!.vault.list('.openob');
      expect(listRes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Read-Only Gateway Operational Parity
  // ---------------------------------------------------------------------------
  describe('6. Read-Only Workspace Parity', () => {
    it('rejects mutations with ForbiddenError (403) when workspace is read-only', async () => {
      const { host } = await setupWorkspace({
        readOnly: true,
        initialNotes: { 'Doc.md': 'Read only doc' },
      });

      const manifest: PluginManifest = {
        id: 'readonly.tester',
        name: 'ReadOnly Tester',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: ['vault.read', 'vault.write', 'vault.delete'],
      };

      let api: PluginAPI | null = null;
      class ROTestPlugin implements Plugin {
        onload(apiHandle: PluginAPI) {
          api = apiHandle;
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new ROTestPlugin());
      await host.enablePlugin(manifest.id);

      // Read succeeds
      const snap = await api!.vault.read('Doc.md');
      expect(snap.content).toBe('Read only doc');

      // Create fails with 403 Forbidden
      await expect(api!.vault.create('New.md', 'Data')).rejects.toThrow(ForbiddenError);

      // Update fails with 403 Forbidden
      await expect(api!.vault.update('Doc.md', 'Changed', snap.version)).rejects.toThrow(
        ForbiddenError
      );

      // Delete fails with 403 Forbidden
      await expect(api!.vault.delete('Doc.md', snap.version)).rejects.toThrow(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Search Freshness
  // ---------------------------------------------------------------------------
  describe('7. Search Freshness through Host Services', () => {
    it('immediately reflects external workspace creations in search results without rebuild', async () => {
      const { host, workspace } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'search.tester',
        name: 'Search Tester',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: ['search.query'],
      };

      let api: PluginAPI | null = null;
      class SearchPlugin implements Plugin {
        onload(apiHandle: PluginAPI) {
          api = apiHandle;
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new SearchPlugin());
      await host.enablePlugin(manifest.id);

      // Initially search finds nothing
      expect(await api!.search.query('Quantum')).toHaveLength(0);

      // Create note in workspace
      await workspace.createNote({
        path: 'Physics/Quantum.md',
        content: '# Quantum Entanglement\n\nDiscussion on non-local phenomena.',
      });

      // Search immediately finds it
      const res = await api!.search.query('Quantum');
      expect(res.length).toBeGreaterThanOrEqual(1);
      expect(res[0].path).toBe('Physics/Quantum.md');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. AI Capability & Zero-Secret-Leak
  // ---------------------------------------------------------------------------
  describe('8. AI Capability & Zero-Secret-Leak', () => {
    it('routes ai.chat through host services without exposing secret stores or provider configuration', async () => {
      const mockAIBackend: AIBackend = {
        isGatewayMode: false,
        async listProviders(): Promise<AIProviderInfo[]> {
          return [
            {
              id: 'mock-provider' as AIProviderId,
              name: 'Mock Provider',
              type: 'local',
              configured: true,
            },
          ];
        },
        async listModels(): Promise<AIModel[]> {
          return [{ id: 'mock-model', name: 'Mock Model', isDefault: true }];
        },
        async getSecretStatus() {
          return { configured: true };
        },
        async setSecret() {},
        async clearSecret() {},
        async *chat() {
          yield {
            chunk: { content: 'AI Response: Hello from secured AI provider!', isDone: true },
          };
        },
      };

      const { host } = await setupWorkspace({ aiBackend: mockAIBackend });

      const manifest: PluginManifest = {
        id: 'ai.tester',
        name: 'AI Tester',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: ['ai.use'],
      };

      let api: PluginAPI | null = null;
      class AIPlugin implements Plugin {
        onload(apiHandle: PluginAPI) {
          api = apiHandle;
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new AIPlugin());
      await host.enablePlugin(manifest.id);

      const response = await api!.ai.chat('Say hello');
      expect(response).toBe('AI Response: Hello from secured AI provider!');

      // Verify plugin has ZERO access to secretStore, provider keys, or config
      expect((api as any).secrets).toBeUndefined();
      expect((api as any).setSecret).toBeUndefined();
      expect((api as any).getSecretStatus).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Crash Containment Across All Execution Boundaries
  // ---------------------------------------------------------------------------
  describe('9. Complete Error Containment Across Lifecycle & Views', () => {
    it('contains view render crashes without crashing host or container', async () => {
      const { host } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'crashing.view',
        name: 'Crashing View Plugin',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
        contributes: {
          views: [{ id: 'exploding.view', name: 'Exploding View' }],
        },
      };

      class ExplodingViewPlugin implements Plugin {
        onload(api: PluginAPI) {
          api.ui.registerView({
            id: 'exploding.view',
            name: 'Exploding View',
            render: () => {
              throw new Error('Explosive DOM render failure!');
            },
          });
        }
        onunload() {}
      }

      host.registerPlugin(manifest, () => new ExplodingViewPlugin());
      await host.enablePlugin(manifest.id);

      const container = {
        textContent: '',
        replaceChildren: vi.fn(),
        appendChild: vi.fn(),
      } as any;
      const res = host.renderView('exploding.view', container);

      expect(res.success).toBe(false);
      expect(res.error).toContain('Explosive DOM render failure');
      expect(container.textContent).toContain('Plugin View Error: Explosive DOM render failure');
    });

    it('contains onunload exceptions without preventing plugin disablement', async () => {
      const { host } = await setupWorkspace();

      const manifest: PluginManifest = {
        id: 'bad.unload',
        name: 'Bad Unload Plugin',
        version: '1.0.0',
        apiVersion: '2.x',
        permissions: [],
      };

      class BadUnloadPlugin implements Plugin {
        onload() {}
        onunload() {
          throw new Error('Fatal error during onunload cleanup!');
        }
      }

      host.registerPlugin(manifest, () => new BadUnloadPlugin());
      await host.enablePlugin(manifest.id);

      const disabled = await host.disablePlugin(manifest.id);
      expect(disabled).toBe(true);
      expect(host.getPlugin(manifest.id)?.status).toBe('disabled');
    });
  });
});
