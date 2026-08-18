import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '@okw/core';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { OpenObWorkspace } from '../workspace.js';
import { InvalidRequestError } from '../errors.js';

describe('Phase 3E: Saved Views Persistence & Validation Unit Tests', () => {
  let storage: MemoryVaultStorage;
  let index: MemoryDocumentIndex;
  let parser: DefaultDocumentParser;
  let workspace: OpenObWorkspace;

  beforeEach(async () => {
    storage = new MemoryVaultStorage();
    index = new MemoryDocumentIndex();
    parser = new DefaultDocumentParser();
    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      readOnly: false,
    });

    // Seed notes
    await workspace.createNote({
      path: 'Task1.md',
      content: '---\ntitle: Task One\nstatus: todo\npriority: 1\n---\nTask 1 body',
    });
    await workspace.createNote({
      path: 'Task2.md',
      content: '---\ntitle: Task Two\nstatus: done\npriority: 2\n---\nTask 2 body',
    });
    await workspace.createNote({
      path: 'Task3.md',
      content: '---\ntitle: Task Three\nstatus: in_progress\npriority: 3\n---\nTask 3 body',
    });
  });

  it('1. Creates, lists, gets, updates, and deletes saved views with OCC', async () => {
    // 1. Create
    const created = await workspace.createSavedView({
      name: 'Active Tasks',
      type: 'table',
      filters: [{ field: 'status', operator: 'not_equals', value: 'done' }],
      sorts: [{ field: 'priority', direction: 'asc' }],
      visibleProperties: ['status', 'priority'],
    });

    expect(created.view.id).toMatch(/^view_[a-zA-Z0-9_-]+$/);
    expect(created.view.name).toBe('Active Tasks');
    expect(created.view.type).toBe('table');
    expect(created.version.token).toBeDefined();

    // Verify stored under .openob/views/
    const existsOnDisk = await storage.exists(`.openob/views/${created.view.id}.json`);
    expect(existsOnDisk).toBe(true);

    // 2. List
    const list = await workspace.listSavedViews();
    expect(list.length).toBe(1);
    expect(list[0].view.id).toBe(created.view.id);
    expect(list[0].view.name).toBe('Active Tasks');

    // 3. Get
    const fetched = await workspace.getSavedView(created.view.id);
    expect(fetched.view.name).toBe('Active Tasks');
    expect(fetched.view.filters).toEqual([
      { field: 'status', operator: 'not_equals', value: 'done' },
    ]);

    // 4. Update with correct expectedVersion
    const updated = await workspace.updateSavedView(created.view.id, {
      name: 'Sprint Tasks',
      type: 'board',
      groupBy: 'status',
      expectedVersion: created.version,
    });
    expect(updated.view.name).toBe('Sprint Tasks');
    expect(updated.view.type).toBe('board');
    expect(updated.view.groupBy).toBe('status');
    expect(updated.version.token).not.toBe(created.version.token);

    // 5. Update with stale version -> ConflictError
    await expect(
      workspace.updateSavedView(created.view.id, {
        name: 'Stale Update',
        expectedVersion: created.version, // Old version
      })
    ).rejects.toThrow(ConflictError);

    // 6. Delete with stale version -> ConflictError
    await expect(
      workspace.deleteSavedView(created.view.id, {
        expectedVersion: created.version,
      })
    ).rejects.toThrow(ConflictError);

    // 7. Delete with current version -> Success
    const deleted = await workspace.deleteSavedView(created.view.id, {
      expectedVersion: updated.version,
    });
    expect(deleted.durableSuccess).toBe(true);

    // Verify removed from disk
    const existsAfter = await storage.exists(`.openob/views/${created.view.id}.json`);
    expect(existsAfter).toBe(false);

    // Get after delete -> NotFoundError
    await expect(workspace.getSavedView(created.view.id)).rejects.toThrow(NotFoundError);
  });

  it('2. runSavedView executes property query configured by saved view', async () => {
    const created = await workspace.createSavedView({
      name: 'Todo Only',
      type: 'list',
      filters: [{ field: 'status', operator: 'equals', value: 'todo' }],
      sorts: [{ field: 'title', direction: 'asc' }],
    });

    const res = await workspace.runSavedView(created.view.id);
    expect(res.total).toBe(1);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].title).toBe('Task One');
    expect(res.rows[0].properties.status).toBe('todo');
  });

  it('3. Validation bounds: rejects malformed names, types, operators, and bounds violations', async () => {
    // Missing / empty name
    await expect(workspace.createSavedView({ name: '', type: 'table' })).rejects.toThrow(
      InvalidRequestError
    );
    await expect(
      workspace.createSavedView({ name: 'a'.repeat(121), type: 'table' })
    ).rejects.toThrow(InvalidRequestError);

    // Invalid type
    await expect(
      workspace.createSavedView({ name: 'Bad Type', type: 'gallery' as any })
    ).rejects.toThrow(InvalidRequestError);

    // Oversized filters (> 32)
    const tooManyFilters = Array.from({ length: 33 }, (_, i) => ({
      field: `field_${i}`,
      operator: 'equals' as const,
      value: 'val',
    }));
    await expect(
      workspace.createSavedView({
        name: 'Too Many Filters',
        type: 'table',
        filters: tooManyFilters,
      })
    ).rejects.toThrow(InvalidRequestError);

    // Invalid operator
    await expect(
      workspace.createSavedView({
        name: 'Bad Op',
        type: 'table',
        filters: [{ field: 'status', operator: 'regex_match' as any, value: 'x' }],
      })
    ).rejects.toThrow(InvalidRequestError);

    // Forbidden / prototype pollution property names
    await expect(
      workspace.createSavedView({
        name: 'Pollution',
        type: 'board',
        groupBy: '__proto__',
      })
    ).rejects.toThrow(InvalidRequestError);

    await expect(
      workspace.createSavedView({
        name: 'Pollution 2',
        type: 'table',
        visibleProperties: ['constructor'],
      })
    ).rejects.toThrow(InvalidRequestError);
  });

  it('4. Corrupted view file resilience: skips corrupted file without crashing listSavedViews', async () => {
    // 1. Create a valid saved view
    const valid = await workspace.createSavedView({
      name: 'Valid View',
      type: 'table',
    });

    // 2. Inject corrupted JSON into .openob/views/corrupted.json
    await storage.write('.openob/views/corrupted.json', undefined, '{ malformed json: true, ');

    // 3. List should return the valid view and skip the corrupted one without crashing
    const list = await workspace.listSavedViews();
    expect(list.length).toBe(1);
    expect(list[0].view.id).toBe(valid.view.id);
  });

  it('5. Namespace isolation: .openob files are not indexed as notes or listed in normal file tree', async () => {
    await workspace.createSavedView({
      name: 'Hidden View',
      type: 'table',
    });

    // 1. listEntries('') does not return .openob entries
    const rootEntries = await workspace.listEntries('');
    const hasOpenOb = rootEntries.some((e) => e.path.startsWith('.openob'));
    expect(hasOpenOb).toBe(false);

    // 2. rebuildIndex does not index .openob files
    const rebuildRes = await workspace.rebuildIndex();
    expect(rebuildRes.count).toBe(3); // Only the 3 markdown notes

    // 3. search does not return .openob
    const searchRes = await workspace.search({ query: 'Hidden View' });
    expect(searchRes.total).toBe(0);
  });

  it('6. R3E-1 / P3E-P1: Context-less readOnly workspace centrally blocks all view mutations with ForbiddenError', async () => {
    // 1. Create a genuinely read-only workspace with NO client context
    const roStorage = new MemoryVaultStorage();
    const roIndex = new MemoryDocumentIndex();
    const roWorkspace = new OpenObWorkspace({
      storage: roStorage,
      index: roIndex,
      readOnly: true, // Read-only!
    });

    // 2. Note write blocked
    await expect(
      roWorkspace.createNote({ path: 'New.md', content: 'Blocked note' })
    ).rejects.toThrow();

    // 3. Context-less createSavedView MUST throw ForbiddenError
    await expect(
      roWorkspace.createSavedView({
        name: 'Blocked View',
        type: 'table',
      })
    ).rejects.toThrow(/Forbidden/);

    // 4. Context-less updateSavedView MUST throw ForbiddenError
    await expect(
      roWorkspace.updateSavedView('view_12345', {
        name: 'Blocked Update',
        expectedVersion: { token: 'tok_1' },
      })
    ).rejects.toThrow(/Forbidden/);

    // 5. Context-less deleteSavedView MUST throw ForbiddenError
    await expect(
      roWorkspace.deleteSavedView('view_12345', {
        expectedVersion: { token: 'tok_1' },
      })
    ).rejects.toThrow(/Forbidden/);

    // 6. Context-less read/list/run are ALLOWED
    const list = await roWorkspace.listSavedViews();
    expect(list).toEqual([]);
  });

  it('7. Standalone web mode integration: explicitly writable local workspace supports complete saved-view CRUD', async () => {
    const standaloneStorage = new MemoryVaultStorage();
    const standaloneIndex = new MemoryDocumentIndex();
    const standaloneWs = new OpenObWorkspace({
      storage: standaloneStorage,
      index: standaloneIndex,
      readOnly: false, // Truthful standalone editing application
    });

    await standaloneWs.createNote({
      path: 'Doc.md',
      content: '---\ntitle: Standalone Note\nstatus: active\n---\nBody',
    });

    // Create
    const created = await standaloneWs.createSavedView({
      name: 'Local Board',
      type: 'board',
      groupBy: 'status',
    });
    expect(created.view.id).toBeDefined();

    // List
    const list = await standaloneWs.listSavedViews();
    expect(list.length).toBe(1);

    // Run
    const runRes = await standaloneWs.runSavedView(created.view.id);
    expect(runRes.total).toBe(1);
    expect(runRes.rows[0].title).toBe('Standalone Note');

    // Update
    const updated = await standaloneWs.updateSavedView(created.view.id, {
      name: 'Local Board Renamed',
      expectedVersion: created.version,
    });
    expect(updated.view.name).toBe('Local Board Renamed');

    // Delete
    const delRes = await standaloneWs.deleteSavedView(created.view.id, {
      expectedVersion: updated.version,
    });
    expect(delRes.durableSuccess).toBe(true);

    expect(await standaloneWs.listSavedViews()).toEqual([]);
  });
});
