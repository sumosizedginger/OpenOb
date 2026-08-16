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

/**
 * Browser File System Access API adapter for VaultStorage.
 * Interacts with native user-picked directories via `window.showDirectoryPicker()`.
 */
export class BrowserFSAVaultStorage implements VaultStorage {
  private listeners = new Set<VaultChangeListener>();

  constructor(
    public readonly directoryHandle: any,
    public readonly name: string = directoryHandle.name || 'web-vault'
  ) {}

  private async getHandleForPath(
    rawPath: VaultPath,
    create = false,
    isDirectory = false
  ): Promise<{ parent: any; handle: any; name: string }> {
    const norm = normalizeVaultPath(rawPath);
    if (!norm) {
      return { parent: null, handle: this.directoryHandle, name: this.name };
    }

    const parts = norm.split('/');
    const targetName = parts.pop()!;
    let currentDir = this.directoryHandle;

    for (const part of parts) {
      try {
        currentDir = await currentDir.getDirectoryHandle(part, { create });
      } catch (err: any) {
        throw new NotFoundError(rawPath, `Directory "${part}" not found in path "${rawPath}"`);
      }
    }

    try {
      if (isDirectory) {
        const handle = await currentDir.getDirectoryHandle(targetName, { create });
        return { parent: currentDir, handle, name: targetName };
      } else {
        const handle = await currentDir.getFileHandle(targetName, { create });
        return { parent: currentDir, handle, name: targetName };
      }
    } catch (err: any) {
      throw new NotFoundError(rawPath, `Item "${targetName}" not found at "${rawPath}"`);
    }
  }

  async list(rawPath: VaultPath = '', recursive = false): Promise<VaultEntry[]> {
    const dir = normalizeVaultPath(rawPath);
    let targetDir = this.directoryHandle;

    if (dir) {
      const parts = dir.split('/');
      for (const part of parts) {
        try {
          targetDir = await targetDir.getDirectoryHandle(part);
        } catch {
          return [];
        }
      }
    }

    const results: VaultEntry[] = [];
    await this.collectEntries(targetDir, dir, recursive, results);

    return results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
  }

  private async collectEntries(
    dirHandle: any,
    prefix: string,
    recursive: boolean,
    out: VaultEntry[]
  ): Promise<void> {
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;

      const relPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        out.push({
          path: relPath,
          name,
          isDirectory: true,
        });
        if (recursive) {
          await this.collectEntries(handle, relPath, true, out);
        }
      } else {
        try {
          const file = await handle.getFile();
          out.push({
            path: relPath,
            name,
            isDirectory: false,
            size: file.size,
            modifiedAt: file.lastModified,
          });
        } catch {}
      }
    }
  }

  get atomicWrites(): boolean {
    return (
      (typeof FileSystemFileHandle !== 'undefined' &&
        typeof (FileSystemFileHandle.prototype as any)?.move === 'function') ||
      (typeof FileSystemHandle !== 'undefined' &&
        typeof (FileSystemHandle.prototype as any)?.move === 'function')
    );
  }

  async read(rawPath: VaultPath): Promise<FileSnapshot> {
    const norm = normalizeVaultPath(rawPath);
    const { handle } = await this.getHandleForPath(norm, false, false);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const hash = computeContentHash(bytes);
    const hasBom =
      bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const version: FileVersion = {
      token: createVersionToken(hash, file.lastModified, file.size),
      hash,
      modifiedAt: file.lastModified,
      size: file.size,
    };
    return {
      path: norm,
      version,
      content: bytes,
      textContent: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
      hasBom,
      modifiedAt: file.lastModified,
      size: file.size,
    };
  }

  async readText(rawPath: VaultPath): Promise<string> {
    const snap = await this.read(rawPath);
    return snap.textContent ?? new TextDecoder('utf-8', { ignoreBOM: true }).decode(snap.content);
  }

  async write(
    rawPath: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult> {
    const norm = normalizeVaultPath(rawPath);
    let existingVersion: FileVersion | null = null;
    let existingContent: Uint8Array | undefined;

    try {
      const existing = await this.read(norm);
      existingVersion = existing.version;
      existingContent = existing.content;
    } catch (err: any) {
      if (err.name !== 'NotFoundError' && err.code !== 'ENOENT') {
        // Unexpected read error
      }
    }

    // Version Concurrency Check (F-001 mitigation)
    if (expectedVersion !== undefined) {
      if (expectedVersion === null) {
        if (existingVersion !== null) {
          throw new ConflictError(
            norm,
            null,
            existingVersion,
            existingContent,
            `Cannot create "${norm}": file already exists in vault.`
          );
        }
      } else {
        if (existingVersion === null) {
          throw new ConflictError(
            norm,
            expectedVersion,
            null,
            undefined,
            `Cannot write "${norm}": file does not exist in vault.`
          );
        }

        const tokenMatches = existingVersion.token === expectedVersion.token;
        const hashMatches = existingVersion.hash === expectedVersion.hash;

        if (!tokenMatches && !hashMatches) {
          throw new ConflictError(
            norm,
            expectedVersion,
            existingVersion,
            existingContent,
            `Conflict on "${norm}": file was modified externally.`
          );
        }
      }
    }

    const { parent: parentDirHandle, name: filename } = await this.getHandleForPath(
      norm,
      true,
      false
    );

    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const newHash = computeContentHash(bytes);
    const hasBom =
      bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

    // Atomic write strategy: write to temporary file then move/swap over target if supported
    const tempName = `${filename}.okw.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    let targetHandle: FileSystemFileHandle;

    try {
      const tempHandle = await parentDirHandle.getFileHandle(tempName, { create: true });
      const writable = await tempHandle.createWritable();
      await writable.write(bytes);
      await writable.close();

      if (typeof (tempHandle as any).move === 'function') {
        await (tempHandle as any).move(filename);
        targetHandle = await parentDirHandle.getFileHandle(filename, { create: false });
      } else {
        // Fallback for browsers without FileSystemHandle.move() (P2-FSA-001)
        console.warn(
          `[BrowserFsaVaultStorage] FileSystemHandle.move() is not supported in this browser runtime. Falling back to direct in-place write for "${norm}". Atomic temp-and-swap guarantees are unavailable.`
        );
        try {
          await parentDirHandle.removeEntry(tempName);
        } catch {}
        targetHandle = await parentDirHandle.getFileHandle(filename, { create: true });
        const directWritable = await targetHandle.createWritable();
        await directWritable.write(bytes);
        await directWritable.close();
      }
    } catch (err: any) {
      try {
        await parentDirHandle.removeEntry(tempName);
      } catch {}
      throw err;
    }

    const updatedFile = await targetHandle.getFile();
    const newVersion: FileVersion = {
      token: createVersionToken(newHash, updatedFile.lastModified, updatedFile.size),
      hash: newHash,
      modifiedAt: updatedFile.lastModified,
      size: updatedFile.size,
    };

    const snapshot: FileSnapshot = {
      path: norm,
      version: newVersion,
      content: bytes,
      textContent:
        typeof content === 'string'
          ? content
          : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
      hasBom,
      modifiedAt: updatedFile.lastModified,
      size: updatedFile.size,
    };

    const wasCreated = !existingVersion;
    this.notify({
      type: wasCreated ? 'created' : 'modified',
      path: norm,
      timestamp: Date.now(),
    });

    return { snapshot, previousVersion: existingVersion, wasCreated };
  }

  async stat(rawPath: VaultPath): Promise<FileStat | null> {
    const norm = normalizeVaultPath(rawPath);
    if (!norm) {
      return { path: '', isDirectory: true, size: 0, modifiedAt: 0 };
    }
    try {
      const { handle } = await this.getHandleForPath(norm, false, false);
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = computeContentHash(bytes);
      return {
        path: norm,
        isDirectory: false,
        size: file.size,
        modifiedAt: file.lastModified,
        version: {
          token: createVersionToken(hash, file.lastModified, file.size),
          hash,
          modifiedAt: file.lastModified,
          size: file.size,
        },
      };
    } catch {
      try {
        await this.getHandleForPath(norm, false, true);
        return { path: norm, isDirectory: true, size: 0, modifiedAt: 0 };
      } catch {
        return null;
      }
    }
  }

  async exists(rawPath: VaultPath): Promise<boolean> {
    const stat = await this.stat(rawPath);
    return stat !== null;
  }

  async move(rawFrom: VaultPath, rawTo: VaultPath, overwrite = false): Promise<void> {
    const from = normalizeVaultPath(rawFrom);
    const to = normalizeVaultPath(rawTo);
    if (from === to) return;

    const source = await this.read(from);
    await this.write(to, overwrite ? undefined : null, source.content);
    await this.remove(from);

    this.notify({ type: 'renamed', path: to, oldPath: from, timestamp: Date.now() });
  }

  async remove(rawPath: VaultPath): Promise<void> {
    const norm = normalizeVaultPath(rawPath);
    if (!norm) return;

    const parentDir = dirnameVaultPath(norm);
    const name = norm.split('/').pop()!;
    let targetDir = this.directoryHandle;

    if (parentDir) {
      for (const part of parentDir.split('/')) {
        targetDir = await targetDir.getDirectoryHandle(part);
      }
    }

    await targetDir.removeEntry(name, { recursive: true });
    this.notify({ type: 'deleted', path: norm, timestamp: Date.now() });
  }

  async createFolder(rawPath: VaultPath): Promise<void> {
    const norm = normalizeVaultPath(rawPath);
    if (!norm) return;
    await this.getHandleForPath(norm, true, true);
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
