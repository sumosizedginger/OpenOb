import { describe, expect, it } from 'vitest';
import { ConflictError } from '@okw/core';
import { MemoryVaultStorage } from '../memory-storage.js';
import { SafeWriter } from '../safe-writer.js';

describe('SafeWriter', () => {
  it('performs safe atomic saves with hash verification', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);

    const res1 = await writer.safeSave('doc.md', 'Hello World');
    expect(res1.wasCreated).toBe(true);
    expect(res1.snapshot.textContent).toBe('Hello World');

    const res2 = await writer.safeSave('doc.md', 'Hello World 2', {
      expectedVersion: res1.snapshot.version,
    });
    expect(res2.wasCreated).toBe(false);
    expect(res2.snapshot.textContent).toBe('Hello World 2');
  });

  it('rejects stale autosave when file was modified externally (F-001 mitigation)', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);

    // Initial load
    const initial = await writer.safeSave('doc.md', 'Initial Content');

    // External change happens on disk/storage
    await storage.write('doc.md', undefined, 'External update from another editor');

    // App attempts debounced autosave with stale initial version
    await expect(
      writer.safeSave('doc.md', 'Stale App Edit', {
        expectedVersion: initial.snapshot.version,
      })
    ).rejects.toThrow(ConflictError);

    // Ensure external content was NOT corrupted
    const currentOnDisk = await storage.readText('doc.md');
    expect(currentOnDisk).toBe('External update from another editor');
  });

  it('allows forced overwrite only when explicit flag is passed', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);

    const initial = await writer.safeSave('doc.md', 'Initial');
    await storage.write('doc.md', undefined, 'External change');

    // Force overwrite
    const forced = await writer.safeSave('doc.md', 'Forced Overwrite Content', {
      force: true,
    });
    expect(forced.snapshot.textContent).toBe('Forced Overwrite Content');
    expect(await storage.readText('doc.md')).toBe('Forced Overwrite Content');
  });
});
