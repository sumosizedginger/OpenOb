import * as fs from 'fs';
import * as path from 'path';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { SqliteDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { FileSnapshot } from '@okw/core';
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
  readonly databasePath: string | null;
  readonly storage: NodeFsVaultStorage;
  readonly safeWriter: SafeWriter;
  readonly parser: DefaultDocumentParser;
  readonly index: SqliteDocumentIndex;
  readonly watcher: NativeVaultWatcher;
  readonly secretStore: DesktopSecretStore | null;
  private unsubscribeWatcher: (() => void) | null = null;
  private checkpointTimer: NodeJS.Timeout | null = null;

  private constructor(
    vaultPath: string,
    databasePath: string | null,
    storage: NodeFsVaultStorage,
    index: SqliteDocumentIndex,
    secretStore: DesktopSecretStore | null,
    options: DesktopVaultRuntimeOptions
  ) {
    this.vaultPath = vaultPath;
    this.databasePath = databasePath;
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
    const databasePath = options.databasePath ? path.resolve(options.databasePath) : null;
    const storage = new NodeFsVaultStorage(vaultPath, path.basename(vaultPath));

    let index: SqliteDocumentIndex | null = null;
    let loadedFromDb = false;

    if (databasePath && fs.existsSync(databasePath)) {
      try {
        const existingBytes = fs.readFileSync(databasePath);
        index = await SqliteDocumentIndex.create(existingBytes);
        const docs = await index.getAll();
        if (docs.length > 0) {
          loadedFromDb = true;
        }
      } catch (err) {
        console.warn(
          '[DesktopVaultRuntime] Corrupted or invalid SQLite database file; reconstructing index from Markdown files.',
          err
        );
      }
    }

    if (!index) {
      index = await SqliteDocumentIndex.create();
    }

    let secretStore: DesktopSecretStore | null = null;
    if (options.masterSecret) {
      secretStore = new DesktopSecretStore({
        storagePath: options.secretsPath,
        masterSecret: options.masterSecret,
      });
    }

    const runtime = new DesktopVaultRuntime(
      vaultPath,
      databasePath,
      storage,
      index,
      secretStore,
      options
    );
    await runtime.initialize(loadedFromDb);
    return runtime;
  }

  private async initialize(loadedFromDb: boolean): Promise<void> {
    if (!loadedFromDb) {
      // 1. Initial full index build from disk
      await rebuildVaultIndex(this.storage, this.index, this.parser);
      if (this.databasePath) {
        await this.checkpoint();
      }
    }

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
        this.scheduleCheckpoint();
      } else {
        let snapshot: FileSnapshot | null = null;
        try {
          snapshot = await this.storage.read(event.path);
        } catch {
          // Retry once after 100ms for transient file locks (P2-WATCHER-001)
          await new Promise((resolve) => setTimeout(resolve, 100));
          try {
            snapshot = await this.storage.read(event.path);
          } catch {
            console.warn(
              `[DesktopVaultRuntime] Transient read failure on "${event.path}"; marked dirty for future sync.`
            );
            return;
          }
        }

        if (snapshot) {
          const parsed = await this.parser.parse(
            event.path,
            snapshot.content,
            snapshot.version.hash
          );
          await this.index.upsert(parsed);
          this.scheduleCheckpoint();
        }
      }
    } catch (err) {
      console.error(`[DesktopVaultRuntime] Error handling watcher event for "${event.path}":`, err);
    }
  }

  private scheduleCheckpoint(): void {
    if (!this.databasePath) return;
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
    }
    this.checkpointTimer = setTimeout(async () => {
      await this.checkpoint();
    }, 100);
  }

  /**
   * Checkpoints SQLite in-memory database to persistent disk file using atomic swap (P1-SQLITE-001).
   */
  async checkpoint(): Promise<void> {
    if (!this.databasePath) return;
    try {
      const parentDir = path.dirname(this.databasePath);
      fs.mkdirSync(parentDir, { recursive: true });
      const bytes = this.index.export();
      const tmpPath = `${this.databasePath}.okw.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tmpPath, bytes);
      fs.renameSync(tmpPath, this.databasePath);
    } catch (err) {
      // Checkpoint failures must never crash or block canonical file operations
      console.error('[DesktopVaultRuntime] Checkpoint failure:', err);
    }
  }

  async close(): Promise<void> {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    await this.checkpoint();

    if (this.unsubscribeWatcher) {
      this.unsubscribeWatcher();
      this.unsubscribeWatcher = null;
    }
    await this.watcher.stop();
    this.index.close();
  }
}
