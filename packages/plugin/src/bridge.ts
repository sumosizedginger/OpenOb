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

/**
 * Creates a sandboxed, permission-gated public API bridge for a specific plugin (Constitution Law 20, F-006).
 */
export function createPluginAPI(
  manifest: PluginManifest,
  context: PluginHostContext,
  registeredCommands: PluginCommand[],
  registeredViews: PluginView[]
): PluginAPI {
  const checkPermission = (perm: PluginPermission) => {
    if (!manifest.permissions.includes(perm)) {
      throw new PermissionDeniedError(manifest.id, perm);
    }
  };

  return {
    manifest,

    vault: {
      read: async (path: VaultPath): Promise<string> => {
        checkPermission('vault.read');
        const snap = await context.storage.read(path);
        return typeof snap.content === 'string'
          ? snap.content
          : new TextDecoder().decode(snap.content);
      },

      write: async (path: VaultPath, content: string): Promise<void> => {
        checkPermission('vault.write');
        try {
          const snap = await context.storage.read(path);
          await context.storage.write(path, snap.version, content);
        } catch {
          await context.storage.write(path, null, content);
        }
      },

      list: async (folderPrefix?: string): Promise<VaultPath[]> => {
        checkPermission('vault.read');
        const entries = await context.storage.list(folderPrefix);
        return entries.map((e) => e.path);
      },
    },

    search: {
      query: async (text: string): Promise<any[]> => {
        checkPermission('search.query');
        return await context.index.query({ query: text });
      },
    },

    workspace: {
      getActiveNotePath: (): VaultPath | null => {
        return context.activeNotePath;
      },

      openNote: async (path: VaultPath): Promise<void> => {
        checkPermission('workspace.modify');
        await context.openNote(path);
      },
    },

    commands: {
      registerCommand: (command: PluginCommand): void => {
        registeredCommands.push(command);
      },
    },

    ui: {
      showNotice: (message: string): void => {
        context.showNotice(message);
      },

      registerView: (view: PluginView): void => {
        registeredViews.push(view);
      },
    },

    ai: {
      chat: async (prompt: string): Promise<string> => {
        checkPermission('ai.use');
        if (!context.aiManager) {
          throw new Error('AI capabilities are not available in this workspace context.');
        }

        const stream = context.aiManager.chat({
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
