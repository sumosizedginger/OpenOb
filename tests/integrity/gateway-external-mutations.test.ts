import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Gateway External Mutations Process-Level Suite (Phase 2A Real Artifacts)', () => {
  const BUILD_SCRIPT = path.resolve(__dirname, '../../apps/gateway/build.js');
  let tempDist: string;
  let gatewayBin: string;
  let cliBin: string;
  let tempVaultDir: string;

  function spawnGatewayProcess(
    binPath: string,
    vaultDir: string,
    extraArgs: string[] = []
  ): { child: ChildProcess; ready: Promise<{ port: number; url: string }> } {
    const child = spawn(process.execPath, [binPath, vaultDir, '--port', '0', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const ready = new Promise<{ port: number; url: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for gateway to start. Stderr:\n${stderr}`));
      }, 10000);

      child.stdout.on('data', (data) => {
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

  beforeAll(async () => {
    // 1. Build an isolated production gateway artifact specifically for this test suite
    tempDist = path.resolve(
      __dirname,
      `../../apps/gateway/.dist-mut-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    cliBin = path.join(tempDist, 'bin/cli.js');

    // 2. Create isolated temp vault directory
    tempVaultDir = path.resolve(__dirname, `../../.temp-mutation-vault-${Date.now()}`);
    await fs.mkdir(tempVaultDir, { recursive: true });
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      '# Welcome to OpenOb\n\nInitial note for mutation tests.\n',
      'utf8'
    );
  });

  afterAll(async () => {
    if (tempDist) {
      await fs.rm(tempDist, { recursive: true, force: true }).catch(() => {});
    }
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('Exercises full mutation lifecycle (create -> update -> set-property -> disk verification -> stale 409) using real bundled binaries', async () => {
    const token = 'process-mutation-token-999';

    // 1. Spawn real production gateway binary with explicit mutation scopes
    const { child: gatewayChild, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
      '--scopes',
      'workspace.read,workspace.search,workspace.write,properties.write',
    ]);

    try {
      const { url: gatewayUrl } = await ready;

      // 2. Create Note using real CLI binary
      const createRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            cliBin,
            '--url',
            gatewayUrl,
            '--token',
            token,
            'create',
            'CreatedByCli.md',
            '--content',
            'First line of text created by CLI.\n',
            '--json',
          ],
          (err, stdout) => {
            resolve({ code: err ? 1 : 0, stdout });
          }
        );
      });
      expect(createRes.code).toBe(0);
      const createdObj = JSON.parse(createRes.stdout);
      expect(createdObj.durableSuccess).toBe(true);
      expect(createdObj.path).toBe('CreatedByCli.md');

      const v1Token = createdObj.currentVersion.token;
      expect(v1Token).toBeDefined();

      // Verify canonical bytes on disk
      const diskContent1 = await fs.readFile(path.join(tempVaultDir, 'CreatedByCli.md'), 'utf8');
      expect(diskContent1).toBe('First line of text created by CLI.\n');

      // 3. Update Note using real CLI binary
      const updateRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            cliBin,
            '--url',
            gatewayUrl,
            '--token',
            token,
            'update',
            'CreatedByCli.md',
            '--expected-version',
            v1Token,
            '--content',
            'Second revision of text.\n',
            '--json',
          ],
          (err, stdout) => {
            resolve({ code: err ? 1 : 0, stdout });
          }
        );
      });
      expect(updateRes.code).toBe(0);
      const updatedObj = JSON.parse(updateRes.stdout);
      expect(updatedObj.durableSuccess).toBe(true);
      const v2Token = updatedObj.currentVersion.token;
      expect(v2Token).not.toBe(v1Token);

      // Verify canonical bytes on disk after update
      const diskContent2 = await fs.readFile(path.join(tempVaultDir, 'CreatedByCli.md'), 'utf8');
      expect(diskContent2).toBe('Second revision of text.\n');

      // 4. Set Property using real CLI binary
      const propRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            cliBin,
            '--url',
            gatewayUrl,
            '--token',
            token,
            'set-property',
            'CreatedByCli.md',
            'category',
            'testing',
            '--expected-version',
            v2Token,
            '--json',
          ],
          (err, stdout) => {
            resolve({ code: err ? 1 : 0, stdout });
          }
        );
      });
      expect(propRes.code).toBe(0);
      const propObj = JSON.parse(propRes.stdout);
      expect(propObj.operation).toBe('set_property');

      // Verify canonical frontmatter and body on disk
      const diskContent3 = await fs.readFile(path.join(tempVaultDir, 'CreatedByCli.md'), 'utf8');
      expect(diskContent3).toMatch(/category:\s*"?testing"?/);
      expect(diskContent3).toContain('Second revision of text.\n');

      // 5. Attempt Stale Update using v1 token -> must exit non-zero (409 Conflict)
      const staleRes = await new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            cliBin,
            '--url',
            gatewayUrl,
            '--token',
            token,
            'update',
            'CreatedByCli.md',
            '--expected-version',
            v1Token,
            '--content',
            'Stale update that must be rejected',
            '--json',
          ],
          (err, stdout, stderr) => {
            resolve({ code: err ? ((err.code as number) ?? 1) : 0, stderr: stderr || stdout });
          }
        );
      });
      expect(staleRes.code).toBe(1);
      expect(staleRes.stderr).toMatch(/Conflict on/);
      expect(staleRes.stderr).toMatch(/CreatedByCli\.md/);

      // Disk content remains unchanged
      const diskContent4 = await fs.readFile(path.join(tempVaultDir, 'CreatedByCli.md'), 'utf8');
      expect(diskContent4).toBe(diskContent3);
    } finally {
      gatewayChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 15000);

  it('Default gateway starting with no --scopes starts read-only and rejects CLI mutations with 403', async () => {
    const token = 'readonly-token-abc';

    // Start gateway with DEFAULT scopes (read-only)
    const { child: readOnlyGateway, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
    ]);

    try {
      const { url: gatewayUrl } = await ready;

      // CLI create against default read-only gateway must receive 403 Forbidden and exit 1
      const cliRes = await new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            cliBin,
            '--url',
            gatewayUrl,
            '--token',
            token,
            'create',
            'ShouldFail.md',
            '--content',
            'Test',
          ],
          (err, stdout, stderr) => {
            resolve({ code: err ? ((err.code as number) ?? 1) : 0, stderr: stderr || stdout });
          }
        );
      });
      expect(cliRes.code).toBe(1);
      expect(cliRes.stderr).toMatch(/Forbidden|403/);
    } finally {
      readOnlyGateway.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});
