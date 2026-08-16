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

  it('rejects reading and writing via symlink targeting prefix-sharing sibling (P1-FS-001)', async () => {
    // Sibling directory sharing vault prefix: e.g. <tmpVaultDir>-evil
    const siblingEvilDir = `${tmpVaultDir}-evil`;
    await fs.mkdir(siblingEvilDir, { recursive: true });
    await fs.writeFile(path.join(siblingEvilDir, 'leak.md'), '# SECRET OUTSIDE VAULT', 'utf8');

    try {
      const vault = new NodeFsVaultStorage(tmpVaultDir);

      // Create a link inside the vault targeting the prefix-sharing sibling
      const linkInside = path.join(tmpVaultDir, 'escape');
      try {
        await fs.symlink(siblingEvilDir, linkInside, 'junction');
      } catch {
        return; // Skip if OS denies junction creation
      }

      // 1. Reading through prefix-sharing link MUST throw SecurityError
      await expect(vault.read('escape/leak.md')).rejects.toThrow(SecurityError);

      // 2. Writing through prefix-sharing link MUST throw SecurityError
      await expect(vault.write('escape/attack.md', null, 'MALICIOUS_CONTENT')).rejects.toThrow(
        SecurityError
      );

      // 3. Stat through prefix-sharing link MUST throw SecurityError
      await expect(vault.stat('escape/leak.md')).rejects.toThrow(SecurityError);

      // 4. Exists through prefix-sharing link MUST throw SecurityError
      await expect(vault.exists('escape/leak.md')).rejects.toThrow(SecurityError);

      // Verify external file was never written
      expect(
        await fs
          .access(path.join(siblingEvilDir, 'attack.md'))
          .then(() => true)
          .catch(() => false)
      ).toBe(false);
    } finally {
      try {
        await fs.rm(siblingEvilDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
