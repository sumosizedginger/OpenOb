import {
  PluginAPI,
  PluginCommand,
  PluginHostContext,
  PluginManifest,
  PluginPermission,
  PluginView,
} from './types.js';
import { PermissionDeniedError } from './errors.js';
import { VaultPath } from '@okw/core';

export type PluginContextAccessor = PluginHostContext | (() => PluginHostContext);

/**
 * Creates a permission-gated public API bridge for a specific plugin (Constitution Law 20, F-006).
 */
export function createPluginAPI(
  manifest: PluginManifest,
  contextAccessor: PluginContextAccessor,
  registeredCommands: PluginCommand[],
  registeredViews: PluginView[]
): PluginAPI {
  const getContext = typeof contextAccessor === 'function' ? contextAccessor : () => contextAccessor;

  // P9-2 (F-030): Snapshot granted permissions immutably at bridge creation time.
  // The gatekeeper evaluates this immutable Set, never relying on a mutable object property.
  const grantedPermissions = new Set<PluginPermission>(manifest.permissions);

  const checkPermission = (perm: PluginPermission) => {
    if (!grantedPermissions.has(perm)) {
      throw new PermissionDeniedError(manifest.id, perm);
    }
  };

  // Deep-freeze the manifest projection returned to the plugin
  const frozenManifest: PluginManifest = Object.freeze({
    ...manifest,
    permissions: Object.freeze([...manifest.permissions]) as any,
    contributes: manifest.contributes
      ? Object.freeze({
          commands: manifest.contributes.commands
            ? Object.freeze([...manifest.contributes.commands])
            : undefined,
          views: manifest.contributes.views
            ? Object.freeze([...manifest.contributes.views])
            : undefined,
        })
      : undefined,
  });

  return {
    manifest: frozenManifest,

    vault: {
      read: async (path: VaultPath): Promise<string> => {
        checkPermission('vault.read');
        const snap = await getContext().storage.read(path);
        return typeof snap.content === 'string'
          ? snap.content
          : new TextDecoder().decode(snap.content);
      },

      write: async (path: VaultPath, content: string): Promise<void> => {
        checkPermission('vault.write');
        // P9-1 (F-031): Distinguish note creation from versioned update without swallowing ConflictError.
        const storage = getContext().storage;
        const exists = await storage.exists(path);
        if (!exists) {
          await storage.write(path, null, content);
        } else {
          const snap = await storage.read(path);
          await storage.write(path, snap.version, content);
        }
      },

      list: async (folderPrefix?: string): Promise<VaultPath[]> => {
        checkPermission('vault.read');
        const entries = await getContext().storage.list(folderPrefix);
        return entries.map((e) => e.path);
      },
    },

    search: {
      query: async (text: string): Promise<any[]> => {
        checkPermission('search.query');
        return await getContext().index.query({ query: text });
      },
    },

    workspace: {
      getActiveNotePath: (): VaultPath | null => {
        return getContext().activeNotePath;
      },

      openNote: async (path: VaultPath): Promise<void> => {
        checkPermission('workspace.modify');
        await getContext().openNote(path);
      },
    },

    commands: {
      registerCommand: (command: PluginCommand): void => {
        registeredCommands.push(command);
      },
    },

    ui: {
      showNotice: (message: string): void => {
        getContext().showNotice(message);
      },

      registerView: (view: PluginView): void => {
        registeredViews.push(view);
      },
    },

    ai: {
      chat: async (prompt: string): Promise<string> => {
        checkPermission('ai.use');
        const aiManager = getContext().aiManager;
        if (!aiManager) {
          throw new Error('AI capabilities are not available in this workspace context.');
        }

        const stream = aiManager.chat({
          model: 'default',
          messages: [{ role: 'user', content: prompt }],
        });

        let output = '';
        for await (const chunk of stream) {
          output += chunk.content;
          if (chunk.isDone) break;
        }
        return output;
      },
    },
  };
}
