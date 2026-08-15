import { describe, expect, it } from 'vitest';
import { MemoryDocumentIndex } from '@okw/index';
import { SqliteDocumentIndex } from '@okw/index';
import { ParsedDocument } from '@okw/core';

describe('SQLite vs Memory DocumentIndex Parity Test (P3-1..P3-6)', () => {
  const doc1: ParsedDocument = {
    id: 'Notes/Physics.md',
    path: 'Notes/Physics.md',
    title: 'Physics & Relativity',
    sourceHash: 'hash-physics',
    lineCount: 10,
    wordCount: 50,
    properties: { author: 'Einstein', tags: ['science', 'physics'] },
    aliases: ['Modern Physics', 'Relativity Theory'],
    tags: ['science', 'physics'],
    headings: [
      { level: 1, text: 'Physics Overview', slug: 'physics-overview', line: 1 },
      { level: 2, text: 'Quantum States', slug: 'quantum-states', line: 5 },
    ],
    links: [
      { raw: '[[Math#Calculus|Advanced Calculus]]', target: 'Math', displayText: 'Advanced Calculus', subpath: '#Calculus', line: 3, isEmbed: false },
      { raw: '[[Notes/Physics#Quantum States]]', target: 'Notes/Physics', subpath: '#Quantum States', line: 6, isEmbed: false }, // Self-link
    ],
    textContent: `# Physics Overview
See [[Math#Calculus|Advanced Calculus]] for prerequisites.
## Quantum States
Self-referencing [[Notes/Physics#Quantum States]] here.`,
  };

  const doc2: ParsedDocument = {
    id: 'Notes/Math.md',
    path: 'Notes/Math.md',
    title: 'Mathematics',
    sourceHash: 'hash-math',
    lineCount: 8,
    wordCount: 40,
    properties: { tags: ['stem', 'math'] },
    aliases: ['Math'],
    tags: ['stem', 'math'],
    headings: [
      { level: 1, text: 'Mathematics Core', slug: 'mathematics-core', line: 1 },
      { level: 2, text: 'Calculus', slug: 'calculus', line: 4 },
    ],
    links: [
      { raw: '[[Modern Physics]]', target: 'Modern Physics', line: 2, isEmbed: false },
    ],
    textContent: `# Mathematics Core
Applied in [[Modern Physics]].
## Calculus
Differential equations.`,
  };

  it('proves 100% parity of document retrieval, links, subpaths, and backlinks', async () => {
    const memory = new MemoryDocumentIndex();
    const sqlite = await SqliteDocumentIndex.create();

    await memory.upsert(doc1);
    await memory.upsert(doc2);

    await sqlite.upsert(doc1);
    await sqlite.upsert(doc2);

    // 1. Compare get()
    const memDoc1 = await memory.get('Notes/Physics.md');
    const sqlDoc1 = await sqlite.get('Notes/Physics.md');
    expect(sqlDoc1).toEqual(memDoc1);

    // Verify subpath and raw preservation (P3-1)
    expect(sqlDoc1!.links[0].subpath).toBe('#Calculus');
    expect(sqlDoc1!.links[0].displayText).toBe('Advanced Calculus');
    expect(sqlDoc1!.links[0].raw).toBe('[[Math#Calculus|Advanced Calculus]]');

    // 2. Compare getAll()
    const memAll = await memory.getAll();
    const sqlAll = await sqlite.getAll();
    expect(sqlAll).toEqual(memAll);

    // 3. Compare getBacklinks() (P3-3, P3-4: self links excluded, raw link preserved)
    const memBacklinks = await memory.getBacklinks('Notes/Physics.md');
    const sqlBacklinks = await sqlite.getBacklinks('Notes/Physics.md');

    expect(sqlBacklinks).toHaveLength(1);
    expect(sqlBacklinks[0].sourcePath).toBe('Notes/Math.md');
    expect(sqlBacklinks[0].rawLink).toBe('[[Modern Physics]]');
    expect(sqlBacklinks).toEqual(memBacklinks);

    // 4. Compare search query scoring and sources (P3-2)
    const memQuery1 = await memory.query({ query: 'quantum' });
    const sqlQuery1 = await sqlite.query({ query: 'quantum' });
    expect(sqlQuery1).toEqual(memQuery1);

    const memQuery2 = await memory.query({ query: 'physics' });
    const sqlQuery2 = await sqlite.query({ query: 'physics' });
    expect(sqlQuery2).toEqual(memQuery2);

    const memQuery3 = await memory.query({ query: 'prerequisites' });
    const sqlQuery3 = await sqlite.query({ query: 'prerequisites' });
    expect(sqlQuery3).toEqual(memQuery3);

    sqlite.close();
  });
});
