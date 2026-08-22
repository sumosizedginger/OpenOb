import { VaultPath } from '@okw/core';

export type WatcherEventType = 'created' | 'modified' | 'deleted' | 'renamed';

export interface WatcherEvent {
  readonly type: WatcherEventType;
  readonly path: VaultPath;
  readonly oldPath?: VaultPath;
  readonly timestamp: number;
}

export type WatcherEventListener = (event: WatcherEvent) => void;

export interface VaultWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(listener: WatcherEventListener): () => void;
  isWatching(): boolean;
}

export interface DesktopBootstrapConfig {
  readonly gatewayUrl: string;
  readonly token: string;
  readonly vaultName: string;
  readonly vaultPath?: string;
  readonly storageStatus?: 'ready' | 'unavailable' | 'corrupted';
}

export interface DesktopAppInfo {
  readonly name: string;
  readonly version: string;
  readonly buildSha?: string;
  readonly sourceClean?: boolean;
  readonly platform: string;
  readonly storageStatus?: 'ready' | 'unavailable' | 'corrupted';
}

export interface OnboardingState {
  readonly version: number;
  readonly dismissedFirstRun: boolean;
  readonly quickTourCompleted: boolean;
  readonly completedChapters: readonly string[];
}

export interface DesktopWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized?: boolean;
}

export interface DesktopConfig {
  readonly lastVaultPath?: string;
  readonly windowBounds?: DesktopWindowBounds;
  readonly onboardingState?: OnboardingState;
  readonly pluginStates?: Record<string, boolean>;
}

export interface DesktopFlushRequest {
  readonly requestId: string;
  readonly reason: 'close' | 'quit' | 'vault-switch';
}

export interface DesktopFlushResult {
  readonly requestId: string;
  readonly success: boolean;
  readonly conflicts: string[];
  readonly failures: string[];
}

export type DesktopMenuAction = 'learn' | 'quick-tour' | 'shortcuts' | 'about';

export type DesktopLifecycleEventType =
  'before-vault-switch' | 'vault-switched' | 'quitting' | 'flush-request' | 'menu-action';

export interface DesktopLifecycleEvent {
  readonly type: DesktopLifecycleEventType;
  readonly payload?: any;
}

/**
 * @deprecated Legacy in-process IPC channel definitions (P3-4).
 * Electron desktop shell uses loopback HTTP gateway for data mutations and hardened preload bridge for lifecycle.
 */
export type NativeIpcChannel =
  | 'desktop:get-bootstrap'
  | 'desktop:choose-vault'
  | 'desktop:get-info'
  | 'vault:open-dialog'
  | 'vault:reveal'
  | 'watcher:event'
  | 'secret:get'
  | 'secret:set'
  | 'secret:delete';

export interface IpcRequest<T = any> {
  readonly id: string;
  readonly channel: NativeIpcChannel;
  readonly payload?: T;
}

export interface IpcResponse<T = any> {
  readonly id: string;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}
