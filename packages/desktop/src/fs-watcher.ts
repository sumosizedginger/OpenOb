import * as fs from 'fs';
import * as path from 'path';
import { normalizeVaultPath } from '@okw/core';
import { VaultWatcher, WatcherEvent, WatcherEventListener } from './types.js';

export interface NativeVaultWatcherOptions {
  readonly debounceMs?: number;
  readonly ignorePatterns?: RegExp[];
}

const DEFAULT_IGNORE_PATTERNS = [
  /\.okw\.tmp\./i, // SafeWriter atomic swap files
  /^\.git/i,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
];

export class NativeVaultWatcher implements VaultWatcher {
  private readonly rootPath: string;
  private readonly debounceMs: number;
  private readonly ignorePatterns: RegExp[];
  private watcher: fs.FSWatcher | null = null;
  private listeners: Set<WatcherEventListener> = new Set();
  private debounceMap: Map<string, { timer: NodeJS.Timeout; eventType: string }> = new Map();

  constructor(rootPath: string, options: NativeVaultWatcherOptions = {}) {
    this.rootPath = path.resolve(rootPath);
    this.debounceMs = options.debounceMs ?? 50;
    this.ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    if (!fs.existsSync(this.rootPath)) {
      throw new Error(`Vault directory does not exist: ${this.rootPath}`);
    }

    try {
      this.watcher = fs.watch(
        this.rootPath,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;
          this.handleFsEvent(eventType, filename);
        }
      );
    } catch (err) {
      // Fallback for non-recursive platforms
      this.watcher = fs.watch(this.rootPath, (eventType, filename) => {
        if (!filename) return;
        this.handleFsEvent(eventType, filename);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const entry of this.debounceMap.values()) {
      clearTimeout(entry.timer);
    }
    this.debounceMap.clear();
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  addListener(listener: WatcherEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Internal handler filtering and debouncing raw OS filesystem events.
   */
  public handleFsEvent(eventType: string, relativeOsPath: string): void {
    const normalized = relativeOsPath.replace(/\\/g, '/');

    // 1. Check ignore filters (e.g. .okw.tmp.* swap files)
    for (const pattern of this.ignorePatterns) {
      if (pattern.test(normalized) || pattern.test(path.basename(normalized))) {
        return;
      }
    }

    const vaultPath = normalizeVaultPath(normalized);

    // 2. Debounce burst events
    const existing = this.debounceMap.get(vaultPath);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.debounceMap.delete(vaultPath);
      this.emitEvent(eventType, vaultPath);
    }, this.debounceMs);

    this.debounceMap.set(vaultPath, { timer, eventType });
  }

  private emitEvent(fsEventType: string, vaultPath: string): void {
    const fullPath = path.join(this.rootPath, vaultPath);
    const exists = fs.existsSync(fullPath);

    let type: WatcherEvent['type'] = 'modified';
    if (!exists) {
      type = 'deleted';
    } else if (fsEventType === 'rename') {
      type = 'created';
    }

    const event: WatcherEvent = {
      type,
      path: vaultPath,
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in VaultWatcher listener:', err);
      }
    }
  }
}
