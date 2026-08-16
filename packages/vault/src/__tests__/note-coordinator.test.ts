import { describe, expect, it } from 'vitest';
import {
  FileSnapshot,
  FileVersion,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';
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

  it('C1: save(v2) queued behind in-flight save(v1) resolves with v2 snapshot and disk is v2 at resolution time', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    const initRes = await writer.safeSave('Truth.md', 'v0');
    coordinator.initNote('Truth.md', initRes.snapshot, 'v0');

    // Issue save(v1)
    coordinator.setBuffer('Truth.md', 'v1');
    const p1 = coordinator.save('Truth.md');

    // While save 1 is in-flight, issue save(v2)
    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('Truth.md', 'v2');
    const p2 = coordinator.save('Truth.md');

    let p2ResolvedSnapshot: FileSnapshot | null = null;
    let diskAtP2Resolution = '';

    const p2Promise = p2.then(async (snap) => {
      p2ResolvedSnapshot = snap;
      diskAtP2Resolution = await storage.readText('Truth.md');
    });

    const snap1 = await p1;
    expect(snap1?.textContent).toBe('v1');

    // At the moment p1 resolved, p2 must NOT have resolved yet!
    expect(p2ResolvedSnapshot).toBeNull();

    await p2Promise;

    // When p2 resolves, it must have snapshot for v2 AND disk must be v2
    expect(p2ResolvedSnapshot).not.toBeNull();
    expect(p2ResolvedSnapshot!.textContent).toBe('v2');
    expect(diskAtP2Resolution).toBe('v2');
  });

  it('C1 (3-generation sequential and overlapping chains): resolves waiters truthfully without stale snapshots', async () => {
    const storage = new SlowVaultStorage('test', 80);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    const initRes = await writer.safeSave('Chain.md', 'v0');
    coordinator.initNote('Chain.md', initRes.snapshot, 'v0');

    // 1. Overlapping save(v1) and save(v2)
    coordinator.setBuffer('Chain.md', 'v1');
    const p1 = coordinator.save('Chain.md');

    await new Promise((r) => setTimeout(r, 20));
    coordinator.setBuffer('Chain.md', 'v2');
    const p2 = coordinator.save('Chain.md');

    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1?.textContent).toBe('v1');
    expect(s2?.textContent).toBe('v2');
    expect(await storage.readText('Chain.md')).toBe('v2');

    // 2. Chained save(v3)
    coordinator.setBuffer('Chain.md', 'v3');
    const s3 = await coordinator.save('Chain.md');
    expect(s3?.textContent).toBe('v3');
    expect(await storage.readText('Chain.md')).toBe('v3');
  });

  it('C2: waitForIdle synchronizes rename so in-flight write does not recreate old path as ghost', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    const initRes = await writer.safeSave('Old.md', 'initial');
    coordinator.initNote('Old.md', initRes.snapshot, 'initial');

    // Trigger slow save of dirty edit
    coordinator.setBuffer('Old.md', 's9-dirty');
    const saveP = coordinator.save('Old.md');

    // Rename triggered mid-write
    await new Promise((r) => setTimeout(r, 20));

    // Wait for in-flight pump write to settle before renaming
    await coordinator.waitForIdle('Old.md');
    await saveP;

    // Move file on storage and update coordinator
    await storage.write('New.md', null, await storage.readText('Old.md'));
    await storage.remove('Old.md');
    coordinator.renameNote('Old.md', 'New.md');

    // Verify disk state
    expect(await storage.exists('Old.md')).toBe(false);
    expect(await storage.exists('New.md')).toBe(true);
    expect(await storage.readText('New.md')).toBe('s9-dirty');
  });

  it('C5: removeNote with discard drops subsequent queued pump writes and resolves pending waiters', async () => {
    const storage = new SlowVaultStorage('test', 100);
    const writer = new SafeWriter(storage);
    const coordinator = new NoteWriteCoordinator(storage, writer);

    const initRes = await writer.safeSave('Discard.md', 'clean-initial');
    coordinator.initNote('Discard.md', initRes.snapshot, 'clean-initial');

    // User types dirty edit and triggers save
    coordinator.setBuffer('Discard.md', 'dirty-to-discard');
    const saveP = coordinator.save('Discard.md');

    // User immediately closes tab and confirms discard
    coordinator.removeNote('Discard.md', true);

    const res = await saveP;
    expect(res).toBeNull();
  });
});
