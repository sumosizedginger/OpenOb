import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';

describe('Multi-Tab Isolation & Safe Buffer Management (C-01 & C-02 Regression)', () => {
  it('guarantees edits in Tab B never overwrite Tab A', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);

    // Create Note A and Note B
    const snapA = await writer.safeSave('NoteA.md', '# Note A Initial Content');
    const snapB = await writer.safeSave('NoteB.md', '# Note B Initial Content');

    // Simulate multi-tab buffer state
    let tabA_content = snapA.snapshot.textContent!;
    const tabA_version = snapA.snapshot.version;

    let tabB_content = snapB.snapshot.textContent!;
    const tabB_version = snapB.snapshot.version;

    // User switches to Tab B and types
    tabB_content = '# Note B Initial Content\n- User added line in Tab B';

    // User switches back to Tab A and types
    tabA_content = '# Note A Initial Content\n- User added line in Tab A';

    // User saves Tab B
    const savedB = await writer.safeSave('NoteB.md', tabB_content, {
      expectedVersion: tabB_version,
    });
    expect(savedB.snapshot.textContent).toContain('User added line in Tab B');

    // User saves Tab A
    const savedA = await writer.safeSave('NoteA.md', tabA_content, {
      expectedVersion: tabA_version,
    });
    expect(savedA.snapshot.textContent).toContain('User added line in Tab A');

    // Confirm neither note corrupted the other
    const readA = await storage.readText('NoteA.md');
    const readB = await storage.readText('NoteB.md');

    expect(readA).toBe('# Note A Initial Content\n- User added line in Tab A');
    expect(readB).toBe('# Note B Initial Content\n- User added line in Tab B');
    expect(readA).not.toContain('Tab B');
    expect(readB).not.toContain('Tab A');
  });
});
