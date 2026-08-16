import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';

describe('Crash Injection & Atomic Write Durability (H-03 / F-002)', () => {
  let tmpDir: string;
  let vault: NodeFsVaultStorage;
  let writer: SafeWriter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-crash-test-'));
    vault = new NodeFsVaultStorage(tmpDir);
    writer = new SafeWriter(vault);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('ensures original note is 100% untouched when atomic write fails before rename', async () => {
    const originalContent =
      '# Important Canonical Document\nDo not corrupt this file under any circumstances.';
    const initial = await writer.safeSave('important.md', originalContent);

    // Simulate an interrupted write / crash:
    // Create an orphaned .tmp file simulating a process death mid-stream
    const diskPath = path.join(tmpDir, 'important.md');
    const orphanedTmp = `${diskPath}.12345.corrupt.tmp`;
    await fs.writeFile(orphanedTmp, 'PARTIAL CORRUPTED BYTES');

    // Read canonical note via storage
    const readBack = await vault.readText('important.md');
    expect(readBack).toBe(originalContent);

    // Verify version token remains valid for next safe save
    const secondSave = await writer.safeSave(
      'important.md',
      originalContent + '\n- Safe update after recovered crash.',
      { expectedVersion: initial.snapshot.version }
    );
    expect(secondSave.snapshot.textContent).toContain('Safe update after recovered crash.');

    const finalDiskText = await fs.readFile(diskPath, 'utf8');
    expect(finalDiskText).toContain('Safe update after recovered crash.');
  });
});
