import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';

describe('Unicode & Special Characters Torture Test', () => {
  it('handles spaces, emojis, CJK characters, and deep nesting', async () => {
    const storage = new MemoryVaultStorage();
    const writer = new SafeWriter(storage);
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // Notes with Unicode paths, titles, and wikilinks
    await writer.safeSave(
      '📚 Library/哲学/Existentialism 🧠.md',
      '# 存在主义 🧠\nLink to [[量子力学/Quantum Notes]] and [[Résumé & CV]].'
    );
    await writer.safeSave(
      '量子力学/Quantum Notes.md',
      '# Quantum Notes\nLink to [[📚 Library/哲学/Existentialism 🧠|Philosophy]].'
    );
    await writer.safeSave(
      'Personal/Résumé & CV.md',
      '# My Résumé\nBack to [[📚 Library/哲学/Existentialism 🧠]].'
    );

    // Index all
    await rebuildVaultIndex(storage, index, parser);

    const allDocs = await index.getAll();
    expect(allDocs).toHaveLength(3);

    // Verify backlink discovery with emojis and CJK
    const backlinks = await index.getBacklinks('📚 Library/哲学/Existentialism 🧠.md');
    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((b) => b.sourcePath).sort()).toEqual([
      'Personal/Résumé & CV.md',
      '量子力学/Quantum Notes.md',
    ]);

    // Search query with Unicode
    const cjkResults = await index.query({ query: '存在主义' });
    expect(cjkResults).toHaveLength(1);
    expect(cjkResults[0].path).toBe('📚 Library/哲学/Existentialism 🧠.md');
  });
});
