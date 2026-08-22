import {
  DocumentVersionToken,
  PluginAIAPI,
  PluginAPI,
  PluginCommand,
  PluginCommandsAPI,
  PluginHostContext,
  PluginManifest,
  PluginNoteMutationResult,
  PluginNoteSnapshot,
  PluginPermission,
  PluginSearchAPI,
  PluginSearchResult,
  PluginUIAPI,
  PluginVaultAPI,
  PluginView,
  PluginWorkspaceAPI,
} from './types.js';
import {
  DuplicateContributionError,
  PermissionDeniedError,
  UndeclaredContributionError,
} from './errors.js';
import { isReservedWorkspacePath, VaultPath } from '@okw/core';

export type PluginContextAccessor = PluginHostContext | (() => PluginHostContext);

/**
 * Creates a permission-gated public API bridge for a specific plugin (Constitution Law 20, F-006).
 * Strictly enforces:
 * - Immutable permission snapshots (F-030).
 * - Versioned OCC note snapshots and updates.
 * - Reserved .openob metadata boundary isolation.
 * - Declared contributions validation.
 * - Host service authority routing (zero direct storage/index/AI access).
 */
export function createPluginAPI(
  manifest: PluginManifest,
  contextAccessor: PluginContextAccessor,
  registeredCommands: PluginCommand[],
  registeredViews: PluginView[],
  onRegisterCommand?: (cmd: PluginCommand) => void,
  onRegisterView?: (view: PluginView) => void
): PluginAPI {
  const getContext =
    typeof contextAccessor === 'function' ? contextAccessor : () => contextAccessor;

  // P9-2 (F-030): Snapshot granted permissions immutably at bridge creation time.
  const grantedPermissions = new Set<PluginPermission>(manifest.permissions);

  const checkPermission = (perm: PluginPermission) => {
    if (!grantedPermissions.has(perm)) {
      throw new PermissionDeniedError(manifest.id, perm);
    }
  };

  const checkNotReserved = (path: string, perm: PluginPermission) => {
    if (isReservedWorkspacePath(path)) {
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

  const vaultAPI: PluginVaultAPI = {
    read: async (path: VaultPath): Promise<PluginNoteSnapshot> => {
      checkPermission('vault.read');
      checkNotReserved(path, 'vault.read');
      return await getContext().services.notes.read(path);
    },

    create: async (path: VaultPath, content: string): Promise<PluginNoteMutationResult> => {
      checkPermission('vault.write');
      checkNotReserved(path, 'vault.write');
      return await getContext().services.notes.create(path, content);
    },

    update: async (
      path: VaultPath,
      content: string,
      expectedVersion: DocumentVersionToken
    ): Promise<PluginNoteMutationResult> => {
      checkPermission('vault.write');
      checkNotReserved(path, 'vault.write');
      if (!expectedVersion || typeof expectedVersion.token !== 'string') {
        throw new Error(`Plugin "${manifest.id}": vault.update requires a valid expectedVersion.`);
      }
      return await getContext().services.notes.update(path, content, expectedVersion);
    },

    delete: async (path: VaultPath, expectedVersion: DocumentVersionToken): Promise<void> => {
      checkPermission('vault.delete');
      checkNotReserved(path, 'vault.delete');
      if (!expectedVersion || typeof expectedVersion.token !== 'string') {
        throw new Error(`Plugin "${manifest.id}": vault.delete requires a valid expectedVersion.`);
      }
      await getContext().services.notes.delete(path, expectedVersion);
    },

    list: async (folderPrefix?: string): Promise<VaultPath[]> => {
      checkPermission('vault.read');
      if (folderPrefix && isReservedWorkspacePath(folderPrefix)) {
        return [];
      }
      const results = await getContext().services.notes.list(folderPrefix);
      return results.filter((p) => !isReservedWorkspacePath(p));
    },
  };

  const searchAPI: PluginSearchAPI = {
    query: async (text: string, options?: { limit?: number }): Promise<PluginSearchResult[]> => {
      checkPermission('search.query');
      const results = await getContext().services.search.query(text, options);
      return results.filter((r) => !isReservedWorkspacePath(r.path));
    },
  };

  const workspaceAPI: PluginWorkspaceAPI = {
    getActiveNotePath: (): VaultPath | null => {
      return getContext().services.workspace.getActiveNotePath();
    },

    openNote: async (path: VaultPath): Promise<void> => {
      checkPermission('workspace.modify');
      checkNotReserved(path, 'workspace.modify');
      await getContext().services.workspace.openNote(path);
    },
  };

  const commandsAPI: PluginCommandsAPI = {
    registerCommand: (command: PluginCommand): void => {
      if (!command || !command.id || typeof command.id !== 'string') {
        throw new Error(`Plugin "${manifest.id}" attempted to register invalid command.`);
      }

      // Check contribution declaration in manifest
      if (manifest.contributes?.commands) {
        const declared = manifest.contributes.commands.some((c) => c.id === command.id);
        if (!declared) {
          throw new UndeclaredContributionError(manifest.id, 'command', command.id);
        }
      }

      if (registeredCommands.some((c) => c.id === command.id)) {
        throw new DuplicateContributionError(manifest.id, 'command', command.id);
      }

      registeredCommands.push(command);
      if (onRegisterCommand) {
        onRegisterCommand(command);
      }
    },
  };

  const uiAPI: PluginUIAPI = {
    showNotice: (message: string): void => {
      getContext().services.workspace.showNotice(message);
    },

    registerView: (view: PluginView): void => {
      if (!view || !view.id || typeof view.id !== 'string') {
        throw new Error(`Plugin "${manifest.id}" attempted to register invalid view.`);
      }

      // Check contribution declaration in manifest
      if (manifest.contributes?.views) {
        const declared = manifest.contributes.views.some((v) => v.id === view.id);
        if (!declared) {
          throw new UndeclaredContributionError(manifest.id, 'view', view.id);
        }
      }

      if (registeredViews.some((v) => v.id === view.id)) {
        throw new DuplicateContributionError(manifest.id, 'view', view.id);
      }

      registeredViews.push(view);
      if (onRegisterView) {
        onRegisterView(view);
      }
    },
  };

  const aiAPI: PluginAIAPI = {
    chat: async (prompt: string): Promise<string> => {
      checkPermission('ai.use');
      const aiService = getContext().services.ai;
      if (!aiService) {
        throw new Error('AI capabilities are not available in this workspace context.');
      }
      return await aiService.chat(prompt);
    },
  };

  return {
    manifest: frozenManifest,
    vault: vaultAPI,
    search: searchAPI,
    workspace: workspaceAPI,
    commands: commandsAPI,
    ui: uiAPI,
    ai: aiAPI,
  };
}
