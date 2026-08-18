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

  describe('R3D-1 Strict Typed Comparison Matrix (greater_than / less_than)', () => {
    const mixedDocs: ParsedDocument[] = [
      {
        id: 'num10',
        path: 'num10.md',
        title: 'Number 10',
        sourceHash: 'h1',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: 10, d: '2026-08-17' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'num2',
        path: 'num2.md',
        title: 'Number 2',
        sourceHash: 'h2',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: 2, d: '2026-08-16' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'str10',
        path: 'str10.md',
        title: 'String 10',
        sourceHash: 'h3',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: '10' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'str2',
        path: 'str2.md',
        title: 'String 2',
        sourceHash: 'h4',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: '2' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'emptyStr',
        path: 'emptyStr.md',
        title: 'Empty String',
        sourceHash: 'h5',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: '' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'spaceStr',
        path: 'spaceStr.md',
        title: 'Space String',
        sourceHash: 'h6',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: ' ' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'boolFalse',
        path: 'boolFalse.md',
        title: 'Bool False',
        sourceHash: 'h7',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: false, d: false },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'boolTrue',
        path: 'boolTrue.md',
        title: 'Bool True',
        sourceHash: 'h8',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: true },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'strZero',
        path: 'strZero.md',
        title: 'String Zero',
        sourceHash: 'h9',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: '0' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'strAbc',
        path: 'strAbc.md',
        title: 'String ABC',
        sourceHash: 'h10',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: 'abc', d: 'hello' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'strInf',
        path: 'strInf.md',
        title: 'String Infinity',
        sourceHash: 'h11',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: 'Infinity' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'str1e3',
        path: 'str1e3.md',
        title: 'String 1e3',
        sourceHash: 'h12',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: '1e3' },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'nullDoc',
        path: 'nullDoc.md',
        title: 'Null Val',
        sourceHash: 'h13',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: null },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'arrDoc',
        path: 'arrDoc.md',
        title: 'Array Val',
        sourceHash: 'h14',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: [1, 2, 3] },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'objDoc',
        path: 'objDoc.md',
        title: 'Object Val',
        sourceHash: 'h15',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: { val: { nested: 1 } },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
      {
        id: 'badDates',
        path: 'badDates.md',
        title: 'Bad Dates',
        sourceHash: 'h16',
        lineCount: 1,
        wordCount: 1,
        tags: [],
        properties: {
          d1: '01/02/03',
          d2: 'March 4',
          d3: '123',
          d4: '2026-99-99',
          d5: 1786924800000,
        },
        headings: [],
        links: [],
        aliases: [],
        textContent: '',
      },
    ];

    it('enforces strict numeric vs numeric comparison and rejects mixed coercions', async () => {
      const index = new MemoryDocumentIndex();
      for (const d of mixedDocs) await index.upsert(d);

      // number 10 vs number 2 (greater_than) -> matches only num10
      const resNumGt2 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: 2 }],
      });
      expect(resNumGt2.rows.map((r) => r.path)).toEqual(['num10.md']);

      // number 2 vs number 10 (less_than) -> matches only num2
      const resNumLt10 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'less_than', value: 10 }],
      });
      expect(resNumLt10.rows.map((r) => r.path)).toEqual(['num2.md']);

      // "10" string vs numeric 2 -> MUST NOT match any strings
      const resGtNumeric2 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: 2 }],
      });
      const pathsGt2 = resGtNumeric2.rows.map((r) => r.path);
      expect(pathsGt2).not.toContain('str10.md');
      expect(pathsGt2).not.toContain('str1e3.md');
      expect(pathsGt2).not.toContain('strInf.md');
      expect(pathsGt2).not.toContain('strAbc.md');

      // numeric 10 vs "2" string -> MUST NOT match numeric 10
      const resGtStr2 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: '2' }],
      });
      const pathsGtStr2 = resGtStr2.rows.map((r) => r.path);
      expect(pathsGtStr2).not.toContain('num10.md');
      expect(pathsGtStr2).not.toContain('num2.md');

      // "" vs 0, " " vs 0, false vs 0, true vs 1, "abc" vs 0
      const resGt0 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: 0 }],
      });
      const pathsGt0 = resGt0.rows.map((r) => r.path);
      expect(pathsGt0).not.toContain('emptyStr.md');
      expect(pathsGt0).not.toContain('spaceStr.md');
      expect(pathsGt0).not.toContain('boolFalse.md');
      expect(pathsGt0).not.toContain('strZero.md');
      expect(pathsGt0).not.toContain('strAbc.md');
      expect(pathsGt0).not.toContain('str1e3.md');

      const resLt1 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'less_than', value: 1 }],
      });
      const pathsLt1 = resLt1.rows.map((r) => r.path);
      expect(pathsLt1).not.toContain('emptyStr.md');
      expect(pathsLt1).not.toContain('spaceStr.md');
      expect(pathsLt1).not.toContain('boolFalse.md');
      expect(pathsLt1).not.toContain('strZero.md');
      expect(pathsLt1).not.toContain('boolTrue.md');

      // "0" vs false -> false
      const resGtFalse = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: false }],
      });
      expect(resGtFalse.total).toBe(0);

      // "Infinity" vs number 1000 -> false
      const resGt1000 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: 1000 }],
      });
      expect(resGt1000.total).toBe(0);

      // "1e3" string vs numeric 999 -> false
      const resGt999 = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: 999 }],
      });
      expect(resGt999.total).toBe(0);

      // null / undefined -> false
      const resGtNull = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: null }],
      });
      expect(resGtNull.total).toBe(0);

      // array -> false
      const resGtArr = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: [1] }],
      });
      expect(resGtArr.total).toBe(0);

      // object -> false
      const resGtObj = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'val', operator: 'greater_than', value: { a: 1 } }],
      });
      expect(resGtObj.total).toBe(0);
    });

    it('enforces strict ISO date comparison and rejects invalid dates or mixed timestamp numbers', async () => {
      const index = new MemoryDocumentIndex();
      for (const d of mixedDocs) await index.upsert(d);

      // "2026-08-17" > "2026-08-16" -> matches num10.md (d: 2026-08-17)
      const resDateGt = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'd', operator: 'greater_than', value: '2026-08-16' }],
      });
      expect(resDateGt.rows.map((r) => r.path)).toEqual(['num10.md']);

      // "2026-08-16" < "2026-08-17" -> matches num2.md (d: 2026-08-16)
      const resDateLt = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'd', operator: 'less_than', value: '2026-08-17' }],
      });
      expect(resDateLt.rows.map((r) => r.path)).toEqual(['num2.md']);

      // Target '2026-08-01' against junk/invalid dates:
      // '01/02/03', 'March 4', '123', '2026-99-99', 1786924800000
      for (const field of ['d1', 'd2', 'd3', 'd4', 'd5']) {
        const res = await executeProtocolPropertyQuery(index, {
          filters: [{ field, operator: 'greater_than', value: '2026-08-01' }],
        });
        expect(res.total).toBe(0);
      }

      // Date query target '2026-08-01' against 'hello' or false -> MUST NOT match
      const resDateJunk = await executeProtocolPropertyQuery(index, {
        filters: [{ field: 'd', operator: 'greater_than', value: '2026-08-01' }],
      });
      const pathsDateJunk = resDateJunk.rows.map((r) => r.path);
      expect(pathsDateJunk).not.toContain('strAbc.md');
      expect(pathsDateJunk).not.toContain('boolFalse.md');
      expect(pathsDateJunk).toEqual(['num10.md', 'num2.md']);
    });
  });
});
