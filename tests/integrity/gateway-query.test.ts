import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NodeFsVaultStorage } from '@okw/vault';
import { SqliteDocumentIndex } from '@okw/index';
import { OpenObWorkspace, OpenObGatewayClient, handleMcpToolCall } from '@okw/workspace';
import { createGatewayServer } from '../../apps/gateway/src/server.js';
import { runCli } from '../../apps/gateway/src/cli.js';

describe('Gateway REST, MCP & CLI Query Integration (Phase 3D)', () => {
  let tempVaultDir: string;
  let workspace: OpenObWorkspace;
  let server: http.Server;
  let serverUrl: string;
  let client: OpenObGatewayClient;
  const token = 'test-token-phase3d-query';

  beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-query-test-'));
    await fs.mkdir(path.join(tempVaultDir, 'Projects'), { recursive: true });
    await fs.mkdir(path.join(tempVaultDir, 'Archive'), { recursive: true });

    // Seed notes
    await fs.writeFile(
      path.join(tempVaultDir, 'Projects', 'Alpha.md'),
      `---
title: Project Alpha
status: active
priority: 1
score: 95.5
tags: [work, project]
---
# Project Alpha
Alpha content.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'Projects', 'Beta.md'),
      `---
title: Project Beta
status: done
priority: 2
score: 80
tags: [work]
---
# Project Beta
Beta content.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'Archive', 'OldTask.md'),
      `---
title: Old Task
status: archived
priority: 99
tags: [archive]
---
# Old Task
Archived note.`
    );

    const storage = new NodeFsVaultStorage(tempVaultDir);
    const index = await SqliteDocumentIndex.create();
    workspace = new OpenObWorkspace({
      vaultName: 'QueryVault',
      storage,
      index,
    });
    await workspace.rebuildIndex();

    server = createGatewayServer({ workspace, token });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as any;
    serverUrl = `http://127.0.0.1:${addr.port}`;
    client = new OpenObGatewayClient({ url: serverUrl, token });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await fs.rm(tempVaultDir, { recursive: true, force: true });
  });

  it('queries notes via REST client with folder scoping and filters', async () => {
    const res = await client.queryNotes({
      folderScope: 'Projects',
      filters: [{ field: 'status', operator: 'equals', value: 'active' }],
    });

    expect(res.total).toBe(1);
    expect(res.rows[0].title).toBe('Project Alpha');
    expect(res.rows[0].path).toBe('Projects/Alpha.md');
    expect(res.rows[0].properties.status).toBe('active');
    expect(res.indexStatus).toBe('verified');
  });

  it('queries notes with numeric comparisons and deterministic sort via REST', async () => {
    const res = await client.queryNotes({
      filters: [{ field: 'priority', operator: 'less_than', value: 10 }],
      sorts: [{ field: 'priority', direction: 'asc' }],
    });

    expect(res.total).toBe(2);
    expect(res.rows[0].title).toBe('Project Alpha');
    expect(res.rows[1].title).toBe('Project Beta');
  });

  it('discovers vault properties via REST client', async () => {
    const res = await client.discoverProperties();
    expect(res.properties).toContain('status');
    expect(res.properties).toContain('priority');
    expect(res.properties).toContain('score');
    expect(res.properties).toContain('tags');
    expect(res.indexStatus).toBe('verified');
  });

  it('executes openob_query_notes via MCP tool dispatch', async () => {
    const mcpRes = await handleMcpToolCall(workspace, 'openob_query_notes', {
      folderScope: 'Projects',
      sorts: [{ field: 'priority', direction: 'desc' }],
    });

    expect(mcpRes.isError).toBeFalsy();
    const data = JSON.parse(mcpRes.content[0].text);
    expect(data.total).toBe(2);
    expect(data.rows[0].title).toBe('Project Beta');
    expect(data.rows[1].title).toBe('Project Alpha');
  });

  it('runs openob query command via CLI with --json-query', async () => {
    const cliRes = await runCli({
      url: serverUrl,
      token,
      args: [
        'query',
        '--json-query',
        JSON.stringify({
          folderScope: 'Projects',
          filters: [{ field: 'priority', operator: 'equals', value: 1 }],
        }),
        '--json',
      ],
    });

    expect(cliRes.exitCode).toBe(0);
    const data = JSON.parse(cliRes.output);
    expect(data.total).toBe(1);
    expect(data.rows[0].title).toBe('Project Alpha');
  });

  it('runs openob query command via CLI with convenience flags', async () => {
    const cliRes = await runCli({
      url: serverUrl,
      token,
      args: ['query', '--folder', 'Projects', '--filter', 'status:equals:done', '--json'],
    });

    expect(cliRes.exitCode).toBe(0);
    const data = JSON.parse(cliRes.output);
    expect(data.total).toBe(1);
    expect(data.rows[0].title).toBe('Project Beta');
  });

  it('proves typed comparison semantics across REST, MCP, and CLI (R3D-1)', async () => {
    // 1. REST: target "2" (string) against numeric priority: 1, 2, 99 -> MUST NOT match any numeric priority
    const restStringTarget = await client.queryNotes({
      filters: [{ field: 'priority', operator: 'greater_than', value: '2' }],
    });
    expect(restStringTarget.total).toBe(0);

    // REST: target 2 (number) against numeric priority: 1, 2, 99 -> matches OldTask (priority: 99)
    const restNumTarget = await client.queryNotes({
      filters: [{ field: 'priority', operator: 'greater_than', value: 2 }],
    });
    expect(restNumTarget.total).toBe(1);
    expect(restNumTarget.rows[0].title).toBe('Old Task');

    // 2. MCP: target "2" (string) -> 0 matches; target 2 (number) -> 1 match
    const mcpStringTarget = await handleMcpToolCall(workspace, 'openob_query_notes', {
      filters: [{ field: 'priority', operator: 'greater_than', value: '2' }],
    });
    const mcpStrData = JSON.parse(mcpStringTarget.content[0].text);
    expect(mcpStrData.total).toBe(0);

    const mcpNumTarget = await handleMcpToolCall(workspace, 'openob_query_notes', {
      filters: [{ field: 'priority', operator: 'greater_than', value: 2 }],
    });
    const mcpNumData = JSON.parse(mcpNumTarget.content[0].text);
    expect(mcpNumData.total).toBe(1);
    expect(mcpNumData.rows[0].title).toBe('Old Task');

    // 3. CLI: target "2" (string) via --json-query -> 0 matches; target 2 (number) -> 1 match
    const cliStrRes = await runCli({
      url: serverUrl,
      token,
      args: [
        'query',
        '--json-query',
        JSON.stringify({
          filters: [{ field: 'priority', operator: 'greater_than', value: '2' }],
        }),
        '--json',
      ],
    });
    expect(cliStrRes.exitCode).toBe(0);
    const cliStrData = JSON.parse(cliStrRes.output);
    expect(cliStrData.total).toBe(0);

    const cliNumRes = await runCli({
      url: serverUrl,
      token,
      args: [
        'query',
        '--json-query',
        JSON.stringify({
          filters: [{ field: 'priority', operator: 'greater_than', value: 2 }],
        }),
        '--json',
      ],
    });
    expect(cliNumRes.exitCode).toBe(0);
    const cliNumData = JSON.parse(cliNumRes.output);
    expect(cliNumData.total).toBe(1);
    expect(cliNumData.rows[0].title).toBe('Old Task');
  });
});
