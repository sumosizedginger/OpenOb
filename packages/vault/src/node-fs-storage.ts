import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';
import {
  computeContentHash,
  ConflictError,
  createVersionToken,
  FileSnapshot,
  FileStat,
  FileVersion,
  normalizeVaultPath,
  NotFoundError,
  StorageError,
  SecurityError,
  VaultChangeEvent,
  VaultChangeListener,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';

function normalizeFsPath(p: string): string {
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.startsWith('//?/')) {
    norm = norm.slice(4);
  }
  if (process.platform === 'win32') {
    norm = norm.toLowerCase();
  }
  while (norm.length > 1 && norm.endsWith('/')) {
    norm = norm.slice(0, -1);
  }
  return norm;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const normChild = normalizeFsPath(childPath);
  const normParent = normalizeFsPath(parentPath);
  return normChild === normParent || normChild.startsWith(normParent + '/');
}

/**
 * Node.js filesystem implementation of VaultStorage.
 * Uses atomic temporary writes with fsync, strict boundary checks,
 * and version concurrency enforcement.
 */
export class NodeFsVaultStorage implements VaultStorage {
  private listeners = new Set<VaultChangeListener>();

  constructor(
    public readonly rootDir: string,
    public readonly name: string = path.basename(rootDir) || 'local-vault'
  ) {}

  private async resolveToDiskSafe(rawPath: VaultPath): Promise<string> {
    const norm = normalizeVaultPath(rawPath);
    const rootResolved = path.resolve(this.rootDir);
    const diskPath = path.resolve(this.rootDir, norm);

    if (!isPathInside(diskPath, rootResolved)) {
      throw new SecurityError(`Path escapes vault root: "${rawPath}"`);
    }

    try {
      const realDisk = await fs.realpath(diskPath);
      const realRoot = await fs.realpath(rootResolved);

      if (!isPathInside(realDisk, realRoot)) {
        throw new SecurityError(`Symlink traversal detected outside vault root: "${rawPath}"`);
      }
    } catch (err: any) {
      if (err instanceof SecurityError) {
        throw err;
      }
      if (err.code === 'ENOENT') {
        // Target does not exist yet: check existing ancestors
        const realRoot = await fs.realpath(rootResolved);
        let curr = path.dirname(diskPath);
        while (isPathInside(curr, rootResolved)) {
          try {
            const realCurr = await fs.realpath(curr);
            if (!isPathInside(realCurr, realRoot)) {
              throw new SecurityError(`Ancestor symlink traversal detected: "${rawPath}"`);
            }
            break;
          } catch (ancestorErr: any) {
            if (ancestorErr instanceof SecurityError) throw ancestorErr;
            if (curr === rootResolved || curr === path.dirname(curr)) break;
            curr = path.dirname(curr);
          }
        }
      }
    }

    return diskPath;
  }

  async list(rawPath: VaultPath = '', recursive = false): Promise<VaultEntry[]> {
    const dir = normalizeVaultPath(rawPath);
    const diskPath = await this.resolveToDiskSafe(dir);

    try {
      const entries = await fs.readdir(diskPath, { withFileTypes: true });
      const results: VaultEntry[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const relPath = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push({
            path: relPath,
            name: entry.name,
            isDirectory: true,
          });
          if (recursive) {
            const sub = await this.list(relPath, true);
            results.push(...sub);
          }
        } else if (entry.isFile()) {
          const stats = await fs.stat(path.join(diskPath, entry.name));
          results.push({
            path: relPath,
            name: entry.name,
            isDirectory: false,
            size: stats.size,
            modifiedAt: stats.mtimeMs,
          });
        }
      }

      return results.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      });
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw new StorageError(`Failed to list directory "${rawPath}": ${err.message}`, err);
    }
  }

  async read(rawPath: VaultPath): Promise<FileSnapshot> {
    const diskPath = await this.resolveToDiskSafe(rawPath);
    try {
      const [content, stats] = await Promise.all([fs.readFile(diskPath), fs.stat(diskPath)]);
      const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      const hash = computeContentHash(bytes);
      const hasBom =
        bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const version: FileVersion = {
        token: createVersionToken(hash, stats.mtimeMs, stats.size),
        hash,
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      };
      return {
        path: normalizeVaultPath(rawPath),
        version,
        content: bytes,
        textContent: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
        hasBom,
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      };
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (err.code === 'ENOENT') {
        throw new NotFoundError(rawPath);
      }
      throw new StorageError(`Failed to read "${rawPath}": ${err.message}`, err);
    }
  }

  async readText(rawPath: VaultPath): Promise<string> {
    const diskPath = await this.resolveToDiskSafe(rawPath);
    try {
      return await fs.readFile(diskPath, 'utf8');
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (err.code === 'ENOENT') {
        throw new NotFoundError(rawPath);
      }
      throw new StorageError(`Failed to read "${rawPath}": ${err.message}`, err);
    }
  }

  async write(
    rawPath: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult> {
    const normPath = normalizeVaultPath(rawPath);
    const diskPath = await this.resolveToDiskSafe(normPath);
    const parentDir = path.dirname(diskPath);

    // Ensure parent directory exists
    await fs.mkdir(parentDir, { recursive: true });

    // Check existing stat for version concurrency checking (F-001)
    let existingStat: Stats | null = null;
    let existingHash: string | null = null;
    let previousVersion: FileVersion | null = null;

    try {
      existingStat = await fs.stat(diskPath);
      const existingBytes = await fs.readFile(diskPath);
      existingHash = computeContentHash(existingBytes);
      previousVersion = {
        token: createVersionToken(existingHash, existingStat.mtimeMs, existingStat.size),
        hash: existingHash,
        modifiedAt: existingStat.mtimeMs,
        size: existingStat.size,
      };
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw new StorageError(`Error checking stat for "${normPath}": ${err.message}`, err);
      }
    }

    // Version Concurrency Enforcement (F-001 mitigation)
    if (expectedVersion !== undefined) {
      if (expectedVersion === null) {
        if (existingStat) {
          throw new ConflictError(
            normPath,
            null,
            previousVersion,
            undefined,
            `Cannot create "${normPath}": file already exists on disk.`
          );
        }
      } else {
        if (!existingStat) {
          throw new ConflictError(
            normPath,
            expectedVersion,
            null,
            undefined,
            `Cannot write "${normPath}": file was deleted on disk.`
          );
        }

        const tokenMatches = previousVersion?.token === expectedVersion.token;
        const hashMatches = previousVersion?.hash === expectedVersion.hash;

        if (!tokenMatches && !hashMatches) {
          const currentBytes = await fs.readFile(diskPath);
          throw new ConflictError(
            normPath,
            expectedVersion,
            previousVersion,
            currentBytes,
            `Conflict on "${normPath}": file was modified externally.`
          );
        }
      }
    }

    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const newHash = computeContentHash(bytes);

    // Atomic Temporary Write with FSYNC (H-03 & F-002 mitigation)
    const tmpDiskPath = `${diskPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

    try {
      const fileHandle = await fs.open(tmpDiskPath, 'w');
      try {
        await fileHandle.writeFile(bytes);
        // Explicit fsync guarantees flushed buffers to physical disk before rename
        await fileHandle.sync();
      } finally {
        await fileHandle.close();
      }

      // Re-verify parent directory containment immediately before atomic rename (TOCTOU protection)
      const rootResolved = path.resolve(this.rootDir);
      const realParent = await fs.realpath(parentDir);
      const realRoot = await fs.realpath(rootResolved);
      if (!isPathInside(realParent, realRoot)) {
        throw new SecurityError(
          `Destination directory escaped vault root before rename: "${normPath}"`
        );
      }

      await this.onBeforeCommit(normPath, diskPath, tmpDiskPath);

      // Delete-during-write, same-stat, and fail-closed protection (H10, H11): re-verify canonical target immediately before rename
      if (expectedVersion !== undefined && expectedVersion !== null) {
        try {
          const currentStat = await fs.stat(diskPath);
          const currentBytes = await fs.readFile(diskPath);
          const currentHash = computeContentHash(currentBytes);
          const currentToken = createVersionToken(
            currentHash,
            currentStat.mtimeMs,
            currentStat.size
          );
          const tokenMatches = expectedVersion.token === currentToken;
          const hashMatches = expectedVersion.hash === currentHash;
          if (!tokenMatches && !hashMatches) {
            const actualVersion: FileVersion = {
              token: currentToken,
              hash: currentHash,
              modifiedAt: currentStat.mtimeMs,
              size: currentStat.size,
            };
            throw new ConflictError(
              normPath,
              expectedVersion,
              actualVersion,
              currentBytes,
              'File version modified externally during write'
            );
          }
        } catch (err: any) {
          if (err instanceof ConflictError) throw err;
          if (err.code === 'ENOENT') {
            throw new ConflictError(
              normPath,
              expectedVersion,
              null,
              undefined,
              'Cannot write: file was deleted externally during write'
            );
          }
          // H11: Fail-closed on any unexpected error during recheck (e.g. EACCES, EPERM, EIO)
          throw new StorageError(
            `Pre-commit verification failed for "${normPath}": ${err.message}`,
            err
          );
        }
      } else if (expectedVersion === null) {
        try {
          const currentStat = await fs.stat(diskPath);
          const currentBytes = await fs.readFile(diskPath);
          const currentHash = computeContentHash(currentBytes);
          const actualVersion: FileVersion = {
            token: createVersionToken(currentHash, currentStat.mtimeMs, currentStat.size),
            hash: currentHash,
            modifiedAt: currentStat.mtimeMs,
            size: currentStat.size,
          };
          throw new ConflictError(
            normPath,
            expectedVersion,
            actualVersion,
            currentBytes,
            'Cannot create: file was created externally during write'
          );
        } catch (err: any) {
          if (err instanceof ConflictError) throw err;
          if (err.code === 'ENOENT') {
            // Target file does not exist — creation check passes cleanly!
          } else {
            // H11: Fail-closed on any unexpected error during recheck
            throw new StorageError(
              `Pre-commit creation verification failed for "${normPath}": ${err.message}`,
              err
            );
          }
        }
      }

      // Atomic rename replaces target file safely
      await fs.rename(tmpDiskPath, diskPath);

      // Fsync parent directory on non-Windows platforms (POSIX durability)
      if (process.platform !== 'win32') {
        try {
          const dirHandle = await fs.open(parentDir, 'r');
          try {
            await dirHandle.sync();
          } finally {
            await dirHandle.close();
          }
        } catch {}
      }
    } catch (err: any) {
      try {
        await fs.unlink(tmpDiskPath);
      } catch {}
      if (err instanceof SecurityError || err instanceof ConflictError) throw err;
      throw new StorageError(`Atomic write failed for "${normPath}": ${err.message}`, err);
    }

    const newStats = await fs.stat(diskPath);
    const newVersion: FileVersion = {
      token: createVersionToken(newHash, newStats.mtimeMs, newStats.size),
      hash: newHash,
      modifiedAt: newStats.mtimeMs,
      size: newStats.size,
    };

    const hasBom =
      bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

    const snapshot: FileSnapshot = {
      path: normPath,
      version: newVersion,
      content: bytes,
      textContent:
        typeof content === 'string'
          ? content
          : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
      hasBom,
      modifiedAt: newStats.mtimeMs,
      size: newStats.size,
    };

    const wasCreated = !existingStat;
    this.notify({
      type: wasCreated ? 'created' : 'modified',
      path: normPath,
      timestamp: Date.now(),
    });

    return { snapshot, previousVersion, wasCreated };
  }

  async stat(rawPath: VaultPath): Promise<FileStat | null> {
    const diskPath = await this.resolveToDiskSafe(rawPath);
    try {
      const stats = await fs.stat(diskPath);
      let version: FileVersion | undefined;
      if (stats.isFile()) {
        const bytes = await fs.readFile(diskPath);
        const hash = computeContentHash(bytes);
        version = {
          token: createVersionToken(hash, stats.mtimeMs, stats.size),
          hash,
          modifiedAt: stats.mtimeMs,
          size: stats.size,
        };
      }
      return {
        path: normalizeVaultPath(rawPath),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        version,
      };
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (err.code === 'ENOENT') {
        return null;
      }
      throw new StorageError(`Failed to stat "${rawPath}": ${err.message}`, err);
    }
  }

  async exists(rawPath: VaultPath): Promise<boolean> {
    const diskPath = await this.resolveToDiskSafe(rawPath);
    try {
      await fs.access(diskPath);
      return true;
    } catch {
      return false;
    }
  }

  async move(rawFrom: VaultPath, rawTo: VaultPath, overwrite = false): Promise<void> {
    const from = normalizeVaultPath(rawFrom);
    const to = normalizeVaultPath(rawTo);
    if (from === to) return;

    const diskFrom = await this.resolveToDiskSafe(from);
    const diskTo = await this.resolveToDiskSafe(to);

    if (!overwrite) {
      const targetExists = await this.exists(to);
      if (targetExists) {
        throw new ConflictError(to, null, null, undefined, `Destination "${to}" already exists.`);
      }
    }

    const parentDir = path.dirname(diskTo);
    await fs.mkdir(parentDir, { recursive: true });

    try {
      await fs.rename(diskFrom, diskTo);
      this.notify({ type: 'renamed', path: to, oldPath: from, timestamp: Date.now() });
    } catch (err: any) {
      throw new StorageError(`Failed to move "${from}" to "${to}": ${err.message}`, err);
    }
  }

  async remove(rawPath: VaultPath): Promise<void> {
    const normPath = normalizeVaultPath(rawPath);
    if (!normPath) return;

    const diskPath = await this.resolveToDiskSafe(normPath);
    try {
      const stats = await fs.stat(diskPath);
      if (stats.isDirectory()) {
        await fs.rm(diskPath, { recursive: true, force: true });
      } else {
        await fs.unlink(diskPath);
      }
      this.notify({ type: 'deleted', path: normPath, timestamp: Date.now() });
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      if (err.code !== 'ENOENT') {
        throw new StorageError(`Failed to remove "${normPath}": ${err.message}`, err);
      }
    }
  }

  async createFolder(rawPath: VaultPath): Promise<void> {
    const normPath = normalizeVaultPath(rawPath);
    if (!normPath) return;
    const diskPath = await this.resolveToDiskSafe(normPath);
    try {
      await fs.mkdir(diskPath, { recursive: true });
    } catch (err: any) {
      if (err instanceof SecurityError) throw err;
      throw new StorageError(`Failed to create folder "${normPath}": ${err.message}`, err);
    }
  }

  watch(listener: VaultChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: VaultChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Vault listener error:', err);
      }
    }
  }

  /**
   * Internal hook called immediately after writing temporary file and verifying TOCTOU containment,
   * before the pre-commit recheck and atomic rename. Subclasses and tests can override.
   */
  protected async onBeforeCommit(
    _normPath: VaultPath,
    _diskPath: string,
    _tmpDiskPath: string
  ): Promise<void> {}
}
