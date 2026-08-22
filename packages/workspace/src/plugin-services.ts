import { isReservedWorkspacePath, VaultPath } from '@okw/core';
import {
  DocumentVersionToken,
  PluginHostServices,
  PluginNoteMutationResult,
  PluginNoteSnapshot,
  PluginSearchResult,
} from '@okw/plugin';
import { AIProviderId } from '@okw/ai';
import { WorkspaceBackend } from './backend.js';
import { AIBackend } from './ai-backend.js';
import { InvalidPathError } from './errors.js';

export interface PluginServicesUICallbacks {
  getActiveNotePath?: () => VaultPath | null;
  openNote?: (path: VaultPath) => Promise<void>;
  showNotice?: (message: string) => void;
}

/**
 * Creates a hardened PluginHostServices implementation backed by an authoritative WorkspaceBackend
 * and AIBackend (Constitution Law 20 / Phase 3H).
 *
 * Enforces:
 * 1. Strict workspace backend authority (no raw filesystem/storage access).
 * 2. Immutable OCC versioning across note snapshot reads, creations, updates, and deletes.
 * 3. Strict case-insensitive reserved .openob metadata boundary rejection.
 * 4. Transparent Gateway / Standalone operational parity.
 */
export function createWorkspacePluginHostServices(
  backend: WorkspaceBackend,
  aiBackend?: AIBackend,
  ui?: PluginServicesUICallbacks
): PluginHostServices {
  const checkNotReserved = (path: string) => {
    if (isReservedWorkspacePath(path)) {
      throw new InvalidPathError(
        path,
        `Path "${path}" is inside the reserved OpenOb metadata namespace`
      );
    }
  };

  return {
    notes: {
      read: async (path: VaultPath): Promise<PluginNoteSnapshot> => {
        checkNotReserved(path);
        const res = await backend.readNote(path);
        return {
          path: res.path as VaultPath,
          content: res.textContent,
          version: res.version,
        };
      },

      create: async (path: VaultPath, content: string): Promise<PluginNoteMutationResult> => {
        checkNotReserved(path);
        const res = await backend.createNote({ path, content });
        return {
          path: res.path as VaultPath,
          version: res.currentVersion,
        };
      },

      update: async (
        path: VaultPath,
        content: string,
        expectedVersion: DocumentVersionToken
      ): Promise<PluginNoteMutationResult> => {
        checkNotReserved(path);
        const res = await backend.updateNote({
          path,
          content,
          expectedVersion,
        });
        return {
          path: res.path as VaultPath,
          version: res.currentVersion,
        };
      },

      delete: async (path: VaultPath, expectedVersion: DocumentVersionToken): Promise<void> => {
        checkNotReserved(path);
        await backend.deleteNote({ path, expectedVersion });
      },

      list: async (folderPrefix?: string): Promise<VaultPath[]> => {
        if (folderPrefix && isReservedWorkspacePath(folderPrefix)) {
          return [];
        }
        const entries = await backend.listEntries(folderPrefix);
        return entries
          .filter((e) => !e.isDirectory && !isReservedWorkspacePath(e.path))
          .map((e) => e.path as VaultPath);
      },
    },

    search: {
      query: async (text: string, options?: { limit?: number }): Promise<PluginSearchResult[]> => {
        const res = await backend.search({ query: text, limit: options?.limit ?? 20 });
        return res.matches
          .filter((m) => !isReservedWorkspacePath(m.path))
          .map((m) => ({
            path: m.path as VaultPath,
            title: m.title,
            score: m.score,
            matchSnippet: m.matchSnippet,
          }));
      },
    },

    ai: aiBackend
      ? {
          chat: async (prompt: string): Promise<string> => {
            const providers = await aiBackend.listProviders();
            const activeProvider = providers.find((p) => p.configured) || providers[0];
            if (!activeProvider) {
              throw new Error('AI capabilities are not configured or available in this workspace.');
            }

            const models = await aiBackend.listModels(activeProvider.id as AIProviderId);
            const defaultModel = models.find((m) => m.isDefault)?.id || models[0]?.id || 'default';

            const stream = aiBackend.chat({
              provider: activeProvider.id as AIProviderId,
              model: defaultModel,
              messages: [{ role: 'user', content: prompt }],
            });

            let fullText = '';
            for await (const chunkResp of stream) {
              fullText += chunkResp.chunk.content;
              if (chunkResp.chunk.isDone) break;
            }
            return fullText;
          },
        }
      : undefined,

    workspace: {
      getActiveNotePath: (): VaultPath | null => {
        return ui?.getActiveNotePath ? ui.getActiveNotePath() : null;
      },

      openNote: async (path: VaultPath): Promise<void> => {
        checkNotReserved(path);
        if (ui?.openNote) {
          await ui.openNote(path);
        }
      },

      showNotice: (message: string): void => {
        if (ui?.showNotice) {
          ui.showNotice(message);
        }
      },
    },
  };
}
