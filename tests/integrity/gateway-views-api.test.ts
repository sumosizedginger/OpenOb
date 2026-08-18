import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NodeFsVaultStorage } from '@okw/vault';
import { SqliteDocumentIndex } from '@okw/index';
import {
  OpenObWorkspace,
  OpenObGatewayClient,
  handleMcpToolCall,
  GatewayError,
} from '@okw/workspace';
import { createGatewayServer } from '../../apps/gateway/src/server.js';
import { runCli } from '../../apps/gateway/src/cli.js';

describe('Gateway REST, MCP & CLI Saved Views Integration (Phase 3E)', () => {
  let tempVaultDir: string;
  let workspace: OpenObWorkspace;
  let server: http.Server;
  let serverUrl: string;
  let client: OpenObGatewayClient;
  let index: SqliteDocumentIndex;
  const token = 'test-token-phase3e-views';

  beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-views-test-'));

    // Seed notes
    await fs.writeFile(
      path.join(tempVaultDir, 'TaskA.md'),
      `---
title: Task A
status: todo
priority: 1
---
Task A body.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'TaskB.md'),
      `---
title: Task B
status: in_progress
priority: 2
---
Task B body.`
    );

    const storage = new NodeFsVaultStorage(tempVaultDir);
    index = await SqliteDocumentIndex.create();
    workspace = new OpenObWorkspace({
      storage,
      index,
      readOnly: false,
    });

    await workspace.rebuildIndex();

    server = createGatewayServer({
      workspace,
      token,
      scopes: ['workspace.read', 'workspace.views.write', 'workspace.write'],
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;

    client = new OpenObGatewayClient({
      url: serverUrl,
      token,
      clientId: 'test-runner',
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await index?.close?.();
    await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
  });

  it('1. REST API: CRUD operations on saved views with OCC and run query', async () => {
    // 1. POST /api/v1/views (Create)
    const created = await client.createSavedView({
      name: 'Sprint Board',
      type: 'board',
      groupBy: 'status',
      filters: [{ field: 'status', operator: 'not_equals', value: 'archived' }],
      sorts: [{ field: 'priority', direction: 'asc' }],
    });

    expect(created.view.id).toMatch(/^view_[a-zA-Z0-9_-]+$/);
    expect(created.view.name).toBe('Sprint Board');
    expect(created.view.type).toBe('board');
    expect(created.version.token).toBeDefined();

    // 2. GET /api/v1/views (List)
    const list = await client.listSavedViews();
    expect(list.length).toBe(1);
    expect(list[0].view.id).toBe(created.view.id);

    // 3. GET /api/v1/views/:id (Get)
    const fetched = await client.getSavedView(created.view.id);
    expect(fetched.view.name).toBe('Sprint Board');

    // 4. POST /api/v1/views/:id/query (Run query)
    const queryRes = await client.runSavedView(created.view.id);
    expect(queryRes.total).toBe(2);
    expect(queryRes.rows.length).toBe(2);

    // 5. PUT /api/v1/views/:id (Update)
    const updated = await client.updateSavedView(created.view.id, {
      name: 'Sprint Board Renamed',
      expectedVersion: created.version,
    });
    expect(updated.view.name).toBe('Sprint Board Renamed');

    // 6. Stale PUT -> 409 Conflict
    await expect(
      client.updateSavedView(created.view.id, {
        name: 'Stale',
        expectedVersion: created.version,
      })
    ).rejects.toThrow(GatewayError);

    // 7. DELETE /api/v1/views/:id
    const delRes = await client.deleteSavedView(created.view.id, {
      expectedVersion: updated.version,
    });
    expect(delRes.durableSuccess).toBe(true);

    const listAfter = await client.listSavedViews();
    expect(listAfter.length).toBe(0);
  });

  it('2. Capability gating: read-only token cannot mutate saved views (403 Forbidden)', async () => {
    const roIndex = await SqliteDocumentIndex.create();
    const roWorkspace = new OpenObWorkspace({
      storage: new NodeFsVaultStorage(tempVaultDir),
      index: roIndex,
      readOnly: true, // Read-only!
    });
    const roServer = createGatewayServer({
      workspace: roWorkspace,
      token: 'ro-token',
    });
    await new Promise<void>((resolve) => {
      roServer.listen(0, '127.0.0.1', () => resolve());
    });
    const roAddr = roServer.address() as { port: number };
    const roClient = new OpenObGatewayClient({
      url: `http://127.0.0.1:${roAddr.port}`,
      token: 'ro-token',
    });

    await expect(
      roClient.createSavedView({
        name: 'Forbidden View',
        type: 'table',
      })
    ).rejects.toThrow(GatewayError);

    await new Promise<void>((resolve) => roServer.close(() => resolve()));
    await roIndex.close?.();
  });

  it('3. MCP: openob_list_views, openob_get_view, openob_run_view', async () => {
    // 1. Create a saved view in workspace
    const created = await workspace.createSavedView({
      name: 'MCP Kanban',
      type: 'board',
      groupBy: 'status',
    });

    // 2. List views via MCP
    const listRes = await handleMcpToolCall(workspace, 'openob_list_views', {});
    expect(listRes.isError).toBeFalsy();
    const listData = JSON.parse(listRes.content[0].text);
    expect(listData.length).toBeGreaterThanOrEqual(1);

    // 3. Get view via MCP
    const getRes = await handleMcpToolCall(workspace, 'openob_get_view', { id: created.view.id });
    expect(getRes.isError).toBeFalsy();
    const getData = JSON.parse(getRes.content[0].text);
    expect(getData.view.name).toBe('MCP Kanban');

    // 4. Run view via MCP
    const runRes = await handleMcpToolCall(workspace, 'openob_run_view', { id: created.view.id });
    expect(runRes.isError).toBeFalsy();
    const runData = JSON.parse(runRes.content[0].text);
    expect(runData.total).toBe(2);

    // Clean up view
    await workspace.deleteSavedView(created.view.id, { expectedVersion: created.version });
  });

  it('4. CLI: openob views list, get, run', async () => {
    // 1. Create a saved view in workspace
    const created = await workspace.createSavedView({
      name: 'CLI View',
      type: 'table',
    });

    // 2. CLI list
    const listCli = await runCli({
      workspace,
      args: ['views', 'list', '--json'],
    });
    expect(listCli.exitCode).toBe(0);
    const listData = JSON.parse(listCli.output);
    expect(listData.some((v: any) => v.view.id === created.view.id)).toBe(true);

    // 3. CLI get
    const getCli = await runCli({
      workspace,
      args: ['views', 'get', created.view.id, '--json'],
    });
    expect(getCli.exitCode).toBe(0);
    const getData = JSON.parse(getCli.output);
    expect(getData.view.name).toBe('CLI View');

    // 4. CLI run
    const runCliRes = await runCli({
      workspace,
      args: ['views', 'run', created.view.id, '--json'],
    });
    expect(runCliRes.exitCode).toBe(0);
    const runData = JSON.parse(runCliRes.output);
    expect(runData.total).toBe(2);

    // 5. Remote CLI test (via HTTP loopback)
    const remoteCli = await runCli({
      url: serverUrl,
      token,
      args: ['views', 'list', '--json'],
    });
    expect(remoteCli.exitCode).toBe(0);
    const remoteData = JSON.parse(remoteCli.output);
    expect(remoteData.some((v: any) => v.view.id === created.view.id)).toBe(true);

    await workspace.deleteSavedView(created.view.id, { expectedVersion: created.version });
  });
});
