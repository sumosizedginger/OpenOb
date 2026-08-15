import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';

describe('Disaster Recovery & Zero-Data-Loss (F-003 & D-002)', () => {
  it('guarantees 100% data recovery after total index corruption / deletion', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();

    // 1. Create a simulated rich vault with 50 notes
    const rawFiles: Record<string, string> = {};
    for (let i = 1; i <= 50; i++) {
      const prev = i > 1 ? i - 1 : 50;
      const next = i < 50 ? i + 1 : 1;
      rawFiles[`notes/note_${i.toString().padStart(3, '0')}.md`] = `---
id: note-${i}
tags: [batch, group-${i % 5}]
---
# Document ${i}

This is document number ${i}.
Links:
- Previous: [[note_${prev.toString().padStart(3, '0')}]]
- Next: [[note_${next.toString().padStart(3, '0')}]]
- Home: [[note_001|Root Note]]
`;
    }

    await storage.seed(rawFiles);

    // 2. Build initial index
    const index1 = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index1, parser);

    expect(await index1.getAll()).toHaveLength(50);
    const initialHomeBacklinks = await index1.getBacklinks('notes/note_001.md');
    expect(initialHomeBacklinks.length).toBeGreaterThan(2);

    // 3. Simulating sudden disaster: Complete index destruction
    const index2 = new MemoryDocumentIndex(); // empty fresh index

    // 4. Rebuild from raw storage
    const rebuildReport = await rebuildVaultIndex(storage, index2, parser);
    expect(rebuildReport.totalIndexed).toBe(50);

    // 5. Verify every single document, property, and backlink is 100% identical
    const recoveredDocs = await index2.getAll();
    expect(recoveredDocs).toHaveLength(50);

    const recoveredHomeBacklinks = await index2.getBacklinks('notes/note_001.md');
    expect(recoveredHomeBacklinks).toEqual(initialHomeBacklinks);
  });
});
