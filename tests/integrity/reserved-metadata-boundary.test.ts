import { ChildProcess, execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReservedWorkspacePath, RESERVED_WORKSPACE_PREFIX } from '@okw/core';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { MemoryVaultStorage, NodeFsVaultStorage } from '@okw/vault';
import {
  ClientContext,
  ForbiddenError,
  InvalidPathError,
  OpenObGatewayClient,
  OpenObWorkspace,
} from '@okw/workspace';

const BUILD_SCRIPT = path.resolve(__dirname, '../../apps/gateway/build.js');

function spawnGatewayProcess(
  binPath: string,
  vaultDir: string,
  extraArgs: string[] = []
): { child: ChildProcess; ready: Promise<{ port: number; url: string }> } {
  const child = spawn(process.execPath, [binPath, vaultDir, '--port', '0', ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const ready = new Promise<{ port: number; url: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for gateway to start. Stderr:\n${stderr}`));
    }, 10000);

    child.stdout?.on('data', (data) => {
      const msg = data.toString();
      const match = msg.match(/Listening on (http:\/\/127\.0\.0\.1:(\d+))/);
      if (match) {
        clearTimeout(timeout);
        resolve({ port: parseInt(match[2], 10), url: match[1] });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Child error: ${err.message}. Stderr:\n${stderr}`));
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Child exited prematurely with code ${code}. Stderr:\n${stderr}`));
    });
  });

  return { child, ready };
}

describe('P3E-P4 Reserved .openob Metadata Namespace Isolation', () => {
  describe('1. In-Process OpenObWorkspace Note API Boundary Matrix', () => {
    let storage: MemoryVaultStorage;
    let index: MemoryDocumentIndex;
    let workspace: OpenObWorkspace;

    beforeAll(async () => {
      storage = new MemoryVaultStorage();
      index = new MemoryDocumentIndex();
      workspace = new OpenObWorkspace({
        storage,
        index,
        readOnly: false,
      });

      // Seed ordinary notes
      await workspace.createNote({ path: 'Notes/TaskA.md', content: '# Task A\nStatus: active' });
      await workspace.createNote({ path: 'Notes/TaskB.md', content: '# Task B\nStatus: done' });
    });

    it('1.1 Exact constant & reserved path matcher semantics across all case variants', () => {
      expect(RESERVED_WORKSPACE_PREFIX).toBe('.openob');

      // Exact and child paths across case variants (P1)
      const exactAndChildPaths = [
        '.openob',
        '.openob/',
        '.openob/views/view_1.json',
        '.openob/evil.md',
        '.openob/nested/deep/file.json',
        '.OPENOB',
        '.OPENOB/',
        '.OPENOB/views/view_1.json',
        '.OPENOB/evil.md',
        '.OpenOb',
        '.OpenOb/',
        '.OpenOb/views/view_1.json',
        '.oPeNoB',
        '.oPeNoB/',
        '.oPeNoB/evil.md',
      ];
      for (const p of exactAndChildPaths) {
        expect(isReservedWorkspacePath(p)).toBe(true);
      }

      // Normalized aliases across case variants
      const aliasPaths = [
        './.openob/views/view_1.json',
        'foo/../.openob/views/view_1.json',
        '.openob\\views\\view_1.json',
        '/.openob/views/view_1.json',
        '/.openob',
        './.openob',
        './.OPENOB/views/view_1.json',
        'foo/../.OPENOB/views/view_1.json',
        '.OPENOB\\views\\view_1.json',
        '/.OPENOB/views/view_1.json',
        '/.OpenOb',
        './.oPeNoB',
      ];
      for (const p of aliasPaths) {
        expect(isReservedWorkspacePath(p)).toBe(true);
      }

      // Near-miss allowed names must NOT be rejected
      const nearMisses = [
        '.openobserver.md',
        '.OPENOBSERVER.md',
        '.OpenObserver.md',
        '.openob-notes/foo.md',
        '.OPENOB-NOTES/foo.md',
        'notes/.openobservation.md',
        'notes/.OPENOBservation.md',
        'foo.openob/bar.md',
        'foo.OPENOB/bar.md',
        'notes/ordinary.md',
        'ordinary.md',
      ];
      for (const p of nearMisses) {
        expect(isReservedWorkspacePath(p)).toBe(false);
      }
    });

    it('1.2 Near-miss note names can be created and read normally across case variants', async () => {
      const nearMiss1 = await workspace.createNote({
        path: '.openobserver.md',
        content: '# OpenObserver note',
      });
      expect(nearMiss1.path).toBe('.openobserver.md');
      const read1 = await workspace.readNote('.openobserver.md');
      expect(read1.textContent).toBe('# OpenObserver note');

      const nearMiss2 = await workspace.createNote({
        path: '.OPENOBSERVER.md',
        content: '# Upper OpenObserver note',
      });
      expect(nearMiss2.path).toBe('.OPENOBSERVER.md');
      const read2 = await workspace.readNote('.OPENOBSERVER.md');
      expect(read2.textContent).toBe('# Upper OpenObserver note');

      const nearMiss3 = await workspace.createNote({
        path: '.openob-notes/foo.md',
        content: '# OpenOb Notes subfolder',
      });
      expect(nearMiss3.path).toBe('.openob-notes/foo.md');
      const read3 = await workspace.readNote('.openob-notes/foo.md');
      expect(read3.textContent).toBe('# OpenOb Notes subfolder');

      const nearMiss4 = await workspace.createNote({
        path: 'foo.OPENOB/bar.md',
        content: '# Suffix dot note',
      });
      expect(nearMiss4.path).toBe('foo.OPENOB/bar.md');
      const read4 = await workspace.readNote('foo.OPENOB/bar.md');
      expect(read4.textContent).toBe('# Suffix dot note');
    });

    it('1.3 All Note CRUD operations reject reserved .openob paths with InvalidPathError across case variants', async () => {
      const attackPaths = [
        // Lowercase
        '.openob',
        '.openob/',
        '.openob/evil.md',
        '.openob/views/injected.json',
        './.openob/views/injected.json',
        'foo/../.openob/views/injected.json',
        '.openob\\views\\injected.json',
        '/.openob/views/injected.json',
        // Uppercase
        '.OPENOB',
        '.OPENOB/',
        '.OPENOB/evil.md',
        '.OPENOB/views/injected.json',
        './.OPENOB/views/injected.json',
        'foo/../.OPENOB/views/injected.json',
        '.OPENOB\\views\\injected.json',
        '/.OPENOB/views/injected.json',
        // Titlecase & Mixed
        '.OpenOb',
        '.OpenOb/',
        '.OpenOb/views/injected.json',
        '.oPeNoB',
        '.oPeNoB/evil.md',
      ];

      for (const p of attackPaths) {
        // readNote
        await expect(workspace.readNote(p)).rejects.toThrow(InvalidPathError);

        // getNoteMetadata
        await expect(workspace.getNoteMetadata(p)).rejects.toThrow(InvalidPathError);

        // createNote
        await expect(workspace.createNote({ path: p, content: '# Evil' })).rejects.toThrow(
          InvalidPathError
        );

        // updateNote
        await expect(
          workspace.updateNote({ path: p, content: '# Updated', expectedVersion: { token: 'tok' } })
        ).rejects.toThrow(InvalidPathError);

        // setProperty
        await expect(
          workspace.setProperty({
            path: p,
            key: 'status',
            value: 'hacked',
            expectedVersion: { token: 'tok' },
          })
        ).rejects.toThrow(InvalidPathError);

        // renameNote (destination attack)
        await expect(
          workspace.renameNote({
            oldPath: 'Notes/TaskA.md',
            newPath: p,
            expectedVersion: { token: 'tok' },
          })
        ).rejects.toThrow(InvalidPathError);

        // renameNote (source attack)
        await expect(
          workspace.renameNote({
            oldPath: p,
            newPath: 'Notes/Stolen.md',
            expectedVersion: { token: 'tok' },
          })
        ).rejects.toThrow(InvalidPathError);

        // deleteNote
        await expect(
          workspace.deleteNote({ path: p, expectedVersion: { token: 'tok' } })
        ).rejects.toThrow(InvalidPathError);

        // getBacklinks
        await expect(workspace.getBacklinks(p)).rejects.toThrow(InvalidPathError);

        // getOutgoingLinks
        await expect(workspace.getOutgoingLinks(p)).rejects.toThrow(InvalidPathError);

        // getProperties
        await expect(workspace.getProperties(p)).rejects.toThrow(InvalidPathError);

        // getGraphNeighbors
        await expect(workspace.getGraphNeighbors(p)).rejects.toThrow(InvalidPathError);
      }
    });

    it('1.4 listEntries rejects explicit .openob path across case variants and omits .openob from root listings', async () => {
      // listEntries on case variants must throw InvalidPathError
      await expect(workspace.listEntries('.openob')).rejects.toThrow(InvalidPathError);
      await expect(workspace.listEntries('.OPENOB')).rejects.toThrow(InvalidPathError);
      await expect(workspace.listEntries('.OpenOb')).rejects.toThrow(InvalidPathError);
      await expect(workspace.listEntries('.oPeNoB')).rejects.toThrow(InvalidPathError);
      await expect(workspace.listEntries('.openob/views')).rejects.toThrow(InvalidPathError);
      await expect(workspace.listEntries('.OPENOB/views')).rejects.toThrow(InvalidPathError);

      // listEntries('') root listing must not include .openob in any casing
      const entries = await workspace.listEntries('');
      const openobEntries = entries.filter((e) => isReservedWorkspacePath(e.path));
      expect(openobEntries.length).toBe(0);
    });

    it('1.5 Legitimate Saved View APIs continue to work in .openob/views/', async () => {
      // 1. createSavedView
      const created = await workspace.createSavedView({
        name: 'Sprint Tasks',
        type: 'table',
      });
      expect(created.view.id).toMatch(/^view_/);
      expect(created.view.name).toBe('Sprint Tasks');

      // Verify file exists on underlying storage under .openob/views/
      const existsOnStorage = await storage.exists(`.openob/views/${created.view.id}.json`);
      expect(existsOnStorage).toBe(true);

      // 2. getSavedView
      const fetched = await workspace.getSavedView(created.view.id);
      expect(fetched.view.name).toBe('Sprint Tasks');

      // 3. listSavedViews
      const views = await workspace.listSavedViews();
      expect(views.some((v) => v.view.id === created.view.id)).toBe(true);

      // 4. updateSavedView
      const updated = await workspace.updateSavedView(created.view.id, {
        name: 'Sprint Tasks Updated',
        expectedVersion: created.version,
      });
      expect(updated.view.name).toBe('Sprint Tasks Updated');

      // 5. runSavedView
      const runResult = await workspace.runSavedView(created.view.id);
      expect(runResult.rows).toBeDefined();

      // 6. deleteSavedView
      const deleteResult = await workspace.deleteSavedView(created.view.id, {
        expectedVersion: updated.version,
      });
      expect(deleteResult.durableSuccess).toBe(true);
      expect(await storage.exists(`.openob/views/${created.view.id}.json`)).toBe(false);
    });

    it('1.6 Rebuilder skips any .openob metadata files even if injected into storage', async () => {
      // Directly inject markdown files inside .openob with various casings
      await storage.write(
        '.openob/evil.md',
        undefined,
        '# Injected Secret\nShould never be indexed'
      );
      await storage.write(
        '.OPENOB/uppercase.md',
        undefined,
        '# Upper Injected\nShould never be indexed'
      );

      // Verify rebuilder ignores them
      const rebuiltIndex = new MemoryDocumentIndex();
      await rebuildVaultIndex(storage, rebuiltIndex);

      expect(await rebuiltIndex.get('.openob/evil.md')).toBeNull();
      expect(await rebuiltIndex.get('.OPENOB/uppercase.md')).toBeNull();

      const searchResults = await rebuiltIndex.query({ query: 'Injected' });
      expect(searchResults.length).toBe(0);
    });
  });

  describe('2. Cross-Scope Capability Proof', () => {
    let storage: MemoryVaultStorage;
    let index: MemoryDocumentIndex;
    let workspace: OpenObWorkspace;
    let testViewId: string;

    beforeAll(async () => {
      storage = new MemoryVaultStorage();
      index = new MemoryDocumentIndex();
      workspace = new OpenObWorkspace({
        storage,
        index,
        readOnly: false,
      });

      const view = await workspace.createSavedView({
        name: 'Protected View',
        type: 'board',
      });
      testViewId = view.view.id;
    });

    it('2.1 Client with workspace.write but WITHOUT workspace.views.write cannot mutate views nor access .openob via note APIs', async () => {
      const noteWriteOnlyContext: ClientContext = {
        requestId: 'req-note-write-1',
        clientId: 'note-writer',
        timestamp: Date.now(),
        scopes: ['workspace.read', 'workspace.write', 'workspace.rename', 'workspace.delete'],
      };

      // CAN create ordinary note
      const note = await workspace.createNote(
        { path: 'Notes/Allowed.md', content: '# Allowed' },
        noteWriteOnlyContext
      );
      expect(note.path).toBe('Notes/Allowed.md');

      // CANNOT create saved view (ForbiddenError due to lack of workspace.views.write)
      await expect(
        workspace.createSavedView(
          { name: 'Unauthorized View', type: 'table' },
          noteWriteOnlyContext
        )
      ).rejects.toThrow(ForbiddenError);

      // CANNOT delete saved view
      await expect(
        workspace.deleteSavedView(
          testViewId,
          { expectedVersion: { token: 'tok' } },
          noteWriteOnlyContext
        )
      ).rejects.toThrow(ForbiddenError);

      // CANNOT touch .openob through note API across case variants (InvalidPathError)
      await expect(
        workspace.readNote(`.openob/views/${testViewId}.json`, noteWriteOnlyContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.readNote(`.OPENOB/views/${testViewId}.json`, noteWriteOnlyContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.createNote(
          { path: `.openob/views/view_evil.json`, content: '{}' },
          noteWriteOnlyContext
        )
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.createNote(
          { path: `.OpenOb/views/view_evil.json`, content: '{}' },
          noteWriteOnlyContext
        )
      ).rejects.toThrow(InvalidPathError);
    });

    it('2.2 Client WITH workspace.views.write CAN manage views, but STILL CANNOT access .openob through note APIs', async () => {
      const viewsWriteContext: ClientContext = {
        requestId: 'req-views-write-1',
        clientId: 'views-admin',
        timestamp: Date.now(),
        scopes: ['workspace.read', 'workspace.views.write', 'workspace.write', 'workspace.delete'],
      };

      // CAN create saved view
      const v = await workspace.createSavedView(
        { name: 'Admin View', type: 'table' },
        viewsWriteContext
      );
      expect(v.view.name).toBe('Admin View');

      // BUT STILL CANNOT access .openob through note APIs across case variants
      await expect(
        workspace.readNote(`.openob/views/${v.view.id}.json`, viewsWriteContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.readNote(`.OPENOB/views/${v.view.id}.json`, viewsWriteContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.createNote({ path: '.openob/evil.md', content: '# Hacked' }, viewsWriteContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.createNote({ path: '.OpenOb/evil.md', content: '# Hacked' }, viewsWriteContext)
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.deleteNote(
          { path: `.openob/views/${v.view.id}.json`, expectedVersion: { token: 'tok' } },
          viewsWriteContext
        )
      ).rejects.toThrow(InvalidPathError);

      await expect(
        workspace.deleteNote(
          { path: `.OPENOB/views/${v.view.id}.json`, expectedVersion: { token: 'tok' } },
          viewsWriteContext
        )
      ).rejects.toThrow(InvalidPathError);
    });
  });

  describe('3. Real Spawned Gateway Process REST Attack Reproduction (P3E-P4)', () => {
    let tempDist: string;
    let gatewayBin: string;
    let tempVaultDir: string;
    let gatewayChild: ChildProcess;
    let gatewayUrl: string;
    let validToken: string;
    let testViewId: string;
    let originalViewHash: string;
    let originalViewPath: string;

    beforeAll(async () => {
      // 1. Build an isolated production gateway artifact specifically for this test suite
      tempDist = path.resolve(
        __dirname,
        `../../apps/gateway/.dist-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [BUILD_SCRIPT, '--outdir', tempDist], (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`Failed to build gateway into isolated dist: ${stderr || stdout}`));
          } else {
            resolve();
          }
        });
      });
      gatewayBin = path.join(tempDist, 'bin/gateway.js');

      // 2. Create isolated temporary vault
      tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-boundary-vault-'));
      validToken = 'test-token-p3e-p4-boundary';

      // Seed ordinary notes
      await fs.writeFile(
        path.join(tempVaultDir, 'Ordinary.md'),
        '---\ntitle: Ordinary Note\nstatus: active\n---\n# Ordinary Note Content\nSome body text.'
      );

      // Seed a legitimate saved view directly into .openob/views/
      const viewsDir = path.join(tempVaultDir, '.openob', 'views');
      await fs.mkdir(viewsDir, { recursive: true });

      testViewId = 'view_legitimate_001';
      originalViewPath = path.join(viewsDir, `${testViewId}.json`);
      const viewContent = JSON.stringify(
        {
          schemaVersion: 1,
          id: testViewId,
          name: 'Legitimate Sprint View',
          type: 'board',
          groupBy: 'status',
          filters: [],
          sorts: [],
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        null,
        2
      );
      await fs.writeFile(originalViewPath, viewContent, 'utf8');
      originalViewHash = crypto.createHash('sha256').update(viewContent).digest('hex');

      // Spawn real built gateway with note write and view write scopes
      const { child, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
        '--token',
        validToken,
        '--scopes',
        'workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete,workspace.views.write',
      ]);
      gatewayChild = child;
      const { url } = await ready;
      gatewayUrl = url;
    });

    afterAll(async () => {
      if (gatewayChild) {
        gatewayChild.kill('SIGTERM');
      }
      if (tempDist) {
        await fs.rm(tempDist, { recursive: true, force: true }).catch(() => {});
      }
      if (tempVaultDir) {
        await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('3.1 Attacking Note REST APIs against .openob/ across case variants returns 400 INVALID_PATH', async () => {
      // 1. GET /api/v1/notes/.openob/views/<id>.json & case variants
      const getVariants = [
        `${gatewayUrl}/api/v1/notes/.openob/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OPENOB/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OpenOb/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.oPeNoB/views/${testViewId}.json`,
      ];
      for (const url of getVariants) {
        const getRes = await fetch(url, {
          headers: { Authorization: `Bearer ${validToken}` },
        });
        expect(getRes.status).toBe(400);
        const getBody = (await getRes.json()) as any;
        expect(getBody.code).toBe('INVALID_PATH');
        expect(getBody.message).toContain('reserved OpenOb metadata namespace');
      }

      // 2. POST /api/v1/notes (Injecting saved view JSON via note create across case variants)
      const postPaths = [
        '.openob/views/view_injected.json',
        '.OPENOB/views/view_injected.json',
        '.OpenOb/views/view_injected.json',
      ];
      for (const p of postPaths) {
        const postRes = await fetch(`${gatewayUrl}/api/v1/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: p,
            content: '{"name": "Injected View", "type": "table"}',
          }),
        });
        expect(postRes.status).toBe(400);
        const postBody = (await postRes.json()) as any;
        expect(postBody.code).toBe('INVALID_PATH');
      }

      // 3. PUT /api/v1/notes/.openob/views/<id>.json (Overwriting view via note update across case variants)
      const putVariants = [
        `${gatewayUrl}/api/v1/notes/.openob/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OPENOB/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OpenOb/views/${testViewId}.json`,
      ];
      for (const url of putVariants) {
        const putRes = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: '{"hacked": true}',
            expectedVersion: { token: 'any' },
          }),
        });
        expect(putRes.status).toBe(400);
        const putBody = (await putRes.json()) as any;
        expect(putBody.code).toBe('INVALID_PATH');
      }

      // 4. POST /api/v1/notes (Creating .openob/evil.md across case variants)
      const evilPaths = [
        '.openob/evil.md',
        '.OPENOB/evil.md',
        '.OpenOb/evil.md',
        '.oPeNoB/evil.md',
      ];
      for (const p of evilPaths) {
        const evilNoteRes = await fetch(`${gatewayUrl}/api/v1/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: p,
            content: '# Evil Backdoor',
          }),
        });
        expect(evilNoteRes.status).toBe(400);
        const evilNoteBody = (await evilNoteRes.json()) as any;
        expect(evilNoteBody.code).toBe('INVALID_PATH');
      }

      // 5. POST /api/v1/notes/Ordinary.md/rename (Renaming ordinary note into .OPENOB/stolen.md)
      const renameDestRes = await fetch(`${gatewayUrl}/api/v1/notes/Ordinary.md/rename`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPath: '.OPENOB/stolen.md',
          expectedVersion: { token: 'any' },
        }),
      });
      expect(renameDestRes.status).toBe(400);
      const renameDestBody = (await renameDestRes.json()) as any;
      expect(renameDestBody.code).toBe('INVALID_PATH');

      // 6. POST /api/v1/notes/.OPENOB%2Fviews%2F<id>.json/rename (Renaming view to ordinary note)
      const renameSrcRes = await fetch(
        `${gatewayUrl}/api/v1/notes/.OPENOB%2Fviews%2F${testViewId}.json/rename`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            newPath: 'StolenView.md',
            expectedVersion: { token: 'any' },
          }),
        }
      );
      expect(renameSrcRes.status).toBe(400);
      const renameSrcBody = (await renameSrcRes.json()) as any;
      expect(renameSrcBody.code).toBe('INVALID_PATH');

      // 7. DELETE /api/v1/notes/.openob/views/<id>.json and case variants
      const deleteVariants = [
        `${gatewayUrl}/api/v1/notes/.openob/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OPENOB/views/${testViewId}.json`,
        `${gatewayUrl}/api/v1/notes/.OpenOb/evil.md`,
      ];
      for (const url of deleteVariants) {
        const deleteRes = await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'If-Match': '"some-tok"',
          },
        });
        expect(deleteRes.status).toBe(400);
        const deleteBody = (await deleteRes.json()) as any;
        expect(deleteBody.code).toBe('INVALID_PATH');
      }

      // 8. PATCH /api/v1/notes/.OPENOB%2Fviews%2F<id>.json/properties
      const patchRes = await fetch(
        `${gatewayUrl}/api/v1/notes/.OPENOB%2Fviews%2F${testViewId}.json/properties`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: 'corrupted',
            value: true,
            expectedVersion: { token: 'any' },
          }),
        }
      );
      expect(patchRes.status).toBe(400);
      const patchBody = (await patchRes.json()) as any;
      expect(patchBody.code).toBe('INVALID_PATH');

      // 9. GET /api/v1/entries?path=.OPENOB
      const entriesVariants = [
        `${gatewayUrl}/api/v1/entries?path=.openob`,
        `${gatewayUrl}/api/v1/entries?path=.OPENOB`,
        `${gatewayUrl}/api/v1/entries?path=.OpenOb`,
        `${gatewayUrl}/api/v1/entries?path=.oPeNoB`,
      ];
      for (const url of entriesVariants) {
        const entriesRes = await fetch(url, {
          headers: { Authorization: `Bearer ${validToken}` },
        });
        expect(entriesRes.status).toBe(400);
        const entriesBody = (await entriesRes.json()) as any;
        expect(entriesBody.code).toBe('INVALID_PATH');
      }

      // 10. GET /api/v1/entries (root) omits .openob in any casing
      const rootEntriesRes = await fetch(`${gatewayUrl}/api/v1/entries`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      expect(rootEntriesRes.status).toBe(200);
      const rootEntries = (await rootEntriesRes.json()) as any[];
      expect(rootEntries.some((e) => isReservedWorkspacePath(e.path))).toBe(false);
    });

    it('3.2 Legitimate Saved View survives attack completely intact (Byte-for-byte SHA256 integrity)', async () => {
      // 1. Read on-disk file after all attacks
      const viewContentAfter = await fs.readFile(originalViewPath, 'utf8');
      const hashAfter = crypto.createHash('sha256').update(viewContentAfter).digest('hex');

      // Byte-for-byte identical
      expect(hashAfter).toBe(originalViewHash);

      // 2. Query through legitimate /api/v1/views endpoint
      const client = new OpenObGatewayClient({
        url: gatewayUrl,
        token: validToken,
        clientId: 'verifier',
      });

      const fetched = await client.getSavedView(testViewId);
      expect(fetched.view.id).toBe(testViewId);
      expect(fetched.view.name).toBe('Legitimate Sprint View');
      expect(fetched.view.type).toBe('board');

      // 3. Execute view query through /api/v1/views/:id/run
      const runResult = await client.runSavedView(testViewId);
      expect(runResult.rows).toBeDefined();
      expect(runResult.rows.length).toBeGreaterThan(0);
    });
  });
});
