import { FileVersion, VaultPath } from '@okw/core';

export type DocumentVersionToken =
  | FileVersion
  | {
      readonly token: string;
      readonly hash?: string;
      readonly modifiedAt?: number;
      readonly size?: number;
    };

export const VALID_PLUGIN_PERMISSIONS = [
  'vault.read',
  'vault.write',
  'vault.delete',
  'workspace.modify',
  'editor.extend',
  'search.query',
  'graph.read',
  'ai.use',
] as const;

export type PluginPermission = (typeof VALID_PLUGIN_PERMISSIONS)[number];

export interface PluginCommand {
  readonly id: string;
  readonly name: string;
  readonly callback: () => void | Promise<void>;
}

export interface PluginView {
  readonly id: string;
  readonly name: string;
  readonly render: (container: HTMLElement) => void;
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly description?: string;
  readonly author?: string;
  readonly permissions: readonly PluginPermission[];
  readonly contributes?: {
    readonly commands?: readonly { readonly id: string; readonly name: string }[];
    readonly views?: readonly { readonly id: string; readonly name: string }[];
  };
}

export type PluginStatus = 'loaded' | 'enabled' | 'disabled' | 'error';

export interface PluginInstance {
  readonly manifest: PluginManifest;
  plugin: Plugin | null;
  status: PluginStatus;
  error?: string;
  registeredCommands: PluginCommand[];
  registeredViews: PluginView[];
}

export interface PluginNoteSnapshot {
  readonly path: VaultPath;
  readonly content: string;
  readonly version: DocumentVersionToken;
}

export interface PluginNoteMutationResult {
  readonly path: VaultPath;
  readonly version: DocumentVersionToken;
}

export interface PluginSearchResult {
  readonly path: VaultPath;
  readonly title: string;
  readonly score: number;
  readonly matchSnippet?: string;
}

export interface PluginHostServices {
  readonly notes: {
    read(path: VaultPath): Promise<PluginNoteSnapshot>;
    create(path: VaultPath, content: string): Promise<PluginNoteMutationResult>;
    update(
      path: VaultPath,
      content: string,
      expectedVersion: DocumentVersionToken
    ): Promise<PluginNoteMutationResult>;
    delete(path: VaultPath, expectedVersion: DocumentVersionToken): Promise<void>;
    list(folderPrefix?: string): Promise<VaultPath[]>;
  };
  readonly search: {
    query(text: string, options?: { limit?: number }): Promise<PluginSearchResult[]>;
  };
  readonly ai?: {
    chat(prompt: string): Promise<string>;
  };
  readonly workspace: {
    getActiveNotePath(): VaultPath | null;
    openNote(path: VaultPath): Promise<void>;
    showNotice(message: string): void;
  };
}

export interface PluginHostContext {
  services: PluginHostServices;
}

export interface PluginVaultAPI {
  read(path: VaultPath): Promise<PluginNoteSnapshot>;
  create(path: VaultPath, content: string): Promise<PluginNoteMutationResult>;
  update(
    path: VaultPath,
    content: string,
    expectedVersion: DocumentVersionToken
  ): Promise<PluginNoteMutationResult>;
  delete(path: VaultPath, expectedVersion: DocumentVersionToken): Promise<void>;
  list(folderPrefix?: string): Promise<VaultPath[]>;
}

export interface PluginSearchAPI {
  query(text: string, options?: { limit?: number }): Promise<PluginSearchResult[]>;
}

export interface PluginWorkspaceAPI {
  getActiveNotePath(): VaultPath | null;
  openNote(path: VaultPath): Promise<void>;
}

export interface PluginCommandsAPI {
  registerCommand(command: PluginCommand): void;
}

export interface PluginUIAPI {
  showNotice(message: string): void;
  registerView(view: PluginView): void;
}

export interface PluginAIAPI {
  chat(prompt: string): Promise<string>;
}

export interface PluginAPI {
  readonly manifest: Readonly<PluginManifest>;
  readonly vault: PluginVaultAPI;
  readonly search: PluginSearchAPI;
  readonly workspace: PluginWorkspaceAPI;
  readonly commands: PluginCommandsAPI;
  readonly ui: PluginUIAPI;
  readonly ai: PluginAIAPI;
}

export interface Plugin {
  onload(api: PluginAPI): Promise<void> | void;
  onunload(): Promise<void> | void;
}
