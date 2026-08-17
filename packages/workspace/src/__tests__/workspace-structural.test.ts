import { ConflictError, NotFoundError } from '@okw/core';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryVaultStorage, NoteWriteCoordinator, SafeWriter } from '@okw/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../audit.js';
import { ForbiddenError, IndexDegradedError, InvalidRequestError } from '../errors.js';
import { OpenObWorkspace } from '../workspace.js';

describe('OpenObWorkspace Structural Mutations (Phase 2B: Rename + Delete)', () => {
  let storage: MemoryVaultStorage;
  let index: MemoryDocumentIndex;
  let parser: DefaultDocumentParser;
  let safeWriter: SafeWriter;
  let coordinator: NoteWriteCoordinator;
  let auditSink: InMemoryAuditSink;
  let workspace: OpenObWorkspace;

  beforeEach(async () => {
    storage = new MemoryVaultStorage('test-vault');
    index = new MemoryDocumentIndex();
    parser = new DefaultDocumentParser();
    safeWriter = new SafeWriter(storage);
    coordinator = new NoteWriteCoordinator(storage, safeWriter);
    auditSink = new InMemoryAuditSink();

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      coordinator,
      auditSink,
      readOnly: false,
    });
  });

  describe('Capability & Scope Enforcement', () => {
    it('rejects rename and delete on read-only workspace', async () => {
      const readOnlyWs = new OpenObWorkspace({
        storage,
        index,
        readOnly: true,
      });

      await expect(
        readOnlyWs.renameNote({
          oldPath: 'A.md',
          newPath: 'B.md',
          expectedVersion: { token: 'tok' },
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        readOnlyWs.deleteNote({
          path: 'A.md',
          expectedVersion: { token: 'tok' },
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects rename and delete if client lacks required scope', async () => {
      await workspace.createNote({ path: 'NoteA.md', content: 'Content' });
      const read = await workspace.readNote('NoteA.md');

      // write scope does NOT imply rename
      await expect(
        workspace.renameNote(
          {
            oldPath: 'NoteA.md',
            newPath: 'NoteB.md',
            expectedVersion: { token: read.version.token },
          },
          { scopes: ['workspace.write'] }
        )
      ).rejects.toThrow(ForbiddenError);

      // rename scope does NOT imply delete
      await expect(
        workspace.deleteNote(
          {
            path: 'NoteA.md',
            expectedVersion: { token: read.version.token },
          },
          { scopes: ['workspace.rename'] }
        )
      ).rejects.toThrow(ForbiddenError);

      // delete scope does NOT imply rename
      await expect(
        workspace.renameNote(
          {
            oldPath: 'NoteA.md',
            newPath: 'NoteB.md',
            expectedVersion: { token: read.version.token },
          },
          { scopes: ['workspace.delete'] }
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Rename Note Contract & Wikilink Refactoring', () => {
    it('safely renames a note and refactors inbound wikilinks across vault', async () => {
      // 1. Create target note and referencing notes
      const targetCreate = await workspace.createNote({
        path: 'Projects/Alpha.md',
        content: '# Alpha Project\nSelf link: [[Projects/Alpha#Overview]]',
      });

      await workspace.createNote({
        path: 'Index.md',
        content: `
# Main Index
See [[Projects/Alpha]] for details.
Also see [[Projects/Alpha#Overview|Alpha Overview]] and embed ![[Projects/Alpha]].
`,
      });

      await workspace.createNote({
        path: 'Projects/Beta.md',
        content: 'Relies on [[Alpha]] and [[Projects/Alpha]].',
      });

      // 2. Perform rename with OCC
      const renameRes = await workspace.renameNote({
        oldPath: 'Projects/Alpha.md',
        newPath: 'Projects/Gamma.md',
        expectedVersion: { token: targetCreate.currentVersion.token },
        updateLinks: true,
      });

      expect(renameRes.operation).toBe('rename');
      expect(renameRes.oldPath).toBe('Projects/Alpha.md');
      expect(renameRes.newPath).toBe('Projects/Gamma.md');
      expect(renameRes.durableSuccess).toBe(true);
      expect(renameRes.indexStatus).toBe('verified');
      expect(renameRes.updatedFiles).toContain('Index.md');
      expect(renameRes.updatedFiles).toContain('Projects/Beta.md');
      expect(renameRes.rewrittenLinkCount).toBeGreaterThanOrEqual(4);

      // 3. Verify old file is gone and new file exists
      await expect(workspace.readNote('Projects/Alpha.md')).rejects.toThrow(NotFoundError);
      const renamedDoc = await workspace.readNote('Projects/Gamma.md');
      expect(renamedDoc.textContent).toContain('[[Gamma#Overview]]');

      // 4. Verify referencing files have updated links
      const updatedIndex = await workspace.readNote('Index.md');
      expect(updatedIndex.textContent).toContain('[[Projects/Gamma]]');
      expect(updatedIndex.textContent).toContain('[[Projects/Gamma#Overview|Alpha Overview]]');
      expect(updatedIndex.textContent).toContain('![[Projects/Gamma]]');
      expect(updatedIndex.textContent).not.toContain('Projects/Alpha');

      const updatedBeta = await workspace.readNote('Projects/Beta.md');
      expect(updatedBeta.textContent).toContain('[[Gamma]]');
      expect(updatedBeta.textContent).not.toContain('Alpha');

      // 5. Verify backlinks on renamed document
      const backlinks = await workspace.getBacklinks('Projects/Gamma.md');
      expect(backlinks.length).toBeGreaterThanOrEqual(2);
      const backlinkSources = backlinks.map((b) => b.sourcePath);
      expect(backlinkSources).toContain('Index.md');
      expect(backlinkSources).toContain('Projects/Beta.md');
    });

    it('rejects rename on version mismatch (OCC conflict)', async () => {
      const created = await workspace.createNote({
        path: 'NoteOCC.md',
        content: 'Original',
      });

      // Update the note to advance version
      await workspace.updateNote({
        path: 'NoteOCC.md',
        content: 'Updated externally',
        expectedVersion: { token: created.currentVersion.token },
      });

      // Attempt rename with stale token
      await expect(
        workspace.renameNote({
          oldPath: 'NoteOCC.md',
          newPath: 'NoteOCCRenamed.md',
          expectedVersion: { token: created.currentVersion.token }, // STALE!
        })
      ).rejects.toThrow(ConflictError);

      // Verify old note still intact
      const intact = await workspace.readNote('NoteOCC.md');
      expect(intact.textContent).toBe('Updated externally');
    });

    it('rejects rename if target already exists', async () => {
      const docA = await workspace.createNote({ path: 'FileA.md', content: 'A' });
      await workspace.createNote({ path: 'FileB.md', content: 'B' });

      await expect(
        workspace.renameNote({
          oldPath: 'FileA.md',
          newPath: 'FileB.md',
          expectedVersion: { token: docA.currentVersion.token },
        })
      ).rejects.toThrow(ConflictError);
    });

    it('handles identical old and new path as a safe no-op', async () => {
      const doc = await workspace.createNote({ path: 'Same.md', content: 'Same content' });
      const res = await workspace.renameNote({
        oldPath: 'Same.md',
        newPath: 'Same.md',
        expectedVersion: { token: doc.currentVersion.token },
      });

      expect(res.durableSuccess).toBe(true);
      expect(res.updatedFiles).toHaveLength(0);
      expect(res.rewrittenLinkCount).toBe(0);
    });

    it('preserves inbound links unchanged when updateLinks is false', async () => {
      const doc = await workspace.createNote({ path: 'Target.md', content: 'Target body' });
      await workspace.createNote({ path: 'Ref.md', content: 'Link to [[Target]]' });

      const res = await workspace.renameNote({
        oldPath: 'Target.md',
        newPath: 'TargetRenamed.md',
        expectedVersion: { token: doc.currentVersion.token },
        updateLinks: false,
      });

      expect(res.durableSuccess).toBe(true);
      expect(res.updatedFiles).toHaveLength(0);
      const ref = await workspace.readNote('Ref.md');
      expect(ref.textContent).toBe('Link to [[Target]]');
    });
  });

  describe('Delete Note Contract', () => {
    it('safely deletes a note using expectedVersion OCC', async () => {
      const doc = await workspace.createNote({
        path: 'ToDelete.md',
        content: '# Heading\nTo be deleted',
      });

      await workspace.createNote({
        path: 'Inbound.md',
        content: 'Links to [[ToDelete]] stay canonical Markdown.',
      });

      const delRes = await workspace.deleteNote({
        path: 'ToDelete.md',
        expectedVersion: { token: doc.currentVersion.token },
      });

      expect(delRes.operation).toBe('delete');
      expect(delRes.path).toBe('ToDelete.md');
      expect(delRes.durableSuccess).toBe(true);
      expect(delRes.indexStatus).toBe('verified');

      // Verify file is gone from storage and index
      await expect(workspace.readNote('ToDelete.md')).rejects.toThrow(NotFoundError);

      // Inbound links remain untouched as canonical Markdown
      const inbound = await workspace.readNote('Inbound.md');
      expect(inbound.textContent).toBe('Links to [[ToDelete]] stay canonical Markdown.');
    });

    it('rejects delete on stale expectedVersion', async () => {
      const doc = await workspace.createNote({ path: 'DocDel.md', content: 'V1' });
      await workspace.updateNote({
        path: 'DocDel.md',
        content: 'V2',
        expectedVersion: { token: doc.currentVersion.token },
      });

      await expect(
        workspace.deleteNote({
          path: 'DocDel.md',
          expectedVersion: { token: doc.currentVersion.token }, // STALE
        })
      ).rejects.toThrow(ConflictError);

      const stillThere = await workspace.readNote('DocDel.md');
      expect(stillThere.textContent).toBe('V2');
    });

    it('rejects delete on non-existent file', async () => {
      await expect(
        workspace.deleteNote({
          path: 'Ghost.md',
          expectedVersion: { token: 'invalid' },
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Structural Concurrency Gate', () => {
    it('allows concurrent shared mutations on different paths without blocking', async () => {
      const doc1 = await workspace.createNote({ path: 'Doc1.md', content: 'Initial 1' });
      const doc2 = await workspace.createNote({ path: 'Doc2.md', content: 'Initial 2' });

      const [res1, res2] = await Promise.all([
        workspace.updateNote({
          path: 'Doc1.md',
          content: 'Updated 1',
          expectedVersion: { token: doc1.currentVersion.token },
        }),
        workspace.updateNote({
          path: 'Doc2.md',
          content: 'Updated 2',
          expectedVersion: { token: doc2.currentVersion.token },
        }),
      ]);

      expect(res1.durableSuccess).toBe(true);
      expect(res2.durableSuccess).toBe(true);
    });

    it('records structured audit events for rename and delete operations', async () => {
      const doc = await workspace.createNote(
        { path: 'AuditTest.md', content: 'Audit test' },
        { clientId: 'agent-007', requestId: 'req-101' }
      );

      await workspace.renameNote(
        {
          oldPath: 'AuditTest.md',
          newPath: 'AuditRenamed.md',
          expectedVersion: { token: doc.currentVersion.token },
        },
        { clientId: 'agent-007', requestId: 'req-102' }
      );

      const readRenamed = await workspace.readNote('AuditRenamed.md');

      await workspace.deleteNote(
        {
          path: 'AuditRenamed.md',
          expectedVersion: { token: readRenamed.version.token },
        },
        { clientId: 'agent-007', requestId: 'req-103' }
      );

      const events = auditSink.getEvents();
      expect(
        events.some((e) => e.operation === 'rename' && e.success && e.requestId === 'req-102')
      ).toBe(true);
      expect(
        events.some((e) => e.operation === 'delete' && e.success && e.requestId === 'req-103')
      ).toBe(true);
    });

    it('protects code blocks and frontmatter during wikilink refactoring', async () => {
      const target = await workspace.createNote({
        path: 'TargetNote.md',
        content: '# Target Note Body',
      });

      const referencing = `---
tags: [alpha, beta]
summary: "Refers to [[TargetNote]] in frontmatter string"
---

# Real Reference
See [[TargetNote]] here.

\`\`\`javascript
// This is a code block
const link = "[[TargetNote]]";
\`\`\`

Here is an inline snippet: \`[[TargetNote]]\`.

~~~markdown
Another code block: [[TargetNote]]
~~~
`;

      await workspace.createNote({
        path: 'Referencing.md',
        content: referencing,
      });

      const res = await workspace.renameNote({
        oldPath: 'TargetNote.md',
        newPath: 'TargetRenamed.md',
        expectedVersion: { token: target.currentVersion.token },
        updateLinks: true,
      });

      expect(res.durableSuccess).toBe(true);
      expect(res.rewrittenLinkCount).toBe(1); // Only the real Markdown reference is rewritten!

      const updated = await workspace.readNote('Referencing.md');
      expect(updated.textContent).toContain('See [[TargetRenamed]] here.');
      expect(updated.textContent).toContain('const link = "[[TargetNote]]";');
      expect(updated.textContent).toContain('`[[TargetNote]]`');
      expect(updated.textContent).toContain('Another code block: [[TargetNote]]');
    });

    it('rejects rename if workspace index is in degraded state', async () => {
      const doc = await workspace.createNote({ path: 'DegradedCheck.md', content: 'Content' });

      // Simulate index degradation on workspace
      (workspace as any).indexHealth = 'degraded';

      await expect(
        workspace.renameNote({
          oldPath: 'DegradedCheck.md',
          newPath: 'DegradedRenamed.md',
          expectedVersion: { token: doc.currentVersion.token },
        })
      ).rejects.toThrow(IndexDegradedError);
    });

    it('executes MCP openob_rename_note and openob_delete_note tools', async () => {
      const { handleMcpToolCall } = await import('../mcp.js');

      const createRes = await workspace.createNote({
        path: 'McpTest.md',
        content: '# MCP Note',
      });

      // Rename via MCP
      const renameMcpRes = await handleMcpToolCall(workspace, 'openob_rename_note', {
        oldPath: 'McpTest.md',
        newPath: 'McpRenamed.md',
        expectedVersion: { token: createRes.currentVersion.token },
      });

      expect(renameMcpRes.isError).toBeFalsy();
      const renameParsed = JSON.parse(renameMcpRes.content[0].text);
      expect(renameParsed.operation).toBe('rename');
      expect(renameParsed.newPath).toBe('McpRenamed.md');

      // Delete via MCP
      const deleteMcpRes = await handleMcpToolCall(workspace, 'openob_delete_note', {
        path: 'McpRenamed.md',
        expectedVersion: { token: renameParsed.currentVersion.token },
      });

      expect(deleteMcpRes.isError).toBeFalsy();
      const deleteParsed = JSON.parse(deleteMcpRes.content[0].text);
      expect(deleteParsed.operation).toBe('delete');
      expect(deleteParsed.path).toBe('McpRenamed.md');

      await expect(workspace.readNote('McpRenamed.md')).rejects.toThrow(NotFoundError);
    });
  });
});
