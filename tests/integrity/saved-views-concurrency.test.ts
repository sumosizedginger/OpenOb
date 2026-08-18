import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '@okw/core';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { LocalWorkspaceBackend, OpenObWorkspace } from '@okw/workspace';

describe('Phase 3E: Saved Views Concurrency & Backend Parity Integrity Tests', () => {
  let storage: MemoryVaultStorage;
  let index: MemoryDocumentIndex;
  let workspace: OpenObWorkspace;
  let backend: LocalWorkspaceBackend;

  beforeEach(async () => {
    storage = new MemoryVaultStorage();
    index = new MemoryDocumentIndex();
    workspace = new OpenObWorkspace({ storage, index, readOnly: false });
    backend = new LocalWorkspaceBackend(workspace);
  });

  it('1. Concurrent updates on same version: exactly one succeeds, other receives 409 Conflict', async () => {
    const created = await backend.createSavedView({
      name: 'Base View',
      type: 'table',
    });

    const v1 = created.version;

    // Simulate two clients simultaneously updating v1
    const p1 = backend.updateSavedView(created.view.id, {
      name: 'Client 1 Update',
      expectedVersion: v1,
    });
    const p2 = backend.updateSavedView(created.view.id, {
      name: 'Client 2 Update',
      expectedVersion: v1,
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // Latest state on disk is the winning update
    const current = await backend.getSavedView(created.view.id);
    expect(['Client 1 Update', 'Client 2 Update']).toContain(current.view.name);
  });

  it('2. Concurrent update vs delete: one winner, no resurrection', async () => {
    const created = await backend.createSavedView({
      name: 'To Delete Or Update',
      type: 'list',
    });

    const v1 = created.version;

    const pUpdate = backend.updateSavedView(created.view.id, {
      name: 'Updated Name',
      expectedVersion: v1,
    });
    const pDelete = backend.deleteSavedView(created.view.id, {
      expectedVersion: v1,
    });

    const results = await Promise.allSettled([pUpdate, pDelete]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (results[0].status === 'fulfilled') {
      // Update won -> view exists with new version
      const current = await backend.getSavedView(created.view.id);
      expect(current.view.name).toBe('Updated Name');
    } else {
      // Delete won -> view does not exist
      await expect(backend.getSavedView(created.view.id)).rejects.toThrow(NotFoundError);
    }
  });

  it('3. Double delete: first succeeds, second fails with 404 or 409', async () => {
    const created = await backend.createSavedView({
      name: 'To Delete Twice',
      type: 'table',
    });

    const v1 = created.version;

    const res1 = await backend.deleteSavedView(created.view.id, { expectedVersion: v1 });
    expect(res1.durableSuccess).toBe(true);

    await expect(
      backend.deleteSavedView(created.view.id, { expectedVersion: v1 })
    ).rejects.toThrow();
  });
});
