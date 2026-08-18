import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ConflictError,
  ForbiddenError,
  InvalidPathError,
  NodeFsVaultStorage,
  SafeWriter,
} from '@okw/vault';
import { SqliteDocumentIndex } from '@okw/index';
import { OpenObWorkspace, LocalWorkspaceBackend, InMemoryAuditSink } from '@okw/workspace';
import { DefaultDocumentParser, parseFrontmatter } from '@okw/markdown';

describe('Phase 3F: Inline Property Editing & Board Drag Mutation Integrity', () => {
  let tempDir: string;
  let storage: NodeFsVaultStorage;
  let index: SqliteDocumentIndex;
  let parser: DefaultDocumentParser;
  let safeWriter: SafeWriter;
  let auditSink: InMemoryAuditSink;
  let workspace: OpenObWorkspace;
  let backend: LocalWorkspaceBackend;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-phase3f-test-'));
    storage = new NodeFsVaultStorage(tempDir);
    index = await SqliteDocumentIndex.create();
    parser = new DefaultDocumentParser();
    safeWriter = new SafeWriter(storage);
    auditSink = new InMemoryAuditSink();

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      auditSink,
      readOnly: false,
    });

    backend = new LocalWorkspaceBackend(workspace);
  });

  afterEach(async () => {
    index.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Canonical setProperty Scalar & Type-Preservation Contracts', () => {
    it('1.1 String property edit preserves string value and updates derived index', async () => {
      const created = await backend.createNote({
        path: 'Task1.md',
        content: '# Task 1\n\nContent here.',
        properties: { status: 'todo' },
      });

      const res = await backend.setProperty({
        path: 'Task1.md',
        key: 'status',
        value: 'in_progress',
        expectedVersion: created.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(created.currentVersion.token);

      // Verify canonical markdown frontmatter on disk
      const rawContent = fs.readFileSync(path.join(tempDir, 'Task1.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.status).toBe('in_progress');
      expect(typeof properties.status).toBe('string');

      // Verify derived index query
      const queryRes = await backend.queryNotes({
        filters: [{ field: 'status', operator: 'equals', value: 'in_progress' }],
      });
      expect(queryRes.rows.length).toBe(1);
      expect(queryRes.rows[0].path).toBe('Task1.md');
      expect(queryRes.rows[0].properties.status).toBe('in_progress');
    });

    it('1.2 Numeric property edit preserves number type (not stringified) in frontmatter', async () => {
      const created = await backend.createNote({
        path: 'TaskNumeric.md',
        content: '# Task Numeric\n\nContent.',
        properties: { priority: 1 },
      });

      const res = await backend.setProperty({
        path: 'TaskNumeric.md',
        key: 'priority',
        value: 42,
        expectedVersion: created.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(created.currentVersion.token);

      const rawContent = fs.readFileSync(path.join(tempDir, 'TaskNumeric.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.priority).toBe(42);
      expect(typeof properties.priority).toBe('number');
    });

    it('1.3 Boolean property edit preserves boolean type (not stringified) in frontmatter', async () => {
      const created = await backend.createNote({
        path: 'TaskBool.md',
        content: '# Task Bool\n\nContent.',
        properties: { completed: false },
      });

      const res = await backend.setProperty({
        path: 'TaskBool.md',
        key: 'completed',
        value: true,
        expectedVersion: created.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(created.currentVersion.token);

      const rawContent = fs.readFileSync(path.join(tempDir, 'TaskBool.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.completed).toBe(true);
      expect(typeof properties.completed).toBe('boolean');
    });

    it('1.4 Deleting property via value: null removes property key from frontmatter', async () => {
      const created = await backend.createNote({
        path: 'TaskDeleteProp.md',
        content: '# Task Delete Prop\n\nContent.',
        properties: { status: 'todo', priority: 1 },
      });

      const res = await backend.setProperty({
        path: 'TaskDeleteProp.md',
        key: 'status',
        value: null,
        expectedVersion: created.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(created.currentVersion.token);

      const rawContent = fs.readFileSync(path.join(tempDir, 'TaskDeleteProp.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.status).toBeUndefined();
      expect(properties.priority).toBe(1);
    });

    it('1.5 Empty string value remains a legitimate string value in frontmatter', async () => {
      const created = await backend.createNote({
        path: 'TaskEmptyStr.md',
        content: '# Task Empty String\n\nContent.',
        properties: { status: 'todo' },
      });

      const res = await backend.setProperty({
        path: 'TaskEmptyStr.md',
        key: 'status',
        value: '',
        expectedVersion: created.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(created.currentVersion.token);

      const rawContent = fs.readFileSync(path.join(tempDir, 'TaskEmptyStr.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.status).toBe('');
      expect(typeof properties.status).toBe('string');
    });
  });

  describe('2. Optimistic Concurrency Control (OCC) & Stale Row Protection', () => {
    it('2.1 Stale row version V1 fails with ConflictError (409) when note modified to V2', async () => {
      const created = await backend.createNote({
        path: 'ConcurrentTask.md',
        content: '# Concurrent Task\n\nBody.',
        properties: { status: 'todo' },
      });
      const v1 = created.currentVersion;

      // Agent mutates note: V1 -> V2
      const agentUpdate = await backend.setProperty({
        path: 'ConcurrentTask.md',
        key: 'status',
        value: 'blocked',
        expectedVersion: v1,
      });
      const v2 = agentUpdate.currentVersion;
      expect(v2.token).not.toBe(v1.token);

      // Human attempts to commit based on stale V1
      await expect(
        backend.setProperty({
          path: 'ConcurrentTask.md',
          key: 'status',
          value: 'done',
          expectedVersion: v1,
        })
      ).rejects.toThrow(ConflictError);

      // Verify V2 was preserved on disk and NOT overwritten
      const rawContent = fs.readFileSync(path.join(tempDir, 'ConcurrentTask.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.status).toBe('blocked');
    });

    it('2.2 Rapid sequential edits serialize cleanly when using updated version', async () => {
      const created = await backend.createNote({
        path: 'RapidTask.md',
        content: '# Rapid Task\n\nBody.',
        properties: { priority: 1 },
      });

      // Edit 1
      const res1 = await backend.setProperty({
        path: 'RapidTask.md',
        key: 'priority',
        value: 2,
        expectedVersion: created.currentVersion,
      });

      // Edit 2 using version returned from Edit 1
      const res2 = await backend.setProperty({
        path: 'RapidTask.md',
        key: 'priority',
        value: 3,
        expectedVersion: res1.currentVersion,
      });

      expect(res2.currentVersion.token).not.toBe(res1.currentVersion.token);

      const rawContent = fs.readFileSync(path.join(tempDir, 'RapidTask.md'), 'utf8');
      const { properties } = parseFrontmatter(rawContent);
      expect(properties.priority).toBe(3);
    });
  });

  describe('3. Capability Scope & Reserved Namespace Hardening', () => {
    it('3.1 Workspace with readOnly rejects setProperty with ForbiddenError (403)', async () => {
      const readOnlyWorkspace = new OpenObWorkspace({
        storage,
        index,
        parser,
        safeWriter,
        auditSink,
        readOnly: true,
      });

      const created = await backend.createNote({
        path: 'NoteAuth.md',
        content: '# Note Auth',
        properties: { status: 'todo' },
      });

      await expect(
        readOnlyWorkspace.setProperty({
          path: 'NoteAuth.md',
          key: 'status',
          value: 'done',
          expectedVersion: created.currentVersion,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('3.2 setProperty rejects attempts to access .openob reserved namespace across case variants', async () => {
      const testCases = [
        '.openob/view.json',
        '.OPENOB/view.json',
        '.OpenOb/view.json',
        '.oPeNoB/view.json',
      ];

      for (const p of testCases) {
        await expect(
          backend.setProperty({
            path: p,
            key: 'name',
            value: 'hacked',
            expectedVersion: { token: 'dummy' },
          })
        ).rejects.toThrow(InvalidPathError);
      }
    });
  });

  describe('4. Board Drag Mutation Grouping & Type Preservation Proof', () => {
    it('4.1 Moving note between numeric Board columns preserves number type', async () => {
      const note1 = await backend.createNote({
        path: 'Board1.md',
        content: '# Board 1',
        properties: { priority: 1 },
      });

      // Target column represents numeric priority 2
      const targetColumnValue = 2; // Derived from ColumnGroup.value

      const res = await backend.setProperty({
        path: 'Board1.md',
        key: 'priority',
        value: targetColumnValue,
        expectedVersion: note1.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(note1.currentVersion.token);

      const raw = fs.readFileSync(path.join(tempDir, 'Board1.md'), 'utf8');
      const { properties } = parseFrontmatter(raw);
      expect(properties.priority).toBe(2);
      expect(typeof properties.priority).toBe('number');
    });

    it('4.2 Moving note to ungrouped column (No <groupBy>) deletes the property', async () => {
      const note1 = await backend.createNote({
        path: 'BoardUngrouped.md',
        content: '# Board Ungrouped',
        properties: { status: 'todo' },
      });

      // Dropping into Ungrouped column sets value: null
      const res = await backend.setProperty({
        path: 'BoardUngrouped.md',
        key: 'status',
        value: null,
        expectedVersion: note1.currentVersion,
      });

      expect(res.currentVersion.token).not.toBe(note1.currentVersion.token);

      const raw = fs.readFileSync(path.join(tempDir, 'BoardUngrouped.md'), 'utf8');
      const { properties } = parseFrontmatter(raw);
      expect(properties.status).toBeUndefined();
    });
  });
});
