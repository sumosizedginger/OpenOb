import { DocumentIndex, VaultPath, VaultStorage } from '@okw/core';
import { AIManager } from '@okw/ai';

export type PluginPermission =
  | 'vault.read'
  | 'vault.write'
  | 'vault.delete'
  | 'workspace.modify'
  | 'editor.extend'
  | 'search.query'
  | 'graph.read'
  | 'ai.use';

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
  readonly permissions: PluginPermission[];
  readonly contributes?: {
    readonly commands?: readonly { id: string; name: string }[];
    readonly views?: readonly { id: string; name: string }[];
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

export interface PluginHostContext {
  storage: VaultStorage;
  index: DocumentIndex;
  activeNotePath: VaultPath | null;
  openNote: (path: VaultPath) => Promise<void>;
  showNotice: (message: string) => void;
  aiManager?: AIManager;
}

export interface PluginVaultAPI {
  read(path: VaultPath): Promise<string>;
  write(path: VaultPath, content: string): Promise<void>;
  list(folderPrefix?: string): Promise<VaultPath[]>;
}

export interface PluginSearchAPI {
  query(text: string): Promise<any[]>;
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
