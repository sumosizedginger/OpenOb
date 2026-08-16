import {
  FileSnapshot,
  FileStat,
  FileVersion,
  VaultEntry,
  VaultPath,
  WriteResult,
} from './types.js';

export type VaultChangeListener = (event: VaultChangeEvent) => void;

export type VaultChangeType = 'created' | 'modified' | 'deleted' | 'renamed';

export interface VaultChangeEvent {
  readonly type: VaultChangeType;
  readonly path: VaultPath;
  readonly oldPath?: VaultPath;
  readonly timestamp: number;
}

/**
 * VaultStorage is the canonical storage interface for reading, writing,
 * listing, and watching notes and attachments in a vault.
 * All implementations MUST prevent silent overwrites via expectedVersion check.
 */
export interface VaultStorage {
  /**
   * Root identifier or human-readable name of the vault.
   */
  readonly name: string;

  /**
   * List files and folders under the given directory path (empty string for root).
   * @param path Optional relative directory path.
   * @param recursive If true, lists all descendants recursively.
   */
  list(path?: VaultPath, recursive?: boolean): Promise<VaultEntry[]>;

  /**
   * Read raw bytes and snapshot metadata for a file.
   * Throws NotFoundError if the file does not exist.
   */
  read(path: VaultPath): Promise<FileSnapshot>;

  /**
   * Read file content as UTF-8 string.
   */
  readText(path: VaultPath): Promise<string>;

  /**
   * Write data safely to a file.
   * If expectedVersion is provided:
   *   - If file does not exist or version does not match expectedVersion, throws ConflictError.
   * If expectedVersion is null:
   *   - Creation only: if file already exists, throws ConflictError.
   * If expectedVersion is undefined:
   *   - Unconditional overwrite (used only when user explicitly confirms force save).
   */
  write(
    path: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult>;

  /**
   * Get metadata stat for a path, or null if it does not exist.
   */
  stat(path: VaultPath): Promise<FileStat | null>;

  /**
   * Check if a path exists.
   */
  exists(path: VaultPath): Promise<boolean>;

  /**
   * Move / rename a file or directory.
   */
  move(from: VaultPath, to: VaultPath, overwrite?: boolean): Promise<void>;

  /**
   * Delete a file or directory (recursively if folder).
   */
  remove(path: VaultPath): Promise<void>;

  /**
   * Create a directory (and any necessary parent directories).
   */
  createFolder(path: VaultPath): Promise<void>;

  /**
   * Optional file watcher subscription.
   */
  watch?(listener: VaultChangeListener): () => void;
}
