import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '@okw/core';
import { MemoryVaultStorage } from '../memory-storage.js';

describe('MemoryVaultStorage', () => {
  it('creates, reads, and lists files', () => {
    const vault = new MemoryVaultStorage();
    return (async () => {
      await vault.write('note1.md', null, '# Note 1\nContent 1');
      await vault.write('folder/note2.md', null, '# Note 2\nContent 2');

      const text = await vault.readText('note1.md');
      expect(text).toBe('# Note 1\nContent 1');

      const rootEntries = await vault.list('');
      expect(rootEntries).toHaveLength(2); // folder/ and note1.md
      expect(rootEntries.map((e) => e.name)).toEqual(['folder', 'note1.md']);

      const subEntries = await vault.list('folder');
      expect(subEntries).toHaveLength(1);
      expect(subEntries[0].name).toBe('note2.md');
    })();
  });

  it('prevents overwrite when expectedVersion is null and file exists (F-001 mitigation)', async () => {
    const vault = new MemoryVaultStorage();
    await vault.write('existing.md', null, 'Initial');

    // Attempting to create existing.md with expectedVersion = null should fail
    await expect(vault.write('existing.md', null, 'Second write')).rejects.toThrow(ConflictError);
  });

  it('detects concurrent/external modification when expectedVersion token does not match', async () => {
    const vault = new MemoryVaultStorage();
    const result1 = await vault.write('shared.md', null, 'Version A');

    // Simulate external edit
    await vault.write('shared.md', undefined, 'Version B (external)');

    // Attempting to save with stale version from result1 should throw ConflictError
    await expect(
      vault.write('shared.md', result1.snapshot.version, 'Version C (stale)')
    ).rejects.toThrow(ConflictError);
  });

  it('handles moves and renames correctly', async () => {
    const vault = new MemoryVaultStorage();
    await vault.write('old/path.md', null, 'Content');
    await vault.move('old/path.md', 'new/path.md');

    expect(await vault.exists('old/path.md')).toBe(false);
    expect(await vault.exists('new/path.md')).toBe(true);
    expect(await vault.readText('new/path.md')).toBe('Content');
  });

  it('moves nested directories without leaving ghost folders', async () => {
    const vault = new MemoryVaultStorage();
    await vault.createFolder('projects/archive/2026');
    await vault.write('projects/archive/2026/report.md', null, '# Report 2026');

    // Move 'projects/archive' to 'legacy/archive'
    await vault.move('projects/archive', 'legacy/archive');

    const listOld = await vault.list('projects');
    expect(listOld.map((e) => e.name)).not.toContain('archive');

    const listNew = await vault.list('legacy', true);
    expect(listNew.map((e) => e.path)).toEqual([
      'legacy/archive',
      'legacy/archive/2026',
      'legacy/archive/2026/report.md',
    ]);
  });

  it('throws NotFoundError for non-existent reads', async () => {
    const vault = new MemoryVaultStorage();
    await expect(vault.read('nonexistent.md')).rejects.toThrow(NotFoundError);
  });
});
