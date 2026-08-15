import * as path from 'path';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { SqliteDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { NativeVaultWatcher } from './fs-watcher.js';
import { DesktopSecretStore } from './secure-storage.js';
import { WatcherEvent } from './types.js';

export interface DesktopVaultRuntimeOptions {
  readonly vaultPath: string;
  readonly databasePath?: string;
  readonly secretsPath?: string;
  readonly masterSecret?: string;
  readonly debounceMs?: number;
}

export class DesktopVaultRuntime {
  readonly vaultPath: string;
  readonly storage: NodeFsVaultStorage;
  readonly safeWriter: SafeWriter;
  readonly parser: DefaultDocumentParser;
  readonly index: SqliteDocumentIndex;
  readonly watcher: NativeVaultWatcher;
  readonly secretStore: DesktopSecretStore | null;
  private unsubscribeWatcher: (() => void) | null = null;

  private constructor(
    vaultPath: string,
    storage: NodeFsVaultStorage,
    index: SqliteDocumentIndex,
    secretStore: DesktopSecretStore | null,
    options: DesktopVaultRuntimeOptions
  ) {
    this.vaultPath = vaultPath;
    this.storage = storage;
    this.safeWriter = new SafeWriter(storage);
    this.parser = new DefaultDocumentParser();
    this.index = index;
    this.secretStore = secretStore;
    this.watcher = new NativeVaultWatcher(vaultPath, {
      debounceMs: options.debounceMs ?? 50,
    });
  }

  static async create(options: DesktopVaultRuntimeOptions): Promise<DesktopVaultRuntime> {
    const vaultPath = path.resolve(options.vaultPath);
    const storage = new NodeFsVaultStorage(vaultPath, path.basename(vaultPath));
    const index = await SqliteDocumentIndex.create();
    
    let secretStore: DesktopSecretStore | null = null;
    if (options.masterSecret) {
      secretStore = new DesktopSecretStore({
        storagePath: options.secretsPath,
        masterSecret: options.masterSecret,
      });
    }

    const runtime = new DesktopVaultRuntime(vaultPath, storage, index, secretStore, options);
    await runtime.initialize();
    return runtime;
  }

  private async initialize(): Promise<void> {
    // 1. Initial full index build from disk
    await rebuildVaultIndex(this.storage, this.index, this.parser);

    // 2. Attach filesystem watcher to sync external disk changes to SQLite index
    this.unsubscribeWatcher = this.watcher.addListener(async (event: WatcherEvent) => {
      await this.handleWatcherEvent(event);
    });

    await this.watcher.start();
  }

  private async handleWatcherEvent(event: WatcherEvent): Promise<void> {
    if (!event.path.endsWith('.md') && !event.path.endsWith('.markdown')) {
      return;
    }

    try {
      if (event.type === 'deleted') {
        await this.index.remove(event.path);
      } else {
        const snapshot = await this.storage.read(event.path);
        const parsed = await this.parser.parse(
          event.path,
          snapshot.content,
          snapshot.version.hash
        );
        await this.index.upsert(parsed);
      }
    } catch {
      // File may have been locked or deleted mid-operation
    }
  }

  async close(): Promise<void> {
    if (this.unsubscribeWatcher) {
      this.unsubscribeWatcher();
      this.unsubscribeWatcher = null;
    }
    await this.watcher.stop();
    this.index.close();
  }
}
