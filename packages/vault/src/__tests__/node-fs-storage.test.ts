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
    const res1 = await vault.write('notes/sample.md', null, '# Real Disk Note\nTesting atomic write.');
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
    await expect(
      vault.write('test.md', res1.snapshot.version, 'App content v3')
    ).rejects.toThrow(ConflictError);

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
});
