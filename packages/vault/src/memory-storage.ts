import {
  computeContentHash,
  ConflictError,
  createVersionToken,
  dirnameVaultPath,
  FileSnapshot,
  FileStat,
  FileVersion,
  normalizeVaultPath,
  NotFoundError,
  VaultChangeEvent,
  VaultChangeListener,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';

interface MemoryFileEntry {
  path: VaultPath;
  content: Uint8Array;
  modifiedAt: number;
  hash: string;
}

/**
 * In-memory implementation of VaultStorage.
 * Ideal for high-speed testing, temporary sandboxes, and browser demo environments.
 */
export class MemoryVaultStorage implements VaultStorage {
  private files = new Map<VaultPath, MemoryFileEntry>();
  private directories = new Set<VaultPath>();
  private listeners = new Set<VaultChangeListener>();

  constructor(public readonly name: string = 'memory-vault') {
    // Root directory always exists
    this.directories.add('');
  }

  /**
   * Helper to seed initial files (e.g. for testing).
   */
  async seed(entries: Record<string, string | Uint8Array>): Promise<void> {
    for (const [rawPath, content] of Object.entries(entries)) {
      const path = normalizeVaultPath(rawPath);
      const parent = dirnameVaultPath(path);
      if (parent) {
        await this.createFolder(parent);
      }
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      const hash = computeContentHash(bytes);
      const now = Date.now();
      this.files.set(path, { path, content: bytes, modifiedAt: now, hash });
    }
  }

  async list(rawPath: VaultPath = '', recursive = false): Promise<VaultEntry[]> {
    const dir = normalizeVaultPath(rawPath);
    const results: VaultEntry[] = [];
    const dirPrefix = dir ? `${dir}/` : '';

    // Collect matching files
    for (const [path, file] of this.files.entries()) {
      if (!path.startsWith(dirPrefix)) continue;
      const rel = path.slice(dirPrefix.length);
      if (!rel) continue;

      if (!recursive && rel.includes('/')) {
        // Collect immediate subfolder
        const folderName = rel.split('/')[0];
        const folderPath = dir ? `${dir}/${folderName}` : folderName;
        if (!results.some((e) => e.path === folderPath)) {
          results.push({
            path: folderPath,
            name: folderName,
            isDirectory: true,
            modifiedAt: file.modifiedAt,
          });
        }
      } else {
        const name = rel.split('/').pop() || rel;
        results.push({
          path,
          name,
          isDirectory: false,
          size: file.content.byteLength,
          modifiedAt: file.modifiedAt,
        });
      }
    }

    // Collect empty directories
    for (const d of this.directories) {
      if (!d || d === dir) continue;
      if (!d.startsWith(dirPrefix)) continue;
      const rel = d.slice(dirPrefix.length);
      if (!rel) continue;

      if (!recursive && rel.includes('/')) {
        const folderName = rel.split('/')[0];
        const folderPath = dir ? `${dir}/${folderName}` : folderName;
        if (!results.some((e) => e.path === folderPath)) {
          results.push({
            path: folderPath,
            name: folderName,
            isDirectory: true,
          });
        }
      } else {
        if (!results.some((e) => e.path === d)) {
          const name = d.split('/').pop() || d;
          results.push({
            path: d,
            name,
            isDirectory: true,
          });
        }
      }
    }

    // Sort directories first, then alphabetical
    return results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
  }

  async read(rawPath: VaultPath): Promise<FileSnapshot> {
    const path = normalizeVaultPath(rawPath);
    const file = this.files.get(path);
    if (!file) {
      throw new NotFoundError(path);
    }
    const version: FileVersion = {
      token: createVersionToken(file.hash, file.modifiedAt, file.content.byteLength),
      hash: file.hash,
      modifiedAt: file.modifiedAt,
      size: file.content.byteLength,
    };
    return {
      path: file.path,
      version,
      content: file.content.slice(),
      textContent: new TextDecoder().decode(file.content),
      modifiedAt: file.modifiedAt,
      size: file.content.byteLength,
    };
  }

  async readText(rawPath: VaultPath): Promise<string> {
    const snap = await this.read(rawPath);
    return snap.textContent ?? new TextDecoder().decode(snap.content);
  }

  async write(
    rawPath: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult> {
    const path = normalizeVaultPath(rawPath);
    const existing = this.files.get(path);
    const now = Date.now();
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const newHash = computeContentHash(bytes);

    let previousVersion: FileVersion | null = null;
    if (existing) {
      previousVersion = {
        token: createVersionToken(existing.hash, existing.modifiedAt, existing.content.byteLength),
        hash: existing.hash,
        modifiedAt: existing.modifiedAt,
        size: existing.content.byteLength,
      };
    }

    // Version Concurrency Enforcement (F-001 mitigation)
    if (expectedVersion !== undefined) {
      if (expectedVersion === null) {
        // Creation expectation: file must NOT exist
        if (existing) {
          throw new ConflictError(
            path,
            null,
            previousVersion,
            existing.content,
            `Cannot create "${path}": file already exists.`
          );
        }
      } else {
        // Update expectation: file must exist and version token / hash must match
        if (!existing) {
          throw new ConflictError(
            path,
            expectedVersion,
            null,
            undefined,
            `Cannot write "${path}": file was deleted externally.`
          );
        }

        // Compare version tokens or hashes
        const tokenMatches = previousVersion?.token === expectedVersion.token;
        const hashMatches = previousVersion?.hash === expectedVersion.hash;

        if (!tokenMatches && !hashMatches) {
          throw new ConflictError(
            path,
            expectedVersion,
            previousVersion,
            existing.content,
            `Conflict on "${path}": file was modified concurrently.`
          );
        }
      }
    }

    // Ensure parent directory exists
    const parent = dirnameVaultPath(path);
    if (parent) {
      await this.createFolder(parent);
    }

    const wasCreated = !existing;
    this.files.set(path, {
      path,
      content: bytes,
      modifiedAt: now,
      hash: newHash,
    });

    const newVersion: FileVersion = {
      token: createVersionToken(newHash, now, bytes.byteLength),
      hash: newHash,
      modifiedAt: now,
      size: bytes.byteLength,
    };

    const snapshot: FileSnapshot = {
      path,
      version: newVersion,
      content: bytes,
      textContent: typeof content === 'string' ? content : new TextDecoder().decode(bytes),
      modifiedAt: now,
      size: bytes.byteLength,
    };

    const event: VaultChangeEvent = {
      type: wasCreated ? 'created' : 'modified',
      path,
      timestamp: now,
    };
    this.notify(event);

    return { snapshot, previousVersion, wasCreated };
  }

  async stat(rawPath: VaultPath): Promise<FileStat | null> {
    const path = normalizeVaultPath(rawPath);
    if (path === '' || this.directories.has(path)) {
      return {
        path,
        isDirectory: true,
        size: 0,
        modifiedAt: 0,
      };
    }
    const file = this.files.get(path);
    if (file) {
      return {
        path: file.path,
        isDirectory: false,
        size: file.content.byteLength,
        modifiedAt: file.modifiedAt,
        version: {
          token: createVersionToken(file.hash, file.modifiedAt, file.content.byteLength),
          hash: file.hash,
          modifiedAt: file.modifiedAt,
          size: file.content.byteLength,
        },
      };
    }
    return null;
  }

  async exists(rawPath: VaultPath): Promise<boolean> {
    const path = normalizeVaultPath(rawPath);
    if (path === '' || this.directories.has(path)) return true;
    return this.files.has(path);
  }

  async move(rawFrom: VaultPath, rawTo: VaultPath, overwrite = false): Promise<void> {
    const from = normalizeVaultPath(rawFrom);
    const to = normalizeVaultPath(rawTo);

    if (from === to) return;

    // Check if it is a directory move
    if (this.directories.has(from)) {
      if (this.directories.has(to) && !overwrite) {
        throw new ConflictError(to, null, null, undefined, `Destination folder "${to}" already exists.`);
      }
      this.directories.delete(from);
      this.directories.add(to);

      const fromPrefix = `${from}/`;
      const toPrefix = `${to}/`;

      // Move all descendant subdirectories in this.directories
      const subDirsToMove: string[] = [];
      for (const d of this.directories) {
        if (d.startsWith(fromPrefix)) {
          subDirsToMove.push(d);
        }
      }
      for (const d of subDirsToMove) {
        this.directories.delete(d);
        const newDir = toPrefix + d.slice(fromPrefix.length);
        this.directories.add(newDir);
      }

      const movedFiles: Array<[VaultPath, MemoryFileEntry]> = [];
      for (const [path, file] of this.files.entries()) {
        if (path.startsWith(fromPrefix)) {
          const newPath = toPrefix + path.slice(fromPrefix.length);
          movedFiles.push([newPath, { ...file, path: newPath }]);
          this.files.delete(path);
        }
      }
      for (const [newPath, entry] of movedFiles) {
        this.files.set(newPath, entry);
      }

      this.notify({ type: 'renamed', path: to, oldPath: from, timestamp: Date.now() });
      return;
    }

    const file = this.files.get(from);
    if (!file) {
      throw new NotFoundError(from);
    }

    if (this.files.has(to) && !overwrite) {
      throw new ConflictError(to, null, null, undefined, `Destination file "${to}" already exists.`);
    }

    const parent = dirnameVaultPath(to);
    if (parent) {
      await this.createFolder(parent);
    }

    this.files.delete(from);
    this.files.set(to, { ...file, path: to });

    this.notify({ type: 'renamed', path: to, oldPath: from, timestamp: Date.now() });
  }

  async remove(rawPath: VaultPath): Promise<void> {
    const path = normalizeVaultPath(rawPath);
    if (!path) return; // Cannot delete vault root

    let removed = false;
    if (this.files.has(path)) {
      this.files.delete(path);
      removed = true;
    }

    // Delete directory and any children recursively
    const dirPrefix = `${path}/`;
    for (const p of Array.from(this.files.keys())) {
      if (p.startsWith(dirPrefix)) {
        this.files.delete(p);
        removed = true;
      }
    }
    for (const d of Array.from(this.directories)) {
      if (d === path || d.startsWith(dirPrefix)) {
        this.directories.delete(d);
        removed = true;
      }
    }

    if (removed) {
      this.notify({ type: 'deleted', path, timestamp: Date.now() });
    }
  }

  async createFolder(rawPath: VaultPath): Promise<void> {
    const path = normalizeVaultPath(rawPath);
    if (!path) return;

    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.directories.add(current);
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
}
