import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecurityError } from '@okw/core';
import { NodeFsVaultStorage } from '@okw/vault';

describe('Symlink Security & Boundary Isolation (SEC-02)', () => {
  let tmpVaultDir: string;
  let tmpExternalDir: string;

  beforeEach(async () => {
    tmpVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-vault-sec-'));
    tmpExternalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-external-sec-'));
    // Secret file outside the vault
    await fs.writeFile(path.join(tmpExternalDir, 'secret.txt'), 'SUPER_SECRET_EXTERNAL_DATA');
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpVaultDir, { recursive: true, force: true });
      await fs.rm(tmpExternalDir, { recursive: true, force: true });
    } catch {}
  });

  it('rejects reading or writing through symlinks targeting outside vault', async () => {
    const vault = new NodeFsVaultStorage(tmpVaultDir);

    // Create a symlink inside vault pointing to external directory
    const symlinkPath = path.join(tmpVaultDir, 'external_link');
    try {
      await fs.symlink(tmpExternalDir, symlinkPath, 'junction');
    } catch {
      // If symlinks not permitted in test environment, test path traversal
      await expect(vault.read('../secret.txt')).rejects.toThrow(SecurityError);
      return;
    }

    // Attempting to read through symlink should be blocked
    await expect(vault.read('external_link/secret.txt')).rejects.toThrow(SecurityError);
  });
});
