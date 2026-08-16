import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '@okw/core';
import { NodeFsVaultStorage } from '../node-fs-storage.js';

describe('NodeFsVaultStorage (Real Filesystem)', () => {
  let tmpDir: string;
  let vault: NodeFsVaultStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-vault-test-'));
    vault = new NodeFsVaultStorage(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('performs atomic writes and reads on disk', async () => {
    const res1 = await vault.write(
      'notes/sample.md',
      null,
      '# Real Disk Note\nTesting atomic write.'
    );
    expect(res1.wasCreated).toBe(true);

    const onDisk = await fs.readFile(path.join(tmpDir, 'notes', 'sample.md'), 'utf8');
    expect(onDisk).toBe('# Real Disk Note\nTesting atomic write.');

    const readSnap = await vault.read('notes/sample.md');
    expect(readSnap.textContent).toBe('# Real Disk Note\nTesting atomic write.');
  });

  it('catches external disk modification conflict', async () => {
    const res1 = await vault.write('test.md', null, 'App content v1');

    // External tool modifies the file on disk
    await fs.writeFile(path.join(tmpDir, 'test.md'), 'External tool edit v2');

    // App attempts save with stale res1 version
    await expect(vault.write('test.md', res1.snapshot.version, 'App content v3')).rejects.toThrow(
      ConflictError
    );

    // Verify external edit was preserved
    const text = await vault.readText('test.md');
    expect(text).toBe('External tool edit v2');
  });

  it('lists directories recursively and handles moves', async () => {
    await vault.write('folder1/noteA.md', null, 'A');
    await vault.write('folder1/sub/noteB.md', null, 'B');
    await vault.write('root.md', null, 'Root');

    const list = await vault.list('', true);
    expect(list.map((e) => e.path)).toEqual([
      'folder1',
      'folder1/sub',
      'folder1/noteA.md',
      'folder1/sub/noteB.md',
      'root.md',
    ]);

    await vault.move('folder1/noteA.md', 'folder1/noteA_renamed.md');
    expect(await vault.exists('folder1/noteA.md')).toBe(false);
    expect(await vault.exists('folder1/noteA_renamed.md')).toBe(true);
  });

  it('preserves UTF-8 BOM across read, edit, and save cycle (P2-DL-002)', async () => {
    const bomString = '\uFEFF# Title with BOM\nInitial content';
    const res1 = await vault.write('bom-note.md', null, bomString);

    // Check disk bytes
    const diskBytes1 = await fs.readFile(path.join(tmpDir, 'bom-note.md'));
    expect([...diskBytes1.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    // Read through vault storage
    const snap1 = await vault.read('bom-note.md');
    expect(snap1.hasBom).toBe(true);
    expect(snap1.textContent).toBe(bomString);

    // Edit content (retaining or modifying string)
    const editedString = snap1.textContent + '\nEdited content.';
    await vault.write('bom-note.md', snap1.version, editedString);

    // Check disk bytes after save
    const diskBytes2 = await fs.readFile(path.join(tmpDir, 'bom-note.md'));
    expect([...diskBytes2.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const snap2 = await vault.read('bom-note.md');
    expect(snap2.hasBom).toBe(true);
    expect(snap2.textContent).toBe(editedString);
  });
});
