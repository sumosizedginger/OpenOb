import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

describe('Gateway External Mutations Process-Level Suite (Phase 2A Real Artifacts)', () => {
  const GATEWAY_BIN = path.resolve(__dirname, '../../apps/gateway/dist/bin/gateway.js');
  const CLI_BIN = path.resolve(__dirname, '../../apps/gateway/dist/bin/cli.js');
  const BUILD_SCRIPT = path.resolve(__dirname, '../../apps/gateway/build.js');
  let tempVaultDir: string;

  async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close((err) => (err ? reject(err) : resolve(port)));
      });
    });
  }

  beforeAll(async () => {
    // 1. Compile real production artifacts via build script
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [BUILD_SCRIPT], (err, stdout, stderr) => {
        if (err) reject(new Error(`Packaging build failed: ${stderr || stdout}`));
        else resolve();
      });
    });

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
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('Exercises full mutation lifecycle (create -> update -> set-property -> disk verification -> stale 409) using real bundled binaries', async () => {
    const port = await getFreePort();
    const token = 'process-mutation-token-999';

    // 1. Spawn real production gateway binary with explicit mutation scopes
    const gatewayChild = spawn(
      process.execPath,
      [
        GATEWAY_BIN,
        tempVaultDir,
        '--port',
        String(port),
        '--token',
        token,
        '--scopes',
        'workspace.read,workspace.search,workspace.write,properties.write',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    try {
      // Wait for gateway startup
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Gateway startup timed out')), 5000);
        gatewayChild.stdout.on('data', (data) => {
          if (data.toString().includes('[OpenOb Gateway] Listening on')) {
            clearTimeout(timer);
            resolve();
          }
        });
        gatewayChild.stderr.on('data', (data) => {
          // Allow normal log lines on stderr
        });
      });

      const gatewayUrl = `http://127.0.0.1:${port}`;

      // 2. Create Note using real CLI binary
      const createRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            CLI_BIN,
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
            CLI_BIN,
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
            CLI_BIN,
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
            CLI_BIN,
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
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 15000);

  it('Default gateway starting with no --scopes starts read-only and rejects CLI mutations with 403', async () => {
    const port = await getFreePort();
    const token = 'readonly-token-abc';

    // Start gateway with DEFAULT scopes (read-only)
    const readOnlyGateway = spawn(
      process.execPath,
      [GATEWAY_BIN, tempVaultDir, '--port', String(port), '--token', token],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Gateway startup timed out')), 5000);
        readOnlyGateway.stdout.on('data', (data) => {
          if (data.toString().includes('[OpenOb Gateway] Listening on')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const gatewayUrl = `http://127.0.0.1:${port}`;

      // CLI create against default read-only gateway must receive 403 Forbidden and exit 1
      const cliRes = await new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            CLI_BIN,
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
      await new Promise((r) => setTimeout(r, 200));
    }
  });
});
