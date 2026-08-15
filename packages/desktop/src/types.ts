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

export type NativeIpcChannel =
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
