import { execFile, spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('Gateway Process Packaging & Runtime Closure (Tests A-F)', () => {
  let tempDist: string;
  let gatewayBin: string;
  let cliBin: string;
  let tempVaultDir: string;

  beforeAll(async () => {
    // 1. Build an isolated production gateway artifact specifically for this test suite
    tempDist = path.resolve(
      __dirname,
      `../../apps/gateway/.dist-pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

    // 2. Create isolated temporary vault
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-gateway-packaging-'));
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      '# Welcome to OpenOb\n\nThis is a verified test note for gateway packaging.\n',
      'utf-8'
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

  it('TEST A: Real startup with plain Node -> stays alive, /health 200, auth enforced, workspace metadata valid', async () => {
    const token = 'test-secret-packaging-token-a';
    const { child, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, ['--token', token]);

    try {
      const { url } = await ready;

      // 1. GET /health -> 200 without auth
      const healthRes = await fetch(`${url}/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe('ok');
      expect(healthData.vault).toBe(path.basename(tempVaultDir));

      // 2. GET /api/v1/workspace without token -> 401
      const unauthRes = await fetch(`${url}/api/v1/workspace`);
      expect(unauthRes.status).toBe(401);

      // 3. GET /api/v1/workspace with valid token -> 200
      const authRes = await fetch(`${url}/api/v1/workspace`, {
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
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('TEST B: CLI against running gateway -> info, read, search work via REST without direct storage opening', async () => {
    const token = 'test-secret-packaging-token-b';
    const { child, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, ['--token', token]);

    try {
      const { url } = await ready;

      // 1. CLI info --json
      const infoOut = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [cliBin, '--url', url, '--token', token, 'info', '--json'],
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
          [cliBin, '--url', url, '--token', token, 'read', 'Welcome.md', '--json'],
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
          [cliBin, '--url', url, '--token', token, 'search', 'Welcome', '--json'],
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
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('TEST C: Invalid vault -> non-zero exit, diagnostic error on stderr, no hanging process', async () => {
    const nonExistentVault = path.join(os.tmpdir(), 'okw-nonexistent-vault-99999');

    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [gatewayBin, nonExistentVault, '--port', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
    const blockingServer = net.createServer();
    const occupiedPort = await new Promise<number>((resolve) => {
      blockingServer.listen(0, '127.0.0.1', () => {
        resolve((blockingServer.address() as net.AddressInfo).port);
      });
    });

    try {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [gatewayBin, tempVaultDir, '--port', String(occupiedPort)],
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
    const { child, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir);
    await ready;

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

  it('TEST F: Clean build proof -> building into fresh directory produces runnable executables', async () => {
    const tempDistF = path.resolve(
      __dirname,
      `../../apps/gateway/.dist-pkg-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    try {
      // 1. Run packaging build targeting clean tempDistF
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [BUILD_SCRIPT, '--outdir', tempDistF], (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || stdout));
          else resolve();
        });
      });

      // 2. Confirm artifacts exist
      const tempGatewayBin = path.join(tempDistF, 'bin/gateway.js');
      const tempCliBin = path.join(tempDistF, 'bin/cli.js');
      const gatewayStat = await fs.stat(tempGatewayBin);
      const cliStat = await fs.stat(tempCliBin);
      expect(gatewayStat.isFile()).toBe(true);
      expect(cliStat.isFile()).toBe(true);

      // 3. Run newly generated gateway artifact and verify /health
      const { child, ready } = spawnGatewayProcess(tempGatewayBin, tempVaultDir);
      try {
        const { url } = await ready;
        const res = await fetch(`${url}/health`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe('ok');
      } finally {
        child.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await fs.rm(tempDistF, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('TEST G: CLI Help & Unknown Command Process Invocations -> help/--help/-h/empty exit 0, unknown exits 1', async () => {
    // 1. `node CLI_BIN --help` -> exit 0
    const helpFlagRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [cliBin, '--help'], (err, stdout) => {
        resolve({ code: err ? ((err.code as number) ?? 1) : 0, stdout });
      });
    });
    expect(helpFlagRes.code).toBe(0);
    expect(helpFlagRes.stdout).toContain('OpenOb Local CLI');

    // 2. `node CLI_BIN -h` -> exit 0
    const shortHelpRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [cliBin, '-h'], (err, stdout) => {
        resolve({ code: err ? ((err.code as number) ?? 1) : 0, stdout });
      });
    });
    expect(shortHelpRes.code).toBe(0);
    expect(shortHelpRes.stdout).toContain('OpenOb Local CLI');

    // 3. `node CLI_BIN help` -> exit 0
    const helpCmdRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [cliBin, 'help'], (err, stdout) => {
        resolve({ code: err ? ((err.code as number) ?? 1) : 0, stdout });
      });
    });
    expect(helpCmdRes.code).toBe(0);
    expect(helpCmdRes.stdout).toContain('OpenOb Local CLI');

    // 4. `node CLI_BIN` (no command) -> exit 0
    const noCmdRes = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [cliBin], (err, stdout) => {
        resolve({ code: err ? ((err.code as number) ?? 1) : 0, stdout });
      });
    });
    expect(noCmdRes.code).toBe(0);
    expect(noCmdRes.stdout).toContain('OpenOb Local CLI');

    // 5. `node CLI_BIN unknown-command` -> exit 1 with error on stderr
    const unknownRes = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(process.execPath, [cliBin, 'invalid-unknown-cmd'], (err, stdout, stderr) => {
        resolve({
          code: err ? ((err.code as number) ?? 1) : 0,
          stderr: stderr || stdout,
        });
      });
    });
    expect(unknownRes.code).toBe(1);
    expect(unknownRes.stderr).toContain('Unknown command "invalid-unknown-cmd"');
  });
});
