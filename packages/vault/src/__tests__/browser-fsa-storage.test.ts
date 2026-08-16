import { describe, expect, it } from 'vitest';
import { BrowserFSAVaultStorage } from '../browser-fsa-storage.js';
import { ConflictError, StorageError } from '@okw/core';

class MockFile {
  constructor(
    public name: string,
    public buffer: Uint8Array,
    public lastModified: number = Date.now()
  ) {}

  get size(): number {
    return this.buffer.byteLength;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const ab = new ArrayBuffer(this.buffer.byteLength);
    new Uint8Array(ab).set(this.buffer);
    return ab;
  }
}

class MockWritable {
  private chunks: Uint8Array[] = [];

  constructor(private onCommit: (bytes: Uint8Array) => void) {}

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk);
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    this.onCommit(merged);
  }
}

class MockFileHandle {
  public kind = 'file';
  public move?: (newName: string) => Promise<void>;

  constructor(
    public name: string,
    private parent: MockDirectoryHandle,
    public content: Uint8Array = new Uint8Array(),
    public lastModified: number = Date.now(),
    supportsMove: boolean = true
  ) {
    if (supportsMove) {
      this.move = async (newName: string) => {
        this.parent.entriesMap.delete(this.name);
        this.name = newName;
        this.parent.entriesMap.set(newName, this);
      };
    }
  }

  async getFile(): Promise<MockFile> {
    return new MockFile(this.name, this.content, this.lastModified);
  }

  async createWritable(): Promise<MockWritable> {
    return new MockWritable((bytes) => {
      this.content = bytes;
      this.lastModified = Date.now();
    });
  }
}

class MockDirectoryHandle {
  public kind = 'directory';
  public entriesMap = new Map<string, MockFileHandle | MockDirectoryHandle>();

  constructor(
    public name: string = 'root',
    public supportsMove: boolean = true
  ) {}

  async *entries(): AsyncIterable<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const [k, v] of this.entriesMap.entries()) {
      yield [k, v];
    }
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockDirectoryHandle> {
    let entry = this.entriesMap.get(name);
    if (!entry) {
      if (options?.create) {
        entry = new MockDirectoryHandle(name, this.supportsMove);
        this.entriesMap.set(name, entry);
      } else {
        const err: any = new Error(`Directory "${name}" not found`);
        err.name = 'NotFoundError';
        throw err;
      }
    }
    if (entry.kind !== 'directory') {
      const err: any = new Error(`"${name}" is not a directory`);
      err.name = 'TypeMismatchError';
      throw err;
    }
    return entry as MockDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    let entry = this.entriesMap.get(name);
    if (!entry) {
      if (options?.create) {
        entry = new MockFileHandle(name, this, new Uint8Array(), Date.now(), this.supportsMove);
        this.entriesMap.set(name, entry);
      } else {
        const err: any = new Error(`File "${name}" not found`);
        err.name = 'NotFoundError';
        throw err;
      }
    }
    if (entry.kind !== 'file') {
      const err: any = new Error(`"${name}" is not a file`);
      err.name = 'TypeMismatchError';
      throw err;
    }
    return entry as MockFileHandle;
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    if (!this.entriesMap.has(name)) {
      const err: any = new Error(`Entry "${name}" not found`);
      err.name = 'NotFoundError';
      throw err;
    }
    this.entriesMap.delete(name);
  }
}

describe('BrowserFSAVaultStorage Hardening (H9, H10, H11, H17, R1)', () => {
  it('1. creates new note with expectedVersion=null and does not false conflict', async () => {
    const rootHandle = new MockDirectoryHandle('vault');
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const res = await storage.write('Note.md', null, '# Heading 1');
    expect(res.wasCreated).toBe(true);
    expect(res.snapshot.textContent).toBe('# Heading 1');
    expect(await storage.exists('Note.md')).toBe(true);
  });

  it('2. updates existing note with matching expectedVersion without false conflict (H9)', async () => {
    const rootHandle = new MockDirectoryHandle('vault');
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const res1 = await storage.write('Note.md', null, '# Heading 1');
    expect(res1.snapshot.textContent).toBe('# Heading 1');

    // Update Note.md from H1 to H2 using res1.snapshot.version
    const res2 = await storage.write('Note.md', res1.snapshot.version, '# Heading 2');
    expect(res2.snapshot.textContent).toBe('# Heading 2');
    expect(await storage.readText('Note.md')).toBe('# Heading 2');
  });

  it('3. delete-during-write throws ConflictError and does not resurrect file (H9/H2)', async () => {
    const rootHandle = new MockDirectoryHandle('vault');
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const res1 = await storage.write('Target.md', null, 'Initial content');

    // Hook storage to remove canonical Target.md between validation and move
    const origRead = storage.read.bind(storage);
    let deleted = false;
    storage.read = async (p: any) => {
      const snap = await origRead(p);
      if (!deleted && p === 'Target.md') {
        deleted = true;
        await storage.remove('Target.md');
      }
      return snap;
    };

    await expect(storage.write('Target.md', res1.snapshot.version, 'New content')).rejects.toThrow(
      ConflictError
    );

    // Target.md must remain deleted
    expect(await storage.exists('Target.md')).toBe(false);
  });

  it('4. same-size and same-mtime external replacement throws ConflictError (H10)', async () => {
    const rootHandle = new MockDirectoryHandle('vault');
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const res1 = await storage.write('SameStat.md', null, 'AAAABBBB');

    // Replace canonical content with CCCC DDDD
    const origRead = storage.read.bind(storage);
    let replaced = false;
    storage.read = async (p: any) => {
      const snap = await origRead(p);
      if (!replaced && p === 'SameStat.md') {
        replaced = true;
        const handle = await rootHandle.getFileHandle('SameStat.md');
        handle.content = new TextEncoder().encode('CCCCDDDD');
        handle.lastModified = res1.snapshot.version.modifiedAt ?? Date.now();
      }
      return snap;
    };

    await expect(storage.write('SameStat.md', res1.snapshot.version, 'EEEEFFFF')).rejects.toThrow(
      ConflictError
    );

    expect(await storage.readText('SameStat.md')).toBe('CCCCDDDD');
  });

  it('5. fail-closed recheck on unexpected error aborts write (H11)', async () => {
    const rootHandle = new MockDirectoryHandle('vault');
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const res1 = await storage.write('Safe.md', null, 'CANONICAL_SAFE');

    // Inject unexpected error into getFileHandle during recheck
    const origGetFile = rootHandle.getFileHandle.bind(rootHandle);
    let calls = 0;
    let injectError = true;
    rootHandle.getFileHandle = async (name: string, options?: any) => {
      if (name === 'Safe.md' && injectError) {
        calls++;
        if (calls > 1) {
          const err: any = new Error('Permission denied by OS');
          err.name = 'SecurityError';
          throw err;
        }
      }
      return origGetFile(name, options);
    };

    try {
      await expect(storage.write('Safe.md', res1.snapshot.version, 'OVERWRITE')).rejects.toThrow(
        StorageError
      );
    } finally {
      injectError = false;
    }

    expect(await storage.readText('Safe.md')).toBe('CANONICAL_SAFE');
  });

  it('6. R1 fallback: update throws StorageError when move() is unavailable and leaves external edit intact', async () => {
    const rootHandle = new MockDirectoryHandle('vault', false);
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    const initialHandle = await rootHandle.getFileHandle('Existing.md', { create: true });
    initialHandle.content = new TextEncoder().encode('EXTERNAL_DATA');

    await expect(
      storage.write('Existing.md', undefined, 'NEW_DATA')
    ).rejects.toThrow(StorageError);

    // External data MUST survive intact
    expect(await storage.readText('Existing.md')).toBe('EXTERNAL_DATA');
  });

  it('7. R1 fallback: delete scenario throws ConflictError when expected file is missing and does not recreate file', async () => {
    const rootHandle = new MockDirectoryHandle('vault', false);
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    await expect(
      storage.write('Deleted.md', { token: 'old', hash: 'old', modifiedAt: 1, size: 3 }, 'NEW_DATA')
    ).rejects.toThrow(ConflictError);

    expect(await storage.exists('Deleted.md')).toBe(false);
  });

  it('8. R1 fallback: create throws StorageError when move() is unavailable and leaves existing file intact', async () => {
    const rootHandle = new MockDirectoryHandle('vault', false);
    const storage = new BrowserFSAVaultStorage(rootHandle, 'test-vault');

    await expect(
      storage.write('NewFile.md', null, 'NEW_DATA')
    ).rejects.toThrow(StorageError);

    expect(await storage.exists('NewFile.md')).toBe(false);
  });
});
