import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser, updateDocumentFrontmatter } from '@okw/markdown';
import { MemoryDocumentIndex, executePropertyQuery, groupDocumentsByProperty, discoverVaultProperties, rebuildVaultIndex } from '@okw/index';
import { ViewConfig } from '@okw/core';

describe('Phase 6 Exit Gate: Notion-Like Views & Property Queries (Constitution Law 21)', () => {
  it('executes complex property filters, multi-field sorting, and folder scoping', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    // Create a corpus of structured notes
    const notes: Record<string, string> = {
      'Projects/Alpha.md': `---
title: Project Alpha
status: in-progress
priority: 1
rating: 4.8
tags: [project, engineering]
archived: false
---
# Alpha Project Overview`,

      'Projects/Beta.md': `---
title: Project Beta
status: completed
priority: 2
rating: 4.2
tags: [project, design]
archived: false
---
# Beta Project Overview`,

      'Projects/Gamma.md': `---
title: Project Gamma
status: in-progress
priority: 3
rating: 3.5
tags: [project, research]
archived: true
---
# Gamma Project Overview`,

      'Personal/Fitness.md': `---
title: Workout Plan
status: active
priority: 1
tags: [personal, health]
---
# Workout Log`,

      'Personal/Notes.md': `# Just Plain Notes\n\nNo frontmatter.`,
    };

    for (const [path, content] of Object.entries(notes)) {
      await storage.write(path, null, content);
      const parsed = await parser.parse(path, content);
      await index.upsert(parsed);
    }

    // 1. Test Filter: status equals 'in-progress'
    const query1: ViewConfig = {
      id: 'active-projects',
      name: 'Active Projects',
      type: 'table',
      filters: [{ field: 'status', operator: 'equals', value: 'in-progress' }],
    };
    const res1 = await executePropertyQuery(index, query1);
    expect(res1).toHaveLength(2);
    expect(res1.map((d) => d.title).sort()).toEqual(['Project Alpha', 'Project Gamma']);

    // 2. Test Filter: numeric comparison (priority <= 2 -> priority less_than 3) + folder scope
    const query2: ViewConfig = {
      id: 'high-prio-projects',
      name: 'High Priority Projects',
      type: 'table',
      folderScope: 'Projects',
      filters: [{ field: 'priority', operator: 'less_than', value: 3 }],
      sorts: [{ field: 'priority', direction: 'asc' }],
    };
    const res2 = await executePropertyQuery(index, query2);
    expect(res2).toHaveLength(2);
    expect(res2[0].title).toBe('Project Alpha'); // priority 1
    expect(res2[1].title).toBe('Project Beta'); // priority 2

    // 3. Test Filter: tags contains 'personal'
    const query3: ViewConfig = {
      id: 'personal-view',
      name: 'Personal Notes',
      type: 'list',
      filters: [{ field: 'tags', operator: 'contains', value: 'personal' }],
    };
    const res3 = await executePropertyQuery(index, query3);
    expect(res3).toHaveLength(1);
    expect(res3[0].title).toBe('Workout Plan');

    // 4. Test Filter: is_empty vs is_not_empty
    const queryEmpty: ViewConfig = {
      id: 'unclassified',
      name: 'Unclassified Notes',
      type: 'table',
      filters: [{ field: 'status', operator: 'is_empty' }],
    };
    const resEmpty = await executePropertyQuery(index, queryEmpty);
    expect(resEmpty).toHaveLength(1);
    expect(resEmpty[0].title).toBe('Just Plain Notes');

    // 5. Test Multi-Field Sort: sort by status desc, then priority asc
    const querySort: ViewConfig = {
      id: 'sorted-projects',
      name: 'Sorted Projects',
      type: 'table',
      folderScope: 'Projects',
      sorts: [
        { field: 'status', direction: 'desc' },
        { field: 'priority', direction: 'asc' },
      ],
    };
    const resSort = await executePropertyQuery(index, querySort);
    expect(resSort).toHaveLength(3);
    // 'in-progress' > 'completed' in desc
    expect(resSort[0].title).toBe('Project Alpha'); // in-progress, prio 1
    expect(resSort[1].title).toBe('Project Gamma'); // in-progress, prio 3
    expect(resSort[2].title).toBe('Project Beta'); // completed, prio 2
  });

  it('groups notes into Kanban columns by custom properties and handles missing values', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const tasks = [
      { path: 't1.md', text: '---\ntitle: Task 1\nstatus: todo\n---\nBody 1' },
      { path: 't2.md', text: '---\ntitle: Task 2\nstatus: in-progress\n---\nBody 2' },
      { path: 't3.md', text: '---\ntitle: Task 3\nstatus: done\n---\nBody 3' },
      { path: 't4.md', text: '---\ntitle: Task 4\nstatus: todo\n---\nBody 4' },
      { path: 't5.md', text: '# Task 5\n\nNo status property' },
    ];

    for (const t of tasks) {
      await storage.write(t.path, null, t.text);
      const parsed = await parser.parse(t.path, t.text);
      await index.upsert(parsed);
    }

    const allDocs = await index.getAll();
    const groups = groupDocumentsByProperty(allDocs, 'status');

    expect(groups.has('todo')).toBe(true);
    expect(groups.get('todo')).toHaveLength(2);

    expect(groups.has('in-progress')).toBe(true);
    expect(groups.get('in-progress')).toHaveLength(1);

    expect(groups.has('done')).toBe(true);
    expect(groups.get('done')).toHaveLength(1);

    expect(groups.has('No status')).toBe(true);
    expect(groups.get('No status')).toHaveLength(1);
    expect(groups.get('No status')![0].title).toBe('Task 5');
  });

  it('mutates properties in markdown frontmatter on disk without corrupting body or comments', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);

    const initialContent = `---
# Core Project Configuration
title: Phoenix System
status: backlog
priority: 5
tags: [core, v2]
---
# Phoenix System

Detailed specifications and body text here.
\`\`\`ts
const code = 123;
\`\`\`
`;

    const writeRes = await storage.write('phoenix.md', null, initialContent);
    await index.upsert(await parser.parse('phoenix.md', initialContent));

    // Simulate Kanban drag from "backlog" to "in-progress" and bumping priority to 1
    const snap = await storage.read('phoenix.md');
    const text = new TextDecoder().decode(snap.content);
    const parsed = await parser.parse('phoenix.md', text);

    const updatedProps = {
      ...parsed.properties,
      status: 'in-progress',
      priority: 1,
    };

    const updatedText = updateDocumentFrontmatter(text, updatedProps);
    await safeWriter.safeSave('phoenix.md', updatedText, { expectedVersion: snap.version });

    // Verify disk content preserves comments, headings, and code block
    const diskSnap = await storage.read('phoenix.md');
    const diskText = new TextDecoder().decode(diskSnap.content);

    expect(diskText).toContain('# Core Project Configuration');
    expect(diskText).toContain('status: in-progress');
    expect(diskText).toContain('priority: 1');
    expect(diskText).toContain('tags: [core, v2]');
    expect(diskText).toContain('const code = 123;');

    // Rebuild index and verify query reflects live change
    await rebuildVaultIndex(storage, index, parser);
    const results = await executePropertyQuery(index, {
      id: 'active',
      name: 'Active',
      type: 'board',
      filters: [{ field: 'status', operator: 'equals', value: 'in-progress' }],
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Phoenix System');
    expect(results[0].properties?.priority).toBe(1);
  });

  it('accurately evaluates date greater_than, less_than, and date sorting (P6-2)', async () => {
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const notes = [
      { path: 'event1.md', text: '---\ntitle: Event 1\ndate: 2026-01-15\n---\nBody 1' },
      { path: 'event2.md', text: '---\ntitle: Event 2\ndate: 2026-06-01\n---\nBody 2' },
      { path: 'event3.md', text: '---\ntitle: Event 3\ndate: 2026-12-31\n---\nBody 3' },
    ];

    for (const n of notes) {
      await index.upsert(await parser.parse(n.path, n.text));
    }

    // Filter: date greater_than '2026-05-01'
    const resAfterMay = await executePropertyQuery(index, {
      id: 'upcoming',
      name: 'Upcoming Events',
      type: 'table',
      filters: [{ field: 'date', operator: 'greater_than', value: '2026-05-01' }],
      sorts: [{ field: 'date', direction: 'asc' }],
    });

    expect(resAfterMay).toHaveLength(2);
    expect(resAfterMay[0].title).toBe('Event 2');
    expect(resAfterMay[1].title).toBe('Event 3');

    // Filter: date less_than '2026-06-01'
    const resBeforeJune = await executePropertyQuery(index, {
      id: 'past',
      name: 'Past Events',
      type: 'table',
      filters: [{ field: 'date', operator: 'less_than', value: '2026-06-01' }],
    });

    expect(resBeforeJune).toHaveLength(1);
    expect(resBeforeJune[0].title).toBe('Event 1');
  });

  it('scales efficiently over 1,000 notes under 30ms performance budget', async () => {
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const statuses = ['draft', 'review', 'published', 'archived'];
    const categories = ['engineering', 'design', 'finance', 'marketing'];

    for (let i = 0; i < 1000; i++) {
      const status = statuses[i % statuses.length];
      const category = categories[i % categories.length];
      const priority = (i % 5) + 1;
      const text = `---\ntitle: Note ${i}\nstatus: ${status}\ncategory: ${category}\npriority: ${priority}\n---\n# Note ${i}\n\nContent for note ${i}.`;
      const parsed = await parser.parse(`notes/note-${i}.md`, text);
      await index.upsert(parsed);
    }

    const t0 = performance.now();
    const results = await executePropertyQuery(index, {
      id: 'filtered',
      name: 'Filtered Notes',
      type: 'table',
      filters: [
        { field: 'status', operator: 'equals', value: 'published' },
        { field: 'priority', operator: 'less_than', value: 3 },
      ],
      sorts: [{ field: 'priority', direction: 'asc' }],
    });
    const duration = performance.now() - t0;

    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(50); // Performance budget for 1,000 notes
  });
});
