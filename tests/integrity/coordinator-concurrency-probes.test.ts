import { describe, expect, it } from 'vitest';
import {
  FileSnapshot,
  FileStat,
  FileVersion,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';
import { MemoryVaultStorage, NoteWriteCoordinator, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';

/**
 * SlowVaultStorage wraps MemoryVaultStorage to simulate slow I/O
 * to deterministically exercise asynchronous overlapping operations.
 */
class SlowVaultStorage implements VaultStorage {
  readonly name: string;
  readonly inner: MemoryVaultStorage;
  writeDelayMs: number;

  constructor(name: string = 'SlowVault', writeDelayMs: number = 100) {
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
      await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
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

  async stat(path: VaultPath): Promise<FileStat | null> {
    return this.inner.stat(path);
  }

  async createFolder(path: VaultPath): Promise<void> {
    return this.inner.createFolder(path);
  }

  async move(from: VaultPath, to: VaultPath, overwrite?: boolean): Promise<void> {
    return this.inner.move(from, to, overwrite);
  }
}

describe('Coordinator Concurrency Probes (F1, F2, F3 / Probes A, B, D, E via NoteWriteCoordinator)', () => {
  it('Probe A: Typing during slow save does not drop edit; re-arms save and reaches disk', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    // Initial note creation
    const initialSnap = await safeWriter.safeSave('NoteA.md', '# Note A - Version 1');
    coordinator.initNote('NoteA.md', initialSnap.snapshot, '# Note A - Version 1');

    // 1. Start slow save of Version 1
    coordinator.setBuffer('NoteA.md', '# Note A - Version 1 edited');
    const savePromise1 = coordinator.save('NoteA.md');

    // 2. User types Version 2 at t=20ms while save is in-flight
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('NoteA.md', '# Note A - Version 2 (Typed during save)');

    // 3. User triggers second save while in-flight
    const savePromise2 = coordinator.save('NoteA.md');

    // 4. Wait for both saves to complete
    const snap1 = await savePromise1;
    const snap2 = await savePromise2;

    expect(snap1).not.toBeNull();
    expect(snap2).not.toBeNull();

    const diskText = await storage.readText('NoteA.md');
    expect(diskText).toBe('# Note A - Version 2 (Typed during save)');
    const state = coordinator.getNoteState('NoteA.md');
    expect(state?.saveStatus).toBe('saved');
    expect(state?.bufferContent).toBe(diskText);
  });

  it('Probe B: Multi-note isolation during slow saves preserves independent state', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    // Seed Note A and Note B
    const snapA = await safeWriter.safeSave('Welcome.md', '# Welcome Note');
    const snapB = await safeWriter.safeSave('Characters/Kaelen.md', '# Kaelen Note');

    coordinator.initNote('Welcome.md', snapA.snapshot, '# Welcome Note');
    coordinator.initNote('Characters/Kaelen.md', snapB.snapshot, '# Kaelen Note');

    // 1. Edit and start slow save for Welcome.md
    coordinator.setBuffer('Welcome.md', '# Welcome Note - Edited A');
    const savePromiseA = coordinator.save('Welcome.md');

    // 2. Edit Characters/Kaelen.md concurrently
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('Characters/Kaelen.md', '# Kaelen Note - Typed concurrently B');
    const savePromiseB = coordinator.save('Characters/Kaelen.md');

    await Promise.all([savePromiseA, savePromiseB]);

    const diskA = await storage.readText('Welcome.md');
    const diskB = await storage.readText('Characters/Kaelen.md');

    expect(diskA).toBe('# Welcome Note - Edited A');
    expect(diskB).toBe('# Kaelen Note - Typed concurrently B');

    const stateA = coordinator.getNoteState('Welcome.md');
    const stateB = coordinator.getNoteState('Characters/Kaelen.md');

    expect(stateA?.saveStatus).toBe('saved');
    expect(stateB?.saveStatus).toBe('saved');
  });

  it('Probe C: Per-generation waiters resolve only when their requested generation is written', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const init = await safeWriter.safeSave('Doc.md', 'V0');
    coordinator.initNote('Doc.md', init.snapshot, 'V0');

    coordinator.setBuffer('Doc.md', 'V1');
    const waiterV1 = coordinator.save('Doc.md');

    // Mid-flight edit
    await new Promise((r) => setTimeout(r, 30));
    coordinator.setBuffer('Doc.md', 'V2');
    const waiterV2 = coordinator.save('Doc.md');

    const resV1 = await waiterV1;
    // When waiterV1 resolves, V1 was written first
    expect(resV1?.textContent).toBe('V1');

    const resV2 = await waiterV2;
    // When waiterV2 resolves, V2 was written second
    expect(resV2?.textContent).toBe('V2');

    const finalDisk = await storage.readText('Doc.md');
    expect(finalDisk).toBe('V2');
  });

  it('Probe D: Typing during property mutation preserves human text and surfaces conflict', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const parser = new DefaultDocumentParser();
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const snap = await safeWriter.safeSave(
      'NoteProps.md',
      '---\nstatus: draft\n---\n# Note Props\nInitial text.'
    );
    coordinator.initNote(
      'NoteProps.md',
      snap.snapshot,
      '---\nstatus: draft\n---\n# Note Props\nInitial text.'
    );

    const propPromise = coordinator.updateProperty('NoteProps.md', 'status', 'published', parser);

    // User types concurrently while property mutation is in flight
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer(
      'NoteProps.md',
      '---\nstatus: draft\n---\n# Note Props\nInitial text.\nHuman typed this important paragraph!'
    );

    await propPromise;
    await new Promise((r) => setTimeout(r, 150));

    const state = coordinator.getNoteState('NoteProps.md');
    const diskText = await storage.readText('NoteProps.md');
    expect(diskText).toContain('Human typed this important paragraph!');
    expect(diskText).toContain('status: published');
    expect(state?.bufferContent).toBe(diskText);
    expect(state?.saveStatus).toBe('saved');
  });

  it('Probe E: Typing during AI proposed edit application preserves human work and surfaces conflict', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const snap = await safeWriter.safeSave('AIProposal.md', '# Original AI Proposal Doc');
    coordinator.initNote('AIProposal.md', snap.snapshot, '# Original AI Proposal Doc');

    const aiPromise = coordinator.applyAI({
      path: 'AIProposal.md',
      originalContent: '# Original AI Proposal Doc',
      proposedContent: '# AI Enhanced Doc Title\n\nAI generated analysis.',
    });

    // Human edits while AI is applying
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer(
      'AIProposal.md',
      '# Original AI Proposal Doc\n\nHuman edits that should never be silently discarded.'
    );

    const result = await aiPromise;

    expect(result.success).toBe(false);
    const state = coordinator.getNoteState('AIProposal.md');
    expect(state?.bufferContent).toContain('Human edits that should never be silently discarded.');
    expect(state?.saveStatus).toBe('modified');
  });

  it('Probe F (H3): Discarding note reverts in-flight dirty save and restores clean baseline on disk', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const initSnap = await safeWriter.safeSave('DiscardTest.md', '# Clean Baseline');
    coordinator.initNote('DiscardTest.md', initSnap.snapshot, '# Clean Baseline');

    // User edits and triggers slow save
    coordinator.setBuffer('DiscardTest.md', '# Dirty Modification');
    const savePromise = coordinator.save('DiscardTest.md');

    // While save is in-flight, user discards note
    await new Promise((r) => setTimeout(r, 20));
    coordinator.removeNote('DiscardTest.md', true);

    const saveResult = await savePromise;
    expect(saveResult).toBeNull();

    // Verify disk was restored to baseline and does NOT contain dirty modification
    const finalDisk = await storage.readText('DiscardTest.md');
    expect(finalDisk).toBe('# Clean Baseline');
  });

  it('Probe G (H5): removeNote immediately drains and settles all queued waiters to prevent promise leaks', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const initSnap = await safeWriter.safeSave('DrainTest.md', '# Drain Test');
    coordinator.initNote('DrainTest.md', initSnap.snapshot, '# Drain Test');

    coordinator.setBuffer('DrainTest.md', 'V1');
    const w1 = coordinator.save('DrainTest.md');

    coordinator.setBuffer('DrainTest.md', 'V2');
    const w2 = coordinator.save('DrainTest.md');

    // Immediate removal while waiters are queued
    coordinator.removeNote('DrainTest.md', false);

    // Waiters should settle without hanging
    const [res1, res2] = await Promise.all([w1, w2]);
    expect(res1).toBeNull();
    expect(res2).toBeNull();
  });
});
