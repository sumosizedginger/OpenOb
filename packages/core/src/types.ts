/**
 * VaultPath is a normalized, relative POSIX-style path within a vault.
 * Examples: "notes/index.md", "daily/2026-08-15.md", "attachments/image.png"
 * Never starts with a leading slash or contains ".." traversal.
 */
export type VaultPath = string;

/**
 * FileVersion represents a concurrency token.
 * It is calculated from content hash and/or modified timestamp
 * to detect external or concurrent modifications.
 */
export interface FileVersion {
  readonly token: string;
  readonly hash: string;
  readonly modifiedAt?: number;
  readonly size?: number;
}

/**
 * FileSnapshot represents an immutable read-snapshot of a file at a specific version.
 */
export interface FileSnapshot {
  readonly path: VaultPath;
  readonly version: FileVersion;
  readonly content: Uint8Array;
  readonly textContent?: string;
  readonly modifiedAt: number;
  readonly size: number;
}

/**
 * FileStat represents filesystem metadata for a file or directory.
 */
export interface FileStat {
  readonly path: VaultPath;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly modifiedAt: number;
  readonly version?: FileVersion;
}

/**
 * VaultEntry represents an item in a directory listing.
 */
export interface VaultEntry {
  readonly path: VaultPath;
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size?: number;
  readonly modifiedAt?: number;
}

/**
 * WriteResult returned after a successful safe-write operation.
 */
export interface WriteResult {
  readonly snapshot: FileSnapshot;
  readonly previousVersion: FileVersion | null;
  readonly wasCreated: boolean;
}
