import { describe, expect, it } from 'vitest';
import { ConflictError } from '@okw/core';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';

describe('Data Integrity & Concurrency Race (F-001 Mitigation)', () => {
  it('prevents interleaved write races between multiple clients', async () => {
    const storage = new MemoryVaultStorage();
    const clientA = new SafeWriter(storage);
    const clientB = new SafeWriter(storage);

    // Initial state
    const base = await clientA.safeSave('shared/meeting-notes.md', '# Initial Meeting Notes');

    // Client A and Client B both open the document with version `base.snapshot.version`
    const versionAtOpen = base.snapshot.version;

    // Client A makes an edit and saves first
    const saveA = await clientA.safeSave(
      'shared/meeting-notes.md',
      '# Initial Meeting Notes\n- Client A added action item 1',
      { expectedVersion: versionAtOpen }
    );
    expect(saveA.wasCreated).toBe(false);

    // Client B attempts to save its edit using the now-stale `versionAtOpen`
    await expect(
      clientB.safeSave(
        'shared/meeting-notes.md',
        '# Initial Meeting Notes\n- Client B added action item 2',
        { expectedVersion: versionAtOpen }
      )
    ).rejects.toThrow(ConflictError);

    // Verify storage has Client A's edit intact, not lost or corrupted
    const currentText = await storage.readText('shared/meeting-notes.md');
    expect(currentText).toBe('# Initial Meeting Notes\n- Client A added action item 1');

    // Client B can now inspect current version, merge or re-save with new expectedVersion
    const updated = await storage.read('shared/meeting-notes.md');
    const saveBResolved = await clientB.safeSave(
      'shared/meeting-notes.md',
      '# Initial Meeting Notes\n- Client A added action item 1\n- Client B added action item 2',
      { expectedVersion: updated.version }
    );
    expect(saveBResolved.snapshot.textContent).toContain('Client A added action item 1');
    expect(saveBResolved.snapshot.textContent).toContain('Client B added action item 2');
  });

  it('handles rapid sequential autosaves safely', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);

    let current = await writer.safeSave('rapid.md', 'Line 0');

    for (let i = 1; i <= 20; i++) {
      current = await writer.safeSave('rapid.md', `Line ${i}`, {
        expectedVersion: current.snapshot.version,
      });
      expect(current.snapshot.textContent).toBe(`Line ${i}`);
    }

    const finalRead = await storage.readText('rapid.md');
    expect(finalRead).toBe('Line 20');
  });
});
