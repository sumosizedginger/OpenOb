import { describe, expect, it } from 'vitest';
import { FileSnapshot, FileVersion, VaultEntry, VaultPath, VaultStorage, WriteResult } from '@okw/core';
import { MemoryVaultStorage } from '../memory-storage.js';
import { SafeWriter } from '../safe-writer.js';
import { NoteWriteCoordinator } from '../note-coordinator.js';
import { DefaultDocumentParser } from '@okw/markdown';

class SlowVaultStorage implements VaultStorage {
  readonly name: string;
  readonly inner: MemoryVaultStorage;
  writeDelayMs: number;

  constructor(name = 'SlowVault', writeDelayMs = 100) {
    this.name = name;
    this.inner = new MemoryVaultStorage(name);
    this.writeDelayMs = writeDelayMs;
  }

  async read(path: VaultPath): Promise<FileSnapshot> {
    return this.inner.read(path);
  }

  async readText(path: VaultPath): Promise<string> {
    return this.inner.readText(path);
  }

  async write(
    path: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult> {
    if (this.writeDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.writeDelayMs));
    }
    return this.inner.write(path, expectedVersion, content);
  }

  async remove(path: VaultPath): Promise<void> {
    return this.inner.remove(path);
  }

  async list(prefix?: string, recursive?: boolean): Promise<VaultEntry[]> {
    return this.inner.list(prefix, recursive);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  async stat(path: VaultPath) {
    return this.inner.stat(path);
  }

  async createFolder(path: VaultPath): Promise<void> {
    return this.inner.createFolder(path);
  }

  async move(from: VaultPath, to: VaultPath, overwrite?: boolean): Promise<void> {
    return this.inner.move(from, to, overwrite);
  }
}

describe('NoteWriteCoordinator (G1 & G2 Architectural Unit Tests)', () => {
  it('A2/A3: Serializes overlapping writes and chains authoritative version without false conflict', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    // Initial note creation
    const initRes = await writer.safeSave('NoteA.md', 'Version 0');
    coordinator.initNote('NoteA.md', initRes.snapshot, 'Version 0');

    // 1. User types Version 1 and triggers save
    coordinator.setBuffer('NoteA.md', 'Version 1');
    const savePromise = coordinator.save('NoteA.md');

    // 2. While save 1 is in-flight (100ms), user types Version 2 at t=20ms and triggers save again
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('NoteA.md', 'Version 2');
    const savePromise2 = coordinator.save('NoteA.md');

    // 3. User types Version 3 at t=40ms
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('NoteA.md', 'Version 3');
    const savePromise3 = coordinator.save('NoteA.md');

    // Await all saves
    await Promise.all([savePromise, savePromise2, savePromise3]);
    await new Promise((r) => setTimeout(r, 150));

    // Assert final invariant:
    const state = coordinator.getNoteState('NoteA.md')!;
    const diskText = await storage.readText('NoteA.md');

    expect(diskText).toBe('Version 3');
    expect(state.bufferContent).toBe('Version 3');
    expect(state.saveStatus).toBe('saved');
    expect(state.conflictData).toBeNull();
  });

  it('D: Property mutation while user is typing rebases frontmatter onto latest human buffer', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);
    const parser = new DefaultDocumentParser();

    const initRes = await writer.safeSave(
      'Props.md',
      '---\nstatus: draft\n---\n# Props Note\nInitial text.'
    );
    coordinator.initNote('Props.md', initRes.snapshot, initRes.snapshot.textContent!);

    // Start slow property mutation
    const propPromise = coordinator.updateProperty('Props.md', 'status', 'published', parser);

    // Human types into buffer while save is in-flight
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer(
      'Props.md',
      '---\nstatus: draft\n---\n# Props Note\nInitial text.\nHuman added paragraph.'
    );

    await propPromise;
    await new Promise((r) => setTimeout(r, 150));

    const state = coordinator.getNoteState('Props.md')!;
    const diskText = await storage.readText('Props.md');

    // Both the property change AND the human typed text must be in buffer and disk
    expect(diskText).toContain('status: published');
    expect(diskText).toContain('Human added paragraph.');
    expect(state.bufferContent).toBe(diskText);
    expect(state.saveStatus).toBe('saved');
  });

  it('E: AI proposed edit while user is typing preserves human text and surfaces conflict', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    const initRes = await writer.safeSave('AI.md', '# AI Original Content');
    coordinator.initNote('AI.md', initRes.snapshot, '# AI Original Content');

    // Start slow AI edit
    const aiPromise = coordinator.applyAI({
      path: 'AI.md',
      originalContent: '# AI Original Content',
      proposedContent: '# AI Generated Replacement',
    });

    // Human types while AI edit is in-flight
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('AI.md', '# AI Original Content\nHuman typing during AI apply.');

    const result = await aiPromise;

    const state = coordinator.getNoteState('AI.md')!;
    expect(result.success).toBe(false);
    expect(state.bufferContent).toContain('Human typing during AI apply.');
    expect(state.saveStatus).toBe('modified');
    expect(state.conflictData).not.toBeNull();
    expect(state.conflictData!.diskContent).toContain('# AI Generated Replacement');
  });
});
