import { describe, expect, it } from 'vitest';
import { ParsedDocument } from '@okw/core';
import { MemoryDocumentIndex } from '../memory-index.js';
import { SqliteDocumentIndex } from '../sqlite-index.js';
import {
  discoverVaultProperties,
  executeProtocolPropertyQuery,
  executePropertyQuery,
} from '../query-engine.js';

describe('Query Engine & Protocol Property Query (Phase 3D)', () => {
  const docs: ParsedDocument[] = [
    {
      id: 'doc1',
      path: 'Projects/Alpha.md',
      title: 'Project Alpha',
      sourceHash: 'h1',
      lineCount: 10,
      wordCount: 100,
      tags: ['active', 'proj'],
      properties: {
        status: 'in-progress',
        priority: 1,
        score: 95.5,
        completed: false,
        due: '2026-03-15',
        assignee: 'Alice',
        tags: ['active', 'proj'],
        metadata: { complex: true },
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Project Alpha',
    },
    {
      id: 'doc2',
      path: 'Projects/Beta.md',
      title: 'Project Beta',
      sourceHash: 'h2',
      lineCount: 20,
      wordCount: 200,
      tags: ['archived'],
      properties: {
        status: 'done',
        priority: 2,
        score: 80,
        completed: true,
        due: '2026-01-10',
        assignee: 'Bob',
        tags: ['archived'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Project Beta',
    },
    {
      id: 'doc3',
      path: 'Projects/Gamma.md',
      title: 'Project Gamma',
      sourceHash: 'h3',
      lineCount: 5,
      wordCount: 50,
      tags: ['active'],
      properties: {
        status: 'in-progress',
        priority: 10, // Notice 10 > 2 numerically, but '10' < '2' lexicographically!
        score: 42,
        completed: false,
        due: '2026-04-01',
        tags: ['active'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Project Gamma',
    },
    {
      id: 'doc4',
      path: 'Projects_Extra/Delta.md',
      title: 'Extra Delta',
      sourceHash: 'h4',
      lineCount: 12,
      wordCount: 120,
      tags: ['misc'],
      properties: {
        status: 'backlog',
        priority: 3,
        tags: ['misc'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Extra Delta',
    },
    {
      id: 'doc5',
      path: 'Notes/Meeting.md',
      title: 'Weekly Sync',
      sourceHash: 'h5',
      lineCount: 8,
      wordCount: 80,
      tags: ['meeting'],
      properties: {
        attendees: ['Alice', 'Bob', 'Charlie'],
        tags: ['meeting'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Weekly Sync',
    },
  ];

  async function populateIndex(index: MemoryDocumentIndex | SqliteDocumentIndex) {
    for (const d of docs) {
      await index.upsert(d);
    }
  }

  it('filters by folderScope with strict directory boundaries', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    // "Projects" or "Projects/" should match only Projects/Alpha.md, Beta.md, Gamma.md (NOT Projects_Extra/Delta.md)
    const res = await executeProtocolPropertyQuery(index, {
      folderScope: 'Projects',
    });

    expect(res.total).toBe(3);
    const paths = res.rows.map((r) => r.path);
    expect(paths).toContain('Projects/Alpha.md');
    expect(paths).toContain('Projects/Beta.md');
    expect(paths).toContain('Projects/Gamma.md');
    expect(paths).not.toContain('Projects_Extra/Delta.md');
  });

  it('performs numeric comparison correctly for priority and score', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    // Priority > 2 should match Gamma (priority: 10) and Delta (priority: 3), but NOT Beta (priority: 2) or Alpha (priority: 1)
    const res = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'priority', operator: 'greater_than', value: 2 }],
    });

    expect(res.total).toBe(2);
    const titles = res.rows.map((r) => r.title);
    expect(titles).toContain('Project Gamma');
    expect(titles).toContain('Extra Delta');
  });

  it('performs strict date comparisons', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const res = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'due', operator: 'greater_than', value: '2026-02-01' }],
    });

    expect(res.total).toBe(2);
    const titles = res.rows.map((r) => r.title);
    expect(titles).toContain('Project Alpha');
    expect(titles).toContain('Project Gamma');
  });

  it('performs boolean filters correctly', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const resCompleted = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'completed', operator: 'equals', value: true }],
    });

    expect(resCompleted.total).toBe(1);
    expect(resCompleted.rows[0].title).toBe('Project Beta');

    const resIncomplete = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'completed', operator: 'equals', value: false }],
    });

    expect(resIncomplete.total).toBe(2);
    const titles = resIncomplete.rows.map((r) => r.title);
    expect(titles).toContain('Project Alpha');
    expect(titles).toContain('Project Gamma');
  });

  it('performs array contains and equals filters', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const res = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'attendees', operator: 'contains', value: 'Bob' }],
    });

    expect(res.total).toBe(1);
    expect(res.rows[0].title).toBe('Weekly Sync');
  });

  it('handles is_empty and is_not_empty correctly', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const resEmpty = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'due', operator: 'is_empty' }],
    });

    // doc4 (Delta) and doc5 (Meeting) have no 'due' property
    expect(resEmpty.total).toBe(2);
    const titles = resEmpty.rows.map((r) => r.title);
    expect(titles).toContain('Extra Delta');
    expect(titles).toContain('Weekly Sync');

    const resNotEmpty = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'due', operator: 'is_not_empty' }],
    });

    expect(resNotEmpty.total).toBe(3);
  });

  it('handles complex nested objects without crashing or false matching', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    // doc1 has metadata: { complex: true }
    // Checking metadata contains '[object Object]' should NOT match
    const res = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'metadata', operator: 'contains', value: '[object Object]' }],
    });

    expect(res.total).toBe(0);
  });

  it('sorts deterministically with tie-breaking on path', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    // Alpha (priority: 1), Beta (priority: 2), Delta (priority: 3), Gamma (priority: 10)
    const res = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'priority', operator: 'is_not_empty' }],
      sorts: [{ field: 'priority', direction: 'asc' }],
    });

    expect(res.rows.map((r) => r.title)).toEqual([
      'Project Alpha',
      'Project Beta',
      'Extra Delta',
      'Project Gamma',
    ]);

    // Reverse sort
    const resDesc = await executeProtocolPropertyQuery(index, {
      filters: [{ field: 'priority', operator: 'is_not_empty' }],
      sorts: [{ field: 'priority', direction: 'desc' }],
    });

    expect(resDesc.rows.map((r) => r.title)).toEqual([
      'Project Gamma',
      'Extra Delta',
      'Project Beta',
      'Project Alpha',
    ]);
  });

  it('paginates results accurately with limit and offset', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const page1 = await executeProtocolPropertyQuery(index, {
      sorts: [{ field: 'title', direction: 'asc' }],
      limit: 2,
      offset: 0,
    });

    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0].title).toBe('Extra Delta');
    expect(page1.rows[1].title).toBe('Project Alpha');

    const page2 = await executeProtocolPropertyQuery(index, {
      sorts: [{ field: 'title', direction: 'asc' }],
      limit: 2,
      offset: 2,
    });

    expect(page2.total).toBe(5);
    expect(page2.rows).toHaveLength(2);
    expect(page2.rows[0].title).toBe('Project Beta');
    expect(page2.rows[1].title).toBe('Project Gamma');
  });

  it('discovers unique property names across vault notes', async () => {
    const index = new MemoryDocumentIndex();
    await populateIndex(index);

    const props = await discoverVaultProperties(index);
    expect(props).toContain('status');
    expect(props).toContain('priority');
    expect(props).toContain('score');
    expect(props).toContain('completed');
    expect(props).toContain('due');
    expect(props).toContain('assignee');
    expect(props).toContain('attendees');
    expect(props).toContain('metadata');
  });
});
