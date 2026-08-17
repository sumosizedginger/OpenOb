import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const GATEWAY_BIN = path.resolve(__dirname, '../../apps/gateway/dist/bin/gateway.js');
const CLI_BIN = path.resolve(__dirname, '../../apps/gateway/dist/bin/cli.js');
const BUILD_SCRIPT = path.resolve(__dirname, '../../apps/gateway/build.js');

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('Gateway Process Packaging & Runtime Closure (Tests A-F)', () => {
  let tempVaultDir: string;

  beforeAll(async () => {
    // 1. Build production gateway artifacts using esbuild packaging script
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [BUILD_SCRIPT], (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Failed to build gateway: ${stderr || stdout}`));
        } else {
          resolve();
        }
      });
    });

    // 2. Create isolated temporary vault
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-gateway-packaging-'));
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      '# Welcome to OpenOb\n\nThis is a verified test note for gateway packaging.\n',
      'utf-8'
    );
  });

  afterAll(async () => {
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true });
    }
  });

  it('TEST A: Real startup with plain Node -> stays alive, /health 200, auth enforced, workspace metadata valid', async () => {
    const port = await getFreePort();
    const token = 'test-secret-packaging-token-a';

    const child = spawn(
      process.execPath,
      [GATEWAY_BIN, tempVaultDir, '--port', String(port), '--token', token],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    try {
      // Wait for server to announce listening
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for gateway to start'));
        }, 10000);

        child.stdout.on('data', (data) => {
          const msg = data.toString();
          if (msg.includes('[OpenOb Gateway] Listening on')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        child.on('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Child exited prematurely with code ${code}`));
        });
      });

      // 1. GET /health -> 200 without auth
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe('ok');
      expect(healthData.vault).toBe(path.basename(tempVaultDir));

      // 2. GET /api/v1/workspace without token -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`);
      expect(unauthRes.status).toBe(401);

      // 3. GET /api/v1/workspace with valid token -> 200
      const authRes = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(authRes.status).toBe(200);
      const wsData = await authRes.json();
      expect(wsData.readOnly).toBe(true);
      expect(wsData.noteCount).toBe(1);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('TEST B: CLI against running gateway -> info, read, search work via REST without direct storage opening', async () => {
    const port = await getFreePort();
    const token = 'test-secret-packaging-token-b';

    const child = spawn(
      process.execPath,
      [GATEWAY_BIN, tempVaultDir, '--port', String(port), '--token', token],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (data) => {
          if (data.toString().includes('[OpenOb Gateway] Listening on')) {
            resolve();
          }
        });
        child.on('exit', (code) => {
          reject(new Error(`Gateway exited early with code ${code}`));
        });
      });

      // 1. CLI info --json
      const infoOut = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [CLI_BIN, '--url', `http://127.0.0.1:${port}`, '--token', token, 'info', '--json'],
          (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || stdout));
            else resolve(stdout);
          }
        );
      });
      const infoParsed = JSON.parse(infoOut);
      expect(infoParsed.noteCount).toBe(1);
      expect(infoParsed.readOnly).toBe(true);

      // 2. CLI read Welcome.md --json
      const readOut = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            CLI_BIN,
            '--url',
            `http://127.0.0.1:${port}`,
            '--token',
            token,
            'read',
            'Welcome.md',
            '--json',
          ],
          (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || stdout));
            else resolve(stdout);
          }
        );
      });
      const readParsed = JSON.parse(readOut);
      expect(readParsed.textContent).toContain(
        'This is a verified test note for gateway packaging.'
      );

      // 3. CLI search Welcome --json
      const searchOut = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            CLI_BIN,
            '--url',
            `http://127.0.0.1:${port}`,
            '--token',
            token,
            'search',
            'Welcome',
            '--json',
          ],
          (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || stdout));
            else resolve(stdout);
          }
        );
      });
      const searchParsed = JSON.parse(searchOut);
      expect(searchParsed.total).toBe(1);
      expect(searchParsed.matches[0].path).toBe('Welcome.md');
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('TEST C: Invalid vault -> non-zero exit, diagnostic error on stderr, no hanging process', async () => {
    const port = await getFreePort();
    const nonExistentVault = path.join(os.tmpdir(), 'okw-nonexistent-vault-99999');

    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [GATEWAY_BIN, nonExistentVault, '--port', String(port)],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('exit', (code) => {
        resolve({ code, stderr });
      });
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/Error: Cannot access vault directory|is not a directory/);
  });

  it('TEST D: Occupied port -> non-zero exit, EADDRINUSE diagnostic on stderr, no hanging child', async () => {
    const occupiedPort = await getFreePort();
    const blockingServer = net.createServer();

    await new Promise<void>((resolve) => {
      blockingServer.listen(occupiedPort, '127.0.0.1', () => resolve());
    });

    try {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [GATEWAY_BIN, tempVaultDir, '--port', String(occupiedPort)],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );

        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('exit', (code) => {
          resolve({ code, stderr });
        });
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/EADDRINUSE|Failed to start server/);
    } finally {
      await new Promise<void>((resolve) => blockingServer.close(() => resolve()));
    }
  });

  it('TEST E: Graceful shutdown -> SIGTERM cleanly terminates without orphans or temp locks', async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, [GATEWAY_BIN, tempVaultDir, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve) => {
      child.stdout.on('data', (data) => {
        if (data.toString().includes('[OpenOb Gateway] Listening on')) {
          resolve();
        }
      });
    });

    // Send SIGTERM
    const exitCodePromise = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    child.kill('SIGTERM');
    const exitCode = await exitCodePromise;
    expect(exitCode === 0 || exitCode === null).toBe(true);

    // Verify no lockfiles or temp files created in temp vault
    const files = await fs.readdir(tempVaultDir);
    expect(files).toEqual(['Welcome.md']);
  });

  it('TEST F: Clean build proof -> deleting dist and rebuilding produces runnable executables', async () => {
    const distDir = path.resolve(__dirname, '../../apps/gateway/dist');

    // 1. Delete generated dist outputs
    await fs.rm(distDir, { recursive: true, force: true });
    expect(await fs.stat(distDir).catch(() => null)).toBeNull();

    // 2. Run packaging build
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [BUILD_SCRIPT], (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout));
        else resolve();
      });
    });

    // 3. Confirm artifacts exist
    const gatewayStat = await fs.stat(GATEWAY_BIN);
    const cliStat = await fs.stat(CLI_BIN);
    expect(gatewayStat.isFile()).toBe(true);
    expect(cliStat.isFile()).toBe(true);

    // 4. Run newly generated gateway artifact and verify /health
    const port = await getFreePort();
    const child = spawn(process.execPath, [GATEWAY_BIN, tempVaultDir, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await new Promise<void>((resolve) => {
        child.stdout.on('data', (data) => {
          if (data.toString().includes('[OpenOb Gateway] Listening on')) {
            resolve();
          }
        });
      });

      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('TEST G: CLI Help & Unknown Command Process Invocations -> help/--help/-h/empty exit 0, unknown exits 1', async () => {
    // 1. `node CLI_BIN --help` -> exit 0
    const helpFlagRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [CLI_BIN, '--help'], (err, stdout) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout });
      });
    });
    expect(helpFlagRes.code).toBe(0);
    expect(helpFlagRes.stdout).toContain('OpenOb Local CLI');

    // 2. `node CLI_BIN -h` -> exit 0
    const shortHelpRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [CLI_BIN, '-h'], (err, stdout) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout });
      });
    });
    expect(shortHelpRes.code).toBe(0);
    expect(shortHelpRes.stdout).toContain('OpenOb Local CLI');

    // 3. `node CLI_BIN help` -> exit 0
    const helpCmdRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [CLI_BIN, 'help'], (err, stdout) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout });
      });
    });
    expect(helpCmdRes.code).toBe(0);
    expect(helpCmdRes.stdout).toContain('OpenOb Local CLI');

    // 4. `node CLI_BIN` (no command) -> exit 0
    const noCmdRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [CLI_BIN], (err, stdout) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout });
      });
    });
    expect(noCmdRes.code).toBe(0);
    expect(noCmdRes.stdout).toContain('OpenOb Local CLI');

    // 5. `node CLI_BIN unknown-command` -> exit 1 with error on stderr
    const unknownRes = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(process.execPath, [CLI_BIN, 'invalid-unknown-cmd'], (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stderr: stderr || stdout,
        });
      });
    });
    expect(unknownRes.code).toBe(1);
    expect(unknownRes.stderr).toContain('Unknown command "invalid-unknown-cmd"');
  });
});
