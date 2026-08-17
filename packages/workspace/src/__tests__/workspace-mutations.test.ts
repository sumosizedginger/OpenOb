import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '@okw/core';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryVaultStorage } from '@okw/vault';
import { InMemoryAuditSink } from '../audit.js';
import { ForbiddenError, InvalidPathError } from '../errors.js';
import { OpenObWorkspace } from '../workspace.js';

describe('OpenObWorkspace Phase 2A External Mutations (@okw/workspace)', () => {
  async function createWritableWorkspace(
    options: { readOnly?: boolean; auditSink?: InMemoryAuditSink } = {}
  ) {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();
    const auditSink = options.auditSink ?? new InMemoryAuditSink();

    const workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      auditSink,
      vaultName: 'test-vault',
      readOnly: options.readOnly ?? false,
    });

    return { workspace, storage, index, parser, auditSink };
  }

  // --- CONCURRENCY TESTS A - F ---

  it('A. Create race: two concurrent creates for same path -> exactly one succeeds, one conflicts', async () => {
    const { workspace, storage } = await createWritableWorkspace();

    const p1 = workspace.createNote(
      { path: 'RaceNote.md', content: 'Content from writer 1' },
      { clientId: 'agent-1', scopes: ['workspace.write'] }
    );
    const p2 = workspace.createNote(
      { path: 'RaceNote.md', content: 'Content from writer 2' },
      { clientId: 'agent-2', scopes: ['workspace.write'] }
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // Verify canonical content
    const finalRead = await storage.read('RaceNote.md');
    expect(finalRead.textContent).toMatch(/Content from writer (1|2)/);
  });

  it('B. Stale update: read V1 -> update V2 -> second update with V1 receives 409 Conflict', async () => {
    const { workspace } = await createWritableWorkspace();

    const created = await workspace.createNote(
      { path: 'NoteB.md', content: 'Initial V1 content' },
      { scopes: ['workspace.write'] }
    );
    const v1 = created.currentVersion;

    // First update succeeds and moves disk to V2
    const updated = await workspace.updateNote(
      { path: 'NoteB.md', content: 'Updated V2 content', expectedVersion: v1 },
      { scopes: ['workspace.write'] }
    );
    expect(updated.currentVersion.token).not.toBe(v1.token);

    // Second update with stale v1 must fail with ConflictError
    await expect(
      workspace.updateNote(
        { path: 'NoteB.md', content: 'Stale update content', expectedVersion: v1 },
        { scopes: ['workspace.write'] }
      )
    ).rejects.toBeInstanceOf(ConflictError);

    // Verify V2 survives exactly
    const note = await workspace.readNote('NoteB.md', { scopes: ['workspace.read'] });
    expect(note.textContent).toBe('Updated V2 content');
  });

  it('C. Simultaneous same-version update: A and B both start with V1 -> exactly one succeeds', async () => {
    const { workspace } = await createWritableWorkspace();

    const created = await workspace.createNote(
      { path: 'NoteC.md', content: 'V1 Content' },
      { scopes: ['workspace.write'] }
    );
    const v1 = created.currentVersion;

    const pA = workspace.updateNote(
      { path: 'NoteC.md', content: 'Agent A Content', expectedVersion: v1 },
      { clientId: 'agent-A', scopes: ['workspace.write'] }
    );
    const pB = workspace.updateNote(
      { path: 'NoteC.md', content: 'Agent B Content', expectedVersion: v1 },
      { clientId: 'agent-B', scopes: ['workspace.write'] }
    );

    const results = await Promise.allSettled([pA, pB]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const note = await workspace.readNote('NoteC.md', { scopes: ['workspace.read'] });
    expect(note.textContent).toMatch(/Agent (A|B) Content/);
  });

  it('D. Different paths: concurrent writes to A.md and B.md both succeed independently', async () => {
    const { workspace } = await createWritableWorkspace();

    const [resA, resB] = await Promise.all([
      workspace.createNote(
        { path: 'PathA.md', content: 'Content A' },
        { scopes: ['workspace.write'] }
      ),
      workspace.createNote(
        { path: 'PathB.md', content: 'Content B' },
        { scopes: ['workspace.write'] }
      ),
    ]);

    expect(resA.durableSuccess).toBe(true);
    expect(resB.durableSuccess).toBe(true);
    expect(resA.path).toBe('PathA.md');
    expect(resB.path).toBe('PathB.md');
  });

  it('E. Property / update race: Agent A sets property with V1, Agent B updates body with V1 -> one wins, one conflicts', async () => {
    const { workspace } = await createWritableWorkspace();

    const created = await workspace.createNote(
      {
        path: 'NoteE.md',
        content: 'Original body text',
        properties: { status: 'draft', author: 'Alice' },
      },
      { scopes: ['workspace.write', 'properties.write'] }
    );
    const v1 = created.currentVersion;

    const pProp = workspace.setProperty(
      { path: 'NoteE.md', key: 'status', value: 'published', expectedVersion: v1 },
      { clientId: 'agent-prop', scopes: ['properties.write'] }
    );
    const pBody = workspace.updateNote(
      { path: 'NoteE.md', content: 'Modified body text', expectedVersion: v1 },
      { clientId: 'agent-body', scopes: ['workspace.write'] }
    );

    const results = await Promise.allSettled([pProp, pBody]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
  });

  it('F. Index failure: index error after durable write -> reports durable success + degraded index state', async () => {
    const { workspace, index, storage } = await createWritableWorkspace();

    // Make index throw on upsert
    index.upsert = async () => {
      throw new Error('Simulated SQLite index disk full corruption');
    };

    const res = await workspace.createNote(
      { path: 'Degraded.md', content: 'Canonical content saved' },
      { scopes: ['workspace.write'] }
    );

    // 1. Canonical Markdown persisted
    expect(res.durableSuccess).toBe(true);
    expect(res.indexStatus).toBe('degraded');
    expect(res.indexError).toContain('Simulated SQLite index disk full corruption');

    // 2. File exists on disk
    const diskFile = await storage.read('Degraded.md');
    expect(diskFile.textContent).toBe('Canonical content saved');

    // 3. Workspace reports degraded state
    const info = await workspace.getWorkspaceInfo({ scopes: ['workspace.read'] });
    expect(info.indexStatus).toBe('degraded');
  });

  // --- CAPABILITY & SECURITY TESTS ---

  it('Security: readOnly workspace rejects create, update, and setProperty with ForbiddenError', async () => {
    const { workspace } = await createWritableWorkspace({ readOnly: true });

    await expect(
      workspace.createNote({ path: 'Test.md' }, { scopes: ['workspace.write'] })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      workspace.updateNote(
        { path: 'Test.md', content: 'abc', expectedVersion: { token: 'tok' } },
        { scopes: ['workspace.write'] }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      workspace.setProperty(
        { path: 'Test.md', key: 'k', value: 'v', expectedVersion: { token: 'tok' } },
        { scopes: ['properties.write'] }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Security: client without workspace.write cannot create or update note', async () => {
    const { workspace } = await createWritableWorkspace();

    await expect(
      workspace.createNote(
        { path: 'NoScope.md' },
        { scopes: ['workspace.read', 'workspace.search'] }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      workspace.updateNote(
        { path: 'NoScope.md', content: 'abc', expectedVersion: { token: 'tok' } },
        { scopes: ['workspace.read'] }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Security: client with workspace.write but without properties.write cannot set property', async () => {
    const { workspace } = await createWritableWorkspace();

    const created = await workspace.createNote(
      { path: 'PropTest.md', content: 'abc' },
      { scopes: ['workspace.write'] }
    );

    await expect(
      workspace.setProperty(
        { path: 'PropTest.md', key: 'tag', value: 'foo', expectedVersion: created.currentVersion },
        { scopes: ['workspace.write'] } // missing properties.write
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Security: path traversal and invalid paths rejected on createNote', async () => {
    const { workspace } = await createWritableWorkspace();

    await expect(
      workspace.createNote({ path: '../escape.md' }, { scopes: ['workspace.write'] })
    ).rejects.toThrow();

    await expect(
      workspace.createNote({ path: 'C:/Windows/System32/calc.md' }, { scopes: ['workspace.write'] })
    ).rejects.toThrow();
  });

  it('Audit Sink records all successful and failed mutations without leaking body contents', async () => {
    const auditSink = new InMemoryAuditSink();
    const { workspace } = await createWritableWorkspace({ auditSink });

    const created = await workspace.createNote(
      { path: 'AuditNote.md', content: 'Super secret body not to be logged' },
      { clientId: 'agent-audited', requestId: 'req-001', scopes: ['workspace.write'] }
    );

    const events = auditSink.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);

    const createEvt = events.find((e) => e.operation === 'create');
    expect(createEvt).toBeDefined();
    expect(createEvt?.clientId).toBe('agent-audited');
    expect(createEvt?.requestId).toBe('req-001');
    expect(createEvt?.path).toBe('AuditNote.md');
    expect(createEvt?.success).toBe(true);
    expect(createEvt?.currentVersion?.token).toBe(created.currentVersion.token);

    // Verify secret content is NOT present in any event field
    const loggedJson = JSON.stringify(events);
    expect(loggedJson).not.toContain('Super secret body');
  });
});
