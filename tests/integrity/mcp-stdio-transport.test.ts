import { ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Live MCP Stdio Transport (@okw/gateway openob-mcp)', () => {
  const BUILD_SCRIPT = path.resolve(__dirname, '../../apps/gateway/build.js');
  let tempDist: string;
  let gatewayBin: string;
  let mcpBin: string;
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

  async function createMcpClient(options: {
    url: string;
    token?: string;
    clientId?: string;
  }): Promise<{ client: Client; transport: StdioClientTransport }> {
    const args = [mcpBin, '--url', options.url];
    if (options.token) {
      args.push('--token', options.token);
    }
    if (options.clientId) {
      args.push('--client-id', options.clientId);
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
    });

    const client = new Client({
      name: 'mcp-integration-test-runner',
      version: '1.0.0',
    });

    await client.connect(transport);
    return { client, transport };
  }

  beforeAll(async () => {
    // 1. Build an isolated production bundle specifically for this test suite
    tempDist = path.resolve(
      __dirname,
      `../../apps/gateway/.dist-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    mcpBin = path.join(tempDist, 'bin/mcp.js');

    // 2. Create isolated temp vault directory
    tempVaultDir = path.resolve(__dirname, `../../.temp-mcp-vault-${Date.now()}`);
    await fs.mkdir(path.join(tempVaultDir, 'Folder'), { recursive: true });
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      '---\ntitle: Welcome Note\nstatus: active\n---\n# Welcome to OpenOb\n\nInitial note for live MCP stdio tests.\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(tempVaultDir, 'Folder/NoteA.md'),
      '# Note A\nLinks to [[Welcome]]\n',
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

  it('1. openob-mcp binary supports --help flag and exits 0', async () => {
    const res = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [mcpBin, '--help'], (err, stdout) => {
        resolve({ code: err ? 1 : 0, stdout });
      });
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('OpenOb MCP Server (Live Stdio Transport)');
    expect(res.stdout).toContain('OPENOB_URL');
  });

  it('2. MCP Client connects via StdioClientTransport and lists all 11 OpenOb tools', async () => {
    const token = 'mcp-list-token';
    const { child: gwChild, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
    ]);

    try {
      const { url: gwUrl } = await ready;
      const { client, transport } = await createMcpClient({ url: gwUrl, token });

      try {
        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(11);

        const toolNames = toolsResult.tools.map((t) => t.name);
        expect(toolNames).toContain('openob_workspace_info');
        expect(toolNames).toContain('openob_list_entries');
        expect(toolNames).toContain('openob_read_note');
        expect(toolNames).toContain('openob_search');
        expect(toolNames).toContain('openob_get_backlinks');
        expect(toolNames).toContain('openob_get_properties');
        expect(toolNames).toContain('openob_create_note');
        expect(toolNames).toContain('openob_update_note');
        expect(toolNames).toContain('openob_set_property');
        expect(toolNames).toContain('openob_rename_note');
        expect(toolNames).toContain('openob_delete_note');
      } finally {
        await client.close();
      }
    } finally {
      gwChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('3. Read and search tools execute cleanly against running gateway', async () => {
    const token = 'mcp-read-token';
    const { child: gwChild, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
    ]);

    try {
      const { url: gwUrl } = await ready;
      const { client } = await createMcpClient({ url: gwUrl, token });

      try {
        // A. openob_workspace_info
        const infoRes = await client.callTool({ name: 'openob_workspace_info', arguments: {} });
        expect(infoRes.isError).toBeFalsy();
        const info = JSON.parse((infoRes.content as any)[0].text);
        expect(info.noteCount).toBeGreaterThanOrEqual(2);
        expect(info.apiVersion).toBe('v1');

        // B. openob_list_entries
        const listRes = await client.callTool({ name: 'openob_list_entries', arguments: {} });
        expect(listRes.isError).toBeFalsy();
        const entries = JSON.parse((listRes.content as any)[0].text);
        expect(entries.some((e: any) => e.path === 'Welcome.md')).toBe(true);

        // C. openob_read_note
        const readRes = await client.callTool({
          name: 'openob_read_note',
          arguments: { path: 'Welcome.md' },
        });
        expect(readRes.isError).toBeFalsy();
        const note = JSON.parse((readRes.content as any)[0].text);
        expect(note.title).toBe('Welcome Note');
        expect(note.textContent).toContain('Initial note for live MCP stdio tests.');
        expect(note.version.token).toBeDefined();

        // D. openob_search
        const searchRes = await client.callTool({
          name: 'openob_search',
          arguments: { query: 'Initial note' },
        });
        expect(searchRes.isError).toBeFalsy();
        const searchData = JSON.parse((searchRes.content as any)[0].text);
        expect(searchData.total).toBeGreaterThanOrEqual(1);
        expect(searchData.matches.some((m: any) => m.path === 'Welcome.md')).toBe(true);

        // E. openob_get_backlinks
        const backlinkRes = await client.callTool({
          name: 'openob_get_backlinks',
          arguments: { path: 'Welcome.md' },
        });
        expect(backlinkRes.isError).toBeFalsy();
        const backlinks = JSON.parse((backlinkRes.content as any)[0].text);
        expect(backlinks.some((b: any) => b.sourcePath === 'Folder/NoteA.md')).toBe(true);

        // F. openob_get_properties
        const propRes = await client.callTool({
          name: 'openob_get_properties',
          arguments: { path: 'Welcome.md' },
        });
        expect(propRes.isError).toBeFalsy();
        const props = JSON.parse((propRes.content as any)[0].text);
        expect(props.properties.status).toBe('active');
      } finally {
        await client.close();
      }
    } finally {
      gwChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('4. Default read-only gateway rejects mutation tools with MCP isError and 403 status', async () => {
    const token = 'mcp-readonly-token';
    // Start gateway with default scopes (read-only)
    const { child: gwChild, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
    ]);

    try {
      const { url: gwUrl } = await ready;
      const { client } = await createMcpClient({ url: gwUrl, token });

      try {
        // Attempt create
        const createRes = await client.callTool({
          name: 'openob_create_note',
          arguments: { path: 'Forbidden.md', content: 'Blocked' },
        });
        expect(createRes.isError).toBe(true);
        const createErr = JSON.parse((createRes.content as any)[0].text);
        expect(createErr.error.status).toBe(403);

        // Attempt delete
        const deleteRes = await client.callTool({
          name: 'openob_delete_note',
          arguments: { path: 'Welcome.md', expectedVersion: { token: 'invalid' } },
        });
        expect(deleteRes.isError).toBe(true);
        const deleteErr = JSON.parse((deleteRes.content as any)[0].text);
        expect(deleteErr.error.status).toBe(403);
      } finally {
        await client.close();
      }
    } finally {
      gwChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('5. Full mutation lifecycle over live MCP stdio transport against write-enabled gateway', async () => {
    const token = 'mcp-write-token';
    const { child: gwChild, ready } = spawnGatewayProcess(gatewayBin, tempVaultDir, [
      '--token',
      token,
      '--scopes',
      'workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete',
    ]);

    try {
      const { url: gwUrl } = await ready;
      const { client } = await createMcpClient({ url: gwUrl, token });

      try {
        // A. Create note
        const createRes = await client.callTool({
          name: 'openob_create_note',
          arguments: {
            path: 'McpNote.md',
            content: '# MCP Note\nOriginal text from MCP.\n',
            properties: { author: 'mcp-agent' },
          },
        });
        expect(createRes.isError).toBeFalsy();
        const created = JSON.parse((createRes.content as any)[0].text);
        expect(created.durableSuccess).toBe(true);
        expect(created.path).toBe('McpNote.md');
        const v1 = created.currentVersion;

        // Verify disk content
        const disk1 = await fs.readFile(path.join(tempVaultDir, 'McpNote.md'), 'utf8');
        expect(disk1).toContain('Original text from MCP.');
        expect(disk1).toContain('author: mcp-agent');

        // B. Update note
        const updateRes = await client.callTool({
          name: 'openob_update_note',
          arguments: {
            path: 'McpNote.md',
            content: '# MCP Note\nUpdated text from MCP revision 2.\n',
            expectedVersion: v1,
          },
        });
        expect(updateRes.isError).toBeFalsy();
        const updated = JSON.parse((updateRes.content as any)[0].text);
        expect(updated.durableSuccess).toBe(true);
        const v2 = updated.currentVersion;
        expect(v2.token).not.toBe(v1.token);

        // Verify disk updated
        const disk2 = await fs.readFile(path.join(tempVaultDir, 'McpNote.md'), 'utf8');
        expect(disk2).toContain('Updated text from MCP revision 2.');

        // C. Set Property
        const propRes = await client.callTool({
          name: 'openob_set_property',
          arguments: {
            path: 'McpNote.md',
            key: 'status',
            value: 'published',
            expectedVersion: v2,
          },
        });
        expect(propRes.isError).toBeFalsy();
        const propData = JSON.parse((propRes.content as any)[0].text);
        const v3 = propData.currentVersion;

        // Verify property on disk
        const disk3 = await fs.readFile(path.join(tempVaultDir, 'McpNote.md'), 'utf8');
        expect(disk3).toMatch(/status:\s*"?published"?/);

        // D. Stale Update -> OCC Conflict (409)
        const staleRes = await client.callTool({
          name: 'openob_update_note',
          arguments: {
            path: 'McpNote.md',
            content: 'Stale attempt that must conflict',
            expectedVersion: v1, // STALE!
          },
        });
        expect(staleRes.isError).toBe(true);
        const staleErr = JSON.parse((staleRes.content as any)[0].text);
        expect(staleErr.error.status).toBe(409);
        expect(staleErr.error.code).toBe('CONFLICT');

        // E. Create referencing note to verify wikilink refactoring during rename
        await client.callTool({
          name: 'openob_create_note',
          arguments: {
            path: 'McpRef.md',
            content: 'Refers to [[McpNote]] in body text.',
          },
        });

        // F. Rename note
        const renameRes = await client.callTool({
          name: 'openob_rename_note',
          arguments: {
            oldPath: 'McpNote.md',
            newPath: 'McpRenamed.md',
            expectedVersion: v3,
            updateLinks: true,
          },
        });
        expect(renameRes.isError).toBeFalsy();
        const renamed = JSON.parse((renameRes.content as any)[0].text);
        expect(renamed.operation).toBe('rename');
        expect(renamed.newPath).toBe('McpRenamed.md');
        expect(renamed.updatedFiles).toContain('McpRef.md');
        const v4 = renamed.currentVersion;

        // Verify disk after rename
        await expect(fs.access(path.join(tempVaultDir, 'McpNote.md'))).rejects.toThrow();
        const renamedDisk = await fs.readFile(path.join(tempVaultDir, 'McpRenamed.md'), 'utf8');
        expect(renamedDisk).toContain('Updated text from MCP revision 2.');

        const refDisk = await fs.readFile(path.join(tempVaultDir, 'McpRef.md'), 'utf8');
        expect(refDisk).toContain('[[McpRenamed]]');

        // G. Delete note
        const deleteRes = await client.callTool({
          name: 'openob_delete_note',
          arguments: {
            path: 'McpRenamed.md',
            expectedVersion: v4,
          },
        });
        expect(deleteRes.isError).toBeFalsy();
        const deleted = JSON.parse((deleteRes.content as any)[0].text);
        expect(deleted.operation).toBe('delete');
        expect(deleted.path).toBe('McpRenamed.md');

        // Verify disk after delete
        await expect(fs.access(path.join(tempVaultDir, 'McpRenamed.md'))).rejects.toThrow();
      } finally {
        await client.close();
      }
    } finally {
      gwChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 25000);

  it('6. Offline / Unavailable gateway returns 503 GATEWAY_UNAVAILABLE as MCP tool error', async () => {
    // Port with no running gateway
    const offlineUrl = 'http://127.0.0.1:58888';
    const { client } = await createMcpClient({ url: offlineUrl, token: 'some-token' });

    try {
      const res = await client.callTool({
        name: 'openob_workspace_info',
        arguments: {},
      });
      expect(res.isError).toBe(true);
      const err = JSON.parse((res.content as any)[0].text);
      expect(err.error.status).toBe(503);
      expect(err.error.code).toBe('GATEWAY_UNAVAILABLE');
      expect(err.error.message).toContain('Unable to connect to OpenOb Gateway');
    } finally {
      await client.close();
    }
  });

  it('7. Single-Authority Invariant: openob-mcp source and artifact have zero storage/index access', async () => {
    const clientSource = await fs.readFile(
      path.resolve(__dirname, '../../apps/gateway/src/client.ts'),
      'utf8'
    );
    const mcpServerSource = await fs.readFile(
      path.resolve(__dirname, '../../apps/gateway/src/mcp-server.ts'),
      'utf8'
    );
    const mcpBinSource = await fs.readFile(
      path.resolve(__dirname, '../../apps/gateway/src/bin/mcp.ts'),
      'utf8'
    );

    const forbiddenConstructs = [
      'NodeFsVaultStorage',
      'BrowserFSAVaultStorage',
      'MemoryVaultStorage',
      'SafeWriter',
      'NoteWriteCoordinator',
      'DocumentIndex',
      'SQLiteDocumentIndex',
      'MemoryDocumentIndex',
      'fs.writeFile',
      'fs.unlink',
      'fs.rename',
      'storage.write',
      'storage.remove',
    ];

    for (const forbidden of forbiddenConstructs) {
      expect(clientSource).not.toContain(forbidden);
      expect(mcpServerSource).not.toContain(forbidden);
      expect(mcpBinSource).not.toContain(forbidden);
    }
  });
});
