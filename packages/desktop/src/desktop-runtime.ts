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
        const manifest = await index.getSourceManifest();
        if (manifest.length > 0) {
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
    } else {
      // 2. Reconcile persistent SQLite against canonical Markdown files before starting watcher
      await this.reconcile();
    }

    // 3. Attach filesystem watcher to sync external disk changes to SQLite index
    this.unsubscribeWatcher = this.watcher.addListener(async (event: WatcherEvent) => {
      await this.handleWatcherEvent(event);
    });

    // 4. Start filesystem watcher only AFTER startup reconciliation completes
    await this.watcher.start();
  }

  /**
   * Reconciles SQLite derived index against canonical Markdown files on startup.
   * Canonical Markdown is authoritative; SQLite never overwrites Markdown.
   */
  async reconcile(): Promise<void> {
    const entries = await this.storage.list('', true);
    const diskFiles = entries.filter(
      (e) => !e.isDirectory && (e.path.endsWith('.md') || e.path.endsWith('.markdown'))
    );
    const diskMap = new Map(diskFiles.map((e) => [e.path, e]));

    const dbManifest = await this.index.getSourceManifest();
    const dbMap = new Map(dbManifest.map((m) => [m.path, m]));

    let changed = false;

    // 1. disk paths − DB paths => new files added offline: read, parse, index
    for (const [diskPath] of diskMap) {
      if (!dbMap.has(diskPath)) {
        try {
          const snapshot = await this.storage.read(diskPath);
          const parsed = await this.parser.parse(
            diskPath,
            snapshot.content,
            snapshot.version.hash
          );
          await this.index.upsert(parsed, {
            modifiedAt: snapshot.modifiedAt ?? snapshot.version.modifiedAt ?? 0,
            size: snapshot.size ?? snapshot.version.size ?? 0,
          });
          changed = true;
        } catch (err) {
          console.warn(`[DesktopVaultRuntime] Failed to index offline added file "${diskPath}":`, err);
        }
      }
    }

    // 2. DB paths − disk paths => files deleted offline: remove from index
    for (const [dbPath] of dbMap) {
      if (!diskMap.has(dbPath)) {
        try {
          await this.index.remove(dbPath);
          changed = true;
        } catch (err) {
          console.warn(`[DesktopVaultRuntime] Failed to remove offline deleted file "${dbPath}":`, err);
        }
      }
    }

    // 3. paths existing in both => compare persisted size/mtime
    for (const [pathKey, manifest] of dbMap) {
      const diskEntry = diskMap.get(pathKey);
      if (diskEntry) {
        const statChanged =
          diskEntry.size !== manifest.size || diskEntry.modifiedAt !== manifest.modifiedAt;
        if (statChanged) {
          try {
            const snapshot = await this.storage.read(pathKey);
            const mtime = snapshot.modifiedAt ?? snapshot.version.modifiedAt ?? 0;
            const sz = snapshot.size ?? snapshot.version.size ?? 0;
            if (snapshot.version.hash !== manifest.hash) {
              // Content changed: reparse and upsert
              const parsed = await this.parser.parse(
                pathKey,
                snapshot.content,
                snapshot.version.hash
              );
              await this.index.upsert(parsed, {
                modifiedAt: mtime,
                size: sz,
              });
              changed = true;
            } else {
              // Content hash unchanged: update stat metadata only
              await this.index.setSourceMetadata(pathKey, mtime, sz);
              changed = true;
            }
          } catch (err) {
            console.warn(`[DesktopVaultRuntime] Failed to reconcile modified file "${pathKey}":`, err);
          }
        }
      }
    }

    if (changed && this.databasePath) {
      await this.checkpoint();
    }
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
          await this.index.upsert(parsed, {
            modifiedAt: snapshot.modifiedAt ?? snapshot.version.modifiedAt ?? 0,
            size: snapshot.size ?? snapshot.version.size ?? 0,
          });
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
   * Checkpoints SQLite in-memory database to persistent disk file using asynchronous atomic swap (P1-SQLITE-001).
   */
  async checkpoint(): Promise<void> {
    if (!this.databasePath) return;
    const tmpPath = `${this.databasePath}.okw.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      const parentDir = path.dirname(this.databasePath);
      await fs.promises.mkdir(parentDir, { recursive: true });
      const bytes = this.index.export();
      await fs.promises.writeFile(tmpPath, bytes);
      await fs.promises.rename(tmpPath, this.databasePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          await fs.promises.unlink(tmpPath);
        }
      } catch {}
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
