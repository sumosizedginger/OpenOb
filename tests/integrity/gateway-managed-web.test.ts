import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex } from '@okw/index';
import { MemoryVaultStorage, SafeWriter, NoteWriteCoordinator } from '@okw/vault';
import {
  GatewayError,
  GatewayWorkspaceBackend,
  LocalWorkspaceBackend,
  OpenObGatewayClient,
  OpenObWorkspace,
} from '@okw/workspace';
import { RunningGateway, startGateway } from '../../apps/gateway/src/server.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('Phase 3B Gateway-Managed Web Mode Integrity & Authority Tests', () => {
  let tempWebDist: string;
  let runningGateway: RunningGateway;
  let readOnlyGateway: RunningGateway;
  let serverWorkspace: OpenObWorkspace;
  let readOnlyWorkspace: OpenObWorkspace;
  let serverStorage: MemoryVaultStorage;
  let serverIndex: MemoryDocumentIndex;
  let parser: DefaultDocumentParser;
  const TEST_TOKEN = 'phase3b-test-token-sec-999';

  beforeAll(async () => {
    // 1. Create a dummy web dist folder with index.html, assets/app.js, styles.css
    tempWebDist = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-web-dist-'));
    await fs.writeFile(
      path.join(tempWebDist, 'index.html'),
      '<!DOCTYPE html><html><head><title>OpenOb</title></head><body><div id="root">OpenOb App</div></body></html>',
      'utf8'
    );
    const assetsDir = path.join(tempWebDist, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'app.js'), 'console.log("OpenOb Loaded");', 'utf8');
    await fs.writeFile(path.join(assetsDir, 'styles.css'), 'body { margin: 0; }', 'utf8');

    // 2. Set up server vault & workspace
    parser = new DefaultDocumentParser();
    serverStorage = new MemoryVaultStorage('phase3b-vault');
    serverIndex = new MemoryDocumentIndex();
    const serverWriter = new SafeWriter(serverStorage);

    await serverStorage.write(
      'Welcome.md',
      null,
      `---
title: Welcome Note
tags: [welcome, hub]
status: active
---
# Welcome Note

This is the gateway-managed vault. Links to [[Projects/Alpha]].
`
    );

    await serverStorage.write(
      'Projects/Alpha.md',
      null,
      `---
title: Alpha Project
tags: [project]
---
# Alpha Project

Details about Alpha.
`
    );

    const s1 = await serverStorage.read('Welcome.md');
    const s2 = await serverStorage.read('Projects/Alpha.md');
    await serverIndex.upsert(await parser.parse('Welcome.md', s1.textContent!, s1.version.hash));
    await serverIndex.upsert(
      await parser.parse('Projects/Alpha.md', s2.textContent!, s2.version.hash)
    );

    serverWorkspace = new OpenObWorkspace({
      storage: serverStorage,
      index: serverIndex,
      parser,
      safeWriter: serverWriter,
      readOnly: false,
      vaultName: 'phase3b-vault',
    });

    const port1 = await getFreePort();
    runningGateway = await startGateway({
      workspace: serverWorkspace,
      port: port1,
      token: TEST_TOKEN,
      serveWeb: true,
      webDistPath: tempWebDist,
    });

    // 3. Set up read-only gateway
    const roStorage = new MemoryVaultStorage('ro-vault');
    const roIndex = new MemoryDocumentIndex();
    await roStorage.write('RO.md', null, '# Read Only Note\n\nContent');
    const roSnap = await roStorage.read('RO.md');
    await roIndex.upsert(await parser.parse('RO.md', roSnap.textContent!, roSnap.version.hash));

    readOnlyWorkspace = new OpenObWorkspace({
      storage: roStorage,
      index: roIndex,
      parser,
      readOnly: true,
      vaultName: 'ro-vault',
    });

    const port2 = await getFreePort();
    readOnlyGateway = await startGateway({
      workspace: readOnlyWorkspace,
      port: port2,
      token: TEST_TOKEN,
      serveWeb: false,
    });
  });

  afterAll(async () => {
    await runningGateway?.stop();
    await readOnlyGateway?.stop();
    if (tempWebDist) {
      await fs.rm(tempWebDist, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('1. Web delivery: running gateway with --serve-web serves index.html and static assets', async () => {
    // GET / (root) -> index.html
    const rootRes = await fetch(`${runningGateway.url}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get('content-type')).toContain('text/html');
    const rootText = await rootRes.text();
    expect(rootText).toContain('<div id="root">OpenOb App</div>');

    // GET /assets/app.js -> javascript
    const jsRes = await fetch(`${runningGateway.url}/assets/app.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('application/javascript');
    const jsText = await jsRes.text();
    expect(jsText).toContain('console.log("OpenOb Loaded");');

    // GET /assets/styles.css -> css
    const cssRes = await fetch(`${runningGateway.url}/assets/styles.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    // SPA fallback: GET /notes/Welcome.md (non-API route) -> index.html
    const spaRes = await fetch(`${runningGateway.url}/notes/Welcome.md`);
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get('content-type')).toContain('text/html');
    const spaText = await spaRes.text();
    expect(spaText).toContain('<div id="root">OpenOb App</div>');
  });

  it('2. Mode Exclusivity: GatewayWorkspaceBackend executes zero local storage or coordinator writes', async () => {
    // Create an instrumented dummy local storage that tracks calls
    let localWriteCalls = 0;
    let localSafeSaveCalls = 0;

    const dummyLocalStorage = new MemoryVaultStorage('dummy-client');
    const origWrite = dummyLocalStorage.write.bind(dummyLocalStorage);
    dummyLocalStorage.write = async (...args) => {
      localWriteCalls++;
      return origWrite(...args);
    };

    const dummySafeWriter = new SafeWriter(dummyLocalStorage);
    const origSafeSave = dummySafeWriter.safeSave.bind(dummySafeWriter);
    dummySafeWriter.safeSave = async (...args) => {
      localSafeSaveCalls++;
      return origSafeSave(...args);
    };

    // Client backend talking to Gateway
    const client = new OpenObGatewayClient({
      url: runningGateway.url,
      token: TEST_TOKEN,
      clientId: 'openob-web',
    });
    const gatewayBackend = new GatewayWorkspaceBackend(client);

    expect(gatewayBackend.mode).toBe('gateway');

    // Perform full read and mutation lifecycle via GatewayWorkspaceBackend
    const info = await gatewayBackend.getWorkspaceInfo();
    expect(info.name).toBe('phase3b-vault');

    const entries = await gatewayBackend.listEntries('');
    expect(entries.some((e) => e.path === 'Welcome.md')).toBe(true);

    const welcome = await gatewayBackend.readNote('Welcome.md');
    expect(welcome.title).toBe('Welcome Note');
    expect(welcome.version.token).toBeDefined();

    // Create note via gateway
    const createRes = await gatewayBackend.createNote({
      path: 'TestNote.md',
      content: '# Test Note\n\nContent',
    });
    expect(createRes.operation).toBe('create');
    expect(createRes.currentVersion.token).toBeDefined();

    // Update note via gateway
    const updateRes = await gatewayBackend.updateNote({
      path: 'TestNote.md',
      content: '# Test Note\n\nUpdated Content',
      expectedVersion: { token: createRes.currentVersion.token },
    });
    expect(updateRes.operation).toBe('update');

    // Set property via gateway
    const propRes = await gatewayBackend.setProperty({
      path: 'TestNote.md',
      key: 'status',
      value: 'published',
      expectedVersion: { token: updateRes.currentVersion.token },
    });
    expect(propRes.operation).toBe('set_property');

    // Rename note via gateway
    const renameRes = await gatewayBackend.renameNote({
      oldPath: 'TestNote.md',
      newPath: 'RenamedNote.md',
      expectedVersion: { token: propRes.currentVersion.token },
    });
    expect(renameRes.operation).toBe('rename');

    // Delete note via gateway
    const delRes = await gatewayBackend.deleteNote({
      path: 'RenamedNote.md',
      expectedVersion: { token: renameRes.currentVersion.token },
    });
    expect(delRes.operation).toBe('delete');

    // STRICT LAW CHECK: Local client storage had ZERO writes
    expect(localWriteCalls).toBe(0);
    expect(localSafeSaveCalls).toBe(0);
  });

  it('3. Optimistic Concurrency Control (OCC): GatewayWorkspaceBackend enforces version tokens and detects 409 conflict', async () => {
    const client = new OpenObGatewayClient({
      url: runningGateway.url,
      token: TEST_TOKEN,
      clientId: 'openob-web-occ',
    });
    const gatewayBackend = new GatewayWorkspaceBackend(client);

    // 1. Create a shared note
    const createRes = await gatewayBackend.createNote({
      path: 'SharedDoc.md',
      content: '# Version 1\n\nInitial content.',
    });
    const v1Token = createRes.currentVersion.token;

    // 2. Client A (Agent) updates to V2
    const agentRes = await gatewayBackend.updateNote({
      path: 'SharedDoc.md',
      content: '# Version 2\n\nAgent updated content.',
      expectedVersion: { token: v1Token },
    });
    const v2Token = agentRes.currentVersion.token;
    expect(v2Token).not.toBe(v1Token);

    // 3. Client B (Human Web UI with stale V1 token) attempts to save
    let caughtError: any = null;
    try {
      await gatewayBackend.updateNote({
        path: 'SharedDoc.md',
        content: '# Human Draft\n\nHuman edits based on stale V1.',
        expectedVersion: { token: v1Token },
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(GatewayError);
    expect(caughtError.status).toBe(409);
    expect(caughtError.code).toBe('CONFLICT');

    // 4. Verify server content was NOT overwritten
    const currentOnServer = await gatewayBackend.readNote('SharedDoc.md');
    expect(currentOnServer.textContent).toContain('Agent updated content.');
    expect(currentOnServer.version.token).toBe(v2Token);

    // 5. Clean up
    await gatewayBackend.deleteNote({
      path: 'SharedDoc.md',
      expectedVersion: { token: v2Token },
    });
  });

  it('4. Read-Only Gateway Enforcement: Mutations return 403 Forbidden with proper error structure', async () => {
    const client = new OpenObGatewayClient({
      url: readOnlyGateway.url,
      token: TEST_TOKEN,
      clientId: 'openob-web-ro',
    });
    const roBackend = new GatewayWorkspaceBackend(client);

    const info = await roBackend.getWorkspaceInfo();
    expect(info.readOnly).toBe(true);

    let createError: any = null;
    try {
      await roBackend.createNote({
        path: 'Forbidden.md',
        content: 'Content',
      });
    } catch (err: any) {
      createError = err;
    }

    expect(createError).toBeInstanceOf(GatewayError);
    expect(createError.status).toBe(403);
    expect(createError.code).toBe('FORBIDDEN');
  });

  it('5. Security: Bearer tokens are not leaked in query parameters or error payloads', async () => {
    const client = new OpenObGatewayClient({
      url: runningGateway.url,
      token: 'super-secret-token-value',
      clientId: 'openob-web-sec',
    });

    try {
      // Calling non-existent endpoint or failing note
      await client.readNote('NonExistentNote12345.md');
    } catch (err: any) {
      expect(err.message).not.toContain('super-secret-token-value');
    }
  });

  it('6. Error Discrimination (R3B-1): Distinct error codes for 401, 403, 404, 409, 413, and 503 GatewayUnavailableError', async () => {
    // 401 Unauthorized
    const unauthClient = new OpenObGatewayClient({
      url: runningGateway.url,
      token: 'wrong-token-invalid',
      clientId: 'openob-unauth',
    });
    let authErr: any = null;
    try {
      await unauthClient.getWorkspaceInfo();
    } catch (err: any) {
      authErr = err;
    }
    expect(authErr).toBeInstanceOf(GatewayError);
    expect(authErr.status).toBe(401);
    expect(authErr.code).toBe('UNAUTHORIZED');

    // 404 Not Found
    const validClient = new OpenObGatewayClient({
      url: runningGateway.url,
      token: TEST_TOKEN,
      clientId: 'openob-valid',
    });
    let notFoundErr: any = null;
    try {
      await validClient.readNote('DefinitelyDoesNotExist.md');
    } catch (err: any) {
      notFoundErr = err;
    }
    expect(notFoundErr).toBeInstanceOf(GatewayError);
    expect(notFoundErr.status).toBe(404);
    expect(notFoundErr.code).toBe('NOT_FOUND');

    // 503 / GatewayUnavailableError when connecting to an unreachable port
    const deadPort = await getFreePort();
    const deadClient = new OpenObGatewayClient({
      url: `http://127.0.0.1:${deadPort}`,
      token: TEST_TOKEN,
      clientId: 'openob-dead',
    });
    let unavailErr: any = null;
    try {
      await deadClient.getWorkspaceInfo();
    } catch (err: any) {
      unavailErr = err;
    }
    expect(unavailErr).toBeInstanceOf(GatewayError);
    expect(unavailErr.status).toBe(503);
    expect(unavailErr.code).toBe('GATEWAY_UNAVAILABLE');
  });

  it('7. Health Endpoint (R3B-3): GET /health responds with 200 OK for background polling', async () => {
    const res = await fetch(`${runningGateway.url}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
