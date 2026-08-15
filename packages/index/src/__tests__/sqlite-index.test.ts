import { describe, expect, it } from 'vitest';
import { SqliteDocumentIndex } from '../sqlite-index.js';
import { ParsedDocument } from '@okw/core';

describe('SqliteDocumentIndex & Relational Schema (Phase 3)', () => {
  const sampleDocA: ParsedDocument = {
    id: 'doc-a',
    path: 'Notes/Physics.md',
    title: 'Physics',
    sourceHash: 'hash-a-12345',
    lineCount: 3,
    wordCount: 30,
    properties: { tags: ['science', 'stem'], author: 'Einstein' },
    aliases: ['Modern Physics'],
    tags: ['science', 'stem'],
    headings: [
      { level: 1, text: 'Physics Overview', slug: 'physics-overview', line: 1 },
      { level: 2, text: 'Quantum Mechanics', slug: 'quantum-mechanics', line: 5 },
    ],
    links: [
      { raw: '[[Math]]', target: 'Math', line: 3, isEmbed: false },
    ],
    textContent: '# Physics Overview\nRefer to [[Math]] for prerequisites.\n## Quantum Mechanics',
  };

  const sampleDocB: ParsedDocument = {
    id: 'doc-b',
    path: 'Notes/Math.md',
    title: 'Math',
    sourceHash: 'hash-b-67890',
    lineCount: 2,
    wordCount: 20,
    properties: {},
    aliases: ['Mathematics'],
    tags: ['math', 'stem'],
    headings: [{ level: 1, text: 'Math Overview', slug: 'math-overview', line: 1 }],
    links: [
      { raw: '[[Physics]]', target: 'Physics', line: 2, isEmbed: false },
    ],
    textContent: '# Math Overview\nUsed extensively in [[Physics]].',
  };

  it('upserts and retrieves documents with full relational hydration', async () => {
    const index = await SqliteDocumentIndex.create();
    await index.upsert(sampleDocA);
    await index.upsert(sampleDocB);

    const docA = await index.get('doc-a');
    expect(docA).not.toBeNull();
    expect(docA!.title).toBe('Physics');
    expect(docA!.tags).toEqual(['science', 'stem']);
    expect(docA!.headings).toHaveLength(2);
    expect(docA!.properties.author).toBe('Einstein');
    expect(docA!.aliases).toEqual(['Modern Physics']);
    expect(docA!.links).toHaveLength(1);

    const all = await index.getAll();
    expect(all).toHaveLength(2);

    index.close();
  });

  it('correctly calculates backlinks across SQLite relational tables', async () => {
    const index = await SqliteDocumentIndex.create();
    await index.upsert(sampleDocA);
    await index.upsert(sampleDocB);

    const backlinksToPhysics = await index.getBacklinks('Notes/Physics.md');
    expect(backlinksToPhysics).toHaveLength(1);
    expect(backlinksToPhysics[0].sourcePath).toBe('Notes/Math.md');
    expect(backlinksToPhysics[0].sourceTitle).toBe('Math');

    const backlinksToMath = await index.getBacklinks('Notes/Math.md');
    expect(backlinksToMath).toHaveLength(1);
    expect(backlinksToMath[0].sourcePath).toBe('Notes/Physics.md');

    index.close();
  });

  it('executes search queries with tag filters and excerpts', async () => {
    const index = await SqliteDocumentIndex.create();
    await index.upsert(sampleDocA);
    await index.upsert(sampleDocB);

    const results = await index.query({ query: 'quantum' });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('Notes/Physics.md');
    expect(results[0].excerpt).toContain('Quantum Mechanics');

    const tagQueryResults = await index.query({ query: 'stem', scope: { tags: ['science'] } });
    expect(tagQueryResults).toHaveLength(1);
    expect(tagQueryResults[0].title).toBe('Physics');

    index.close();
  });

  it('handles document removal cleanly with cascading table deletions', async () => {
    const index = await SqliteDocumentIndex.create();
    await index.upsert(sampleDocA);
    await index.upsert(sampleDocB);

    await index.remove('doc-a');
    expect(await index.get('doc-a')).toBeNull();

    // Backlink from doc-a to Math should now be gone
    const backlinksToMath = await index.getBacklinks('Notes/Math.md');
    expect(backlinksToMath).toHaveLength(0);

    index.close();
  });
});
