import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVaultStorage, NodeFsVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, SqliteDocumentIndex } from '@okw/index';
import { OpenObWorkspace } from '@okw/workspace';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('Phase 3E: Saved Views Persistence & Note Immutability Integrity Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openob-views-p3e-'));
  });

  it('1. Survives workspace shutdown and reopening with exact configuration parity', async () => {
    const storage1 = new NodeFsVaultStorage(tempDir);
    const index1 = await SqliteDocumentIndex.create();
    const ws1 = new OpenObWorkspace({
      storage: storage1,
      index: index1,
      readOnly: false,
    });

    await ws1.createNote({
      path: 'Project.md',
      content: '---\ntitle: Super Project\nstatus: active\n---\nNotes here',
    });

    const saved = await ws1.createSavedView({
      name: 'Active Projects',
      type: 'board',
      groupBy: 'status',
      filters: [{ field: 'status', operator: 'equals', value: 'active' }],
      visibleProperties: ['status', 'title'],
    });

    // Close ws1 and reopen a completely new workspace on the same directory
    await index1.close?.();

    const storage2 = new NodeFsVaultStorage(tempDir);
    const index2 = await SqliteDocumentIndex.create();
    const ws2 = new OpenObWorkspace({
      storage: storage2,
      index: index2,
      readOnly: false,
    });

    // Rebuild index
    await ws2.rebuildIndex();

    // Verify saved view exists unchanged
    const list = await ws2.listSavedViews();
    expect(list.length).toBe(1);
    expect(list[0].view.id).toBe(saved.view.id);
    expect(list[0].view.name).toBe('Active Projects');
    expect(list[0].view.type).toBe('board');
    expect(list[0].view.groupBy).toBe('status');
    expect(list[0].view.filters).toEqual([
      { field: 'status', operator: 'equals', value: 'active' },
    ]);

    // Running view query works seamlessly
    const queryRes = await ws2.runSavedView(saved.view.id);
    expect(queryRes.total).toBe(1);
    expect(queryRes.rows[0].title).toBe('Super Project');

    await index2.close?.();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('2. Index rebuild / deletion does NOT touch saved views, and views deletion does NOT touch notes', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const workspace = new OpenObWorkspace({ storage, index, readOnly: false });

    // 1. Create notes
    await workspace.createNote({
      path: 'Alpha.md',
      content: '---\ntitle: Alpha\nstatus: ready\n---\nAlpha body',
    });
    await workspace.createNote({
      path: 'Beta.md',
      content: '---\ntitle: Beta\nstatus: draft\n---\nBeta body',
    });

    // 2. Snapshot note bytes
    const alphaBytesBefore = (await storage.read('Alpha.md')).content;
    const betaBytesBefore = (await storage.read('Beta.md')).content;

    // 3. Create saved views
    const view1 = await workspace.createSavedView({ name: 'Ready View', type: 'table' });
    const view2 = await workspace.createSavedView({
      name: 'Draft Board',
      type: 'board',
      groupBy: 'status',
    });

    // 4. Rebuild index from scratch (deleting and reconstructing derived index)
    await index.rebuild([]);
    const rebuildRes = await workspace.rebuildIndex();
    expect(rebuildRes.count).toBe(2);

    // Saved views still exist intact in .openob/views/
    const viewsAfterRebuild = await workspace.listSavedViews();
    expect(viewsAfterRebuild.length).toBe(2);
    expect(viewsAfterRebuild.map((v) => v.view.id).sort()).toEqual(
      [view1.view.id, view2.view.id].sort()
    );

    // 5. Update and delete saved views
    const updated1 = await workspace.updateSavedView(view1.view.id, {
      name: 'Ready View Renamed',
      expectedVersion: view1.version,
    });
    await workspace.deleteSavedView(view1.view.id, { expectedVersion: updated1.version });
    await workspace.deleteSavedView(view2.view.id, { expectedVersion: view2.version });

    const viewsAfterDelete = await workspace.listSavedViews();
    expect(viewsAfterDelete.length).toBe(0);

    // 6. Verify notes bytes are 100% bit-for-bit identical
    const alphaBytesAfter = (await storage.read('Alpha.md')).content;
    const betaBytesAfter = (await storage.read('Beta.md')).content;

    expect(alphaBytesAfter).toEqual(alphaBytesBefore);
    expect(betaBytesAfter).toEqual(betaBytesBefore);
  });

  it('3. Hostile / special characters in view name never escape .openob/views/ namespace', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const workspace = new OpenObWorkspace({ storage, index, readOnly: false });

    // Hostile names
    const hostileNames = [
      '../../../../etc/passwd',
      '..\\..\\windows\\system32',
      '/tmp/evil',
      'View with <script>alert(1)</script>',
      'Unicode: 🚀🔥 “quotes” & symbols/\\',
    ];

    for (const hostileName of hostileNames) {
      const created = await workspace.createSavedView({
        name: hostileName,
        type: 'table',
      });

      // Stored path MUST be .openob/views/<generated-id>.json
      expect(created.view.id).toMatch(/^view_[a-zA-Z0-9_-]+$/);
      const exists = await storage.exists(`.openob/views/${created.view.id}.json`);
      expect(exists).toBe(true);

      // Name is preserved faithfully in configuration
      const fetched = await workspace.getSavedView(created.view.id);
      expect(fetched.view.name).toBe(hostileName.trim());
    }
  });
});
