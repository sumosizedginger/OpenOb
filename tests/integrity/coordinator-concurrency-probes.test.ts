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

  it('Probe F (H12): Discarding note after prior durable saves restores last durably saved state (B), not initial state (A)', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    // Initial state A
    const initSnap = await safeWriter.safeSave('DiscardTest.md', 'A-initial');
    coordinator.initNote('DiscardTest.md', initSnap.snapshot, 'A-initial');

    // Save B durably
    coordinator.setBuffer('DiscardTest.md', 'B-saved');
    const saveB = await coordinator.save('DiscardTest.md');
    expect(saveB?.textContent).toBe('B-saved');
    expect(await storage.readText('DiscardTest.md')).toBe('B-saved');

    // Dirty edit C and trigger slow save
    coordinator.setBuffer('DiscardTest.md', 'C-dirty');
    const saveC = coordinator.save('DiscardTest.md');

    // While save is in-flight, user discards note
    await new Promise((r) => setTimeout(r, 20));
    coordinator.removeNote('DiscardTest.md', true);

    const saveCResult = await saveC;
    expect(saveCResult).toBeNull();

    // Allow restore pump to complete
    await new Promise((r) => setTimeout(r, 250));

    // Verify disk was restored to B-saved (last durable save), NOT A-initial
    const finalDisk = await storage.readText('DiscardTest.md');
    expect(finalDisk).toBe('B-saved');
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

  it('Probe H (H13): Discard + immediate reopen race: old discarded pump does not conflict with or overwrite reopened session D', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    // A-initial
    const initSnap = await safeWriter.safeSave('ReopenRace.md', 'A-initial');
    coordinator.initNote('ReopenRace.md', initSnap.snapshot, 'A-initial');

    // User starts slow save of C-dirty
    coordinator.setBuffer('ReopenRace.md', 'C-dirty');
    const dirtySavePromise = coordinator.save('ReopenRace.md');

    // Mid-write: user discards note
    await new Promise((r) => setTimeout(r, 20));
    coordinator.removeNote('ReopenRace.md', true);

    const dirtyRes = await dirtySavePromise;
    expect(dirtyRes).toBeNull();

    // Wait for in-flight coordinator pump & restoration to settle before reopening
    await coordinator.waitForIdle('ReopenRace.md');

    // Immediately reopen same path with fresh snapshot
    const reopenSnap = await storage.read('ReopenRace.md');
    coordinator.initNote('ReopenRace.md', reopenSnap, 'D-reopened');
    coordinator.setBuffer('ReopenRace.md', 'D-reopened');
    const reopenRes = await coordinator.save('ReopenRace.md');

    expect(reopenRes?.textContent).toBe('D-reopened');

    // Allow any background pumps to settle
    await new Promise((r) => setTimeout(r, 250));

    // Final disk must be D-reopened
    const finalDisk = await storage.readText('ReopenRace.md');
    expect(finalDisk).toBe('D-reopened');
  });

  it('Probe I (H14): External write X during discard restoration is preserved and not overwritten', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, safeWriter);

    const initSnap = await safeWriter.safeSave('ExtWrite.md', 'A-initial');
    coordinator.initNote('ExtWrite.md', initSnap.snapshot, 'A-initial');

    // Start slow save of dirty C
    coordinator.setBuffer('ExtWrite.md', 'C-dirty');
    const dirtySave = coordinator.save('ExtWrite.md');

    await new Promise((r) => setTimeout(r, 20));
    coordinator.removeNote('ExtWrite.md', true);

    // Wait for C-dirty to finish writing to disk
    await dirtySave;

    // External process writes X before baseline restoration can write A
    await storage.write('ExtWrite.md', undefined, 'X-external-write');

    // Allow coordinator discard restoration pump to attempt restore
    await new Promise((r) => setTimeout(r, 250));

    // X-external-write must survive and NOT be overwritten by force:true
    const finalDisk = await storage.readText('ExtWrite.md');
    expect(finalDisk).toBe('X-external-write');
  });
});
