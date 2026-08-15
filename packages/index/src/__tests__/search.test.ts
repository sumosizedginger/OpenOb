import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex } from '../memory-index.js';

describe('Search Engine', () => {
  it('ranks navigation, title, heading, tag, and full-text matches correctly', async () => {
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const doc1 = await parser.parse(
      'daily/2026-08-15.md',
      '# Daily Log 2026-08-15\nReviewed quantum computing roadmap and #project/okw tasks.'
    );
    const doc2 = await parser.parse(
      'projects/okw.md',
      '---\ntags: [project/okw, architecture]\naliases: [Open Knowledge Workspace]\n---\n# OKW Architecture\nCore design and safe save specifications.'
    );
    const doc3 = await parser.parse(
      'recipes/pizza.md',
      '# Sourdough Pizza\nBaking instructions.'
    );

    await index.upsert(doc1);
    await index.upsert(doc2);
    await index.upsert(doc3);

    // Search by title/alias
    const res1 = await index.query({ query: 'OKW Architecture' });
    expect(res1[0].documentId).toBe('projects/okw.md');
    expect(res1[0].score).toBeGreaterThan(50);

    // Search by tag
    const res2 = await index.query({ query: 'project/okw' });
    expect(res2.map((r) => r.documentId)).toContain('projects/okw.md');
    expect(res2.map((r) => r.documentId)).toContain('daily/2026-08-15.md');

    // Search with scope filter
    const res3 = await index.query({
      query: 'Daily',
      scope: { folders: ['recipes'] },
    });
    expect(res3).toHaveLength(0); // Scoped out
  });
});
