import { describe, expect, it } from 'vitest';
import { MemoryDocumentIndex, SqliteDocumentIndex, executeProtocolPropertyQuery } from '@okw/index';
import { ParsedDocument, PropertyQuery } from '@okw/core';

describe('SQLite vs Memory Query Differential Suite (Phase 3D)', () => {
  const dataset: ParsedDocument[] = [
    {
      id: 'doc1',
      path: 'Tasks/Urgent.md',
      title: 'Urgent Task',
      sourceHash: 'h1',
      lineCount: 15,
      wordCount: 150,
      tags: ['task', 'urgent'],
      properties: {
        priority: 1,
        status: 'open',
        done: false,
        dueDate: '2026-03-01',
        score: 99.4,
        assignees: ['Alice', 'Bob'],
        tags: ['task', 'urgent'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Urgent Task',
    },
    {
      id: 'doc2',
      path: 'Tasks/Backlog.md',
      title: 'Backlog Item',
      sourceHash: 'h2',
      lineCount: 5,
      wordCount: 50,
      tags: ['task'],
      properties: {
        priority: 5,
        status: 'backlog',
        done: false,
        dueDate: '2026-06-15',
        score: 45.0,
        assignees: ['Charlie'],
        tags: ['task'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Backlog Item',
    },
    {
      id: 'doc3',
      path: 'Tasks/Completed.md',
      title: 'Completed Task',
      sourceHash: 'h3',
      lineCount: 25,
      wordCount: 250,
      tags: ['task', 'done'],
      properties: {
        priority: 2,
        status: 'done',
        done: true,
        dueDate: '2026-01-20',
        score: 88.0,
        assignees: ['Alice'],
        tags: ['task', 'done'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Completed Task',
    },
    {
      id: 'doc4',
      path: 'Notes/Ideas.md',
      title: 'Product Ideas',
      sourceHash: 'h4',
      lineCount: 30,
      wordCount: 300,
      tags: ['ideas'],
      properties: {
        status: 'open',
        tags: ['ideas'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Product Ideas',
    },
    {
      id: 'doc5',
      path: 'Tasks_Archived/Old.md',
      title: 'Archived Task',
      sourceHash: 'h5',
      lineCount: 10,
      wordCount: 100,
      tags: ['archived'],
      properties: {
        priority: 10,
        status: 'archived',
        done: true,
        tags: ['archived'],
      },
      headings: [],
      links: [],
      aliases: [],
      textContent: '# Archived Task',
    },
  ];

  async function createIndices() {
    const memory = new MemoryDocumentIndex();
    const sqlite = await SqliteDocumentIndex.create();

    for (const doc of dataset) {
      await memory.upsert(doc);
      await sqlite.upsert(doc);
    }

    return { memory, sqlite };
  }

  const queriesToTest: Array<{ name: string; query: PropertyQuery }> = [
    {
      name: 'Folder Scoping (Tasks/ only)',
      query: { folderScope: 'Tasks' },
    },
    {
      name: 'Numeric Filter (priority < 5)',
      query: {
        filters: [{ field: 'priority', operator: 'less_than', value: 5 }],
      },
    },
    {
      name: 'Boolean Filter (done == true)',
      query: {
        filters: [{ field: 'done', operator: 'equals', value: true }],
      },
    },
    {
      name: 'Date Filter (dueDate >= 2026-02-01)',
      query: {
        filters: [{ field: 'dueDate', operator: 'greater_than', value: '2026-02-01' }],
      },
    },
    {
      name: 'Array Contains (assignees contains Alice)',
      query: {
        filters: [{ field: 'assignees', operator: 'contains', value: 'Alice' }],
      },
    },
    {
      name: 'Multi-filter AND (folderScope Tasks + done false)',
      query: {
        folderScope: 'Tasks',
        filters: [{ field: 'done', operator: 'equals', value: false }],
      },
    },
    {
      name: 'Sorting with tie breaker (priority desc)',
      query: {
        sorts: [{ field: 'priority', direction: 'desc' }],
      },
    },
    {
      name: 'Pagination (limit 2, offset 1)',
      query: {
        sorts: [{ field: 'title', direction: 'asc' }],
        limit: 2,
        offset: 1,
      },
    },
  ];

  for (const t of queriesToTest) {
    it(`guarantees exact parity for query: ${t.name}`, async () => {
      const { memory, sqlite } = await createIndices();
      try {
        const memResult = await executeProtocolPropertyQuery(memory, t.query);
        const sqlResult = await executeProtocolPropertyQuery(sqlite, t.query);

        expect(sqlResult.total).toBe(memResult.total);
        expect(sqlResult.rows.length).toBe(memResult.rows.length);

        for (let i = 0; i < memResult.rows.length; i++) {
          const mRow = memResult.rows[i];
          const sRow = sqlResult.rows[i];

          expect(sRow.path).toBe(mRow.path);
          expect(sRow.title).toBe(mRow.title);
          expect(sRow.tags).toEqual(mRow.tags);
          expect(sRow.properties).toEqual(mRow.properties);
        }
      } finally {
        sqlite.close();
      }
    });
  }
});
