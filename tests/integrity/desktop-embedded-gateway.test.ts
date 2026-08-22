import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { DesktopVaultRuntime, DesktopSecretStore, DesktopBootstrapConfig } from '@okw/desktop';
import { startGateway, RunningGateway } from '@okw/gateway';
import { AIManager, StandardSecretStore } from '@okw/ai';
import { GatewayWorkspaceBackend, OpenObGatewayClient, WorkspaceChangeEvent } from '@okw/workspace';

describe('Phase 3I: Desktop Shell + Embedded Gateway Authority Integration', () => {
  let testVaultDir: string;
  let testVaultDir2: string;
  let cacheDir: string;
  let secretsDir: string;

  beforeEach(() => {
    testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-vault1-'));
    testVaultDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-vault2-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-cache-'));
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-sec-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
      fs.rmSync(testVaultDir2, { recursive: true, force: true });
      fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.rmSync(secretsDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Binds embedded gateway to ephemeral loopback port (127.0.0.1:0) with high-entropy session token', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const dbPath = path.join(cacheDir, 'index.db');
    const secPath = path.join(secretsDir, 'secrets.json');

    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      secretsPath: secPath,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      expect(gateway.host).toBe('127.0.0.1');
      expect(gateway.port).toBeGreaterThan(0);
      expect(gateway.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      // Verify health check succeeds without auth
      const healthRes = await fetch(`${gateway.url}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson.status).toBe('ok');

      // Verify unauthenticated API request is rejected with 401
      const unauthRes = await fetch(`${gateway.url}/api/v1/entries`);
      expect(unauthRes.status).toBe(401);

      // Verify authenticated request succeeds
      const authRes = await fetch(`${gateway.url}/api/v1/entries`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      expect(authRes.status).toBe(200);
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('2. Token Leak Audit: guarantees token never leaks into note corpus, derived SQLite, or public health endpoints', async () => {
    const uniqueTestToken = `OPENOB_DESKTOP_TOKEN_TEST_${crypto.randomBytes(16).toString('hex')}`;
    const dbPath = path.join(cacheDir, 'index.db');
    const secPath = path.join(secretsDir, 'secrets.json');

    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      secretsPath: secPath,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: uniqueTestToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: uniqueTestToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      // Perform note operations
      await backend.createNote({
        path: 'LeakTest.md',
        content: '# Leak Test\n\nVerifying zero token persistence.',
      });

      // 1. Scan public health endpoint
      const healthRes = await fetch(`${gateway.url}/health`);
      const healthText = await healthRes.text();
      expect(healthText.includes(uniqueTestToken)).toBe(false);

      // 2. Scan note files on disk
      const files = fs.readdirSync(testVaultDir);
      for (const file of files) {
        const full = path.join(testVaultDir, file);
        if (fs.statSync(full).isFile()) {
          const content = fs.readFileSync(full, 'utf8');
          expect(content.includes(uniqueTestToken)).toBe(false);
        }
      }

      // 3. Scan derived SQLite file
      if (fs.existsSync(dbPath)) {
        const dbContent = fs.readFileSync(dbPath);
        expect(dbContent.includes(Buffer.from(uniqueTestToken))).toBe(false);
      }

      // 4. Scan secrets file
      if (fs.existsSync(secPath)) {
        const secContent = fs.readFileSync(secPath, 'utf8');
        expect(secContent.includes(uniqueTestToken)).toBe(false);
      }
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('3. Single Canonical Authority: routes all note and property mutations through Gateway to disk with OCC versioning', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: sessionToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      // 1. Create Note
      const createRes = await backend.createNote({
        path: 'Chapter1.md',
        content: '---\nstatus: draft\n---\n# Chapter 1\n\nIt was a dark and stormy night.',
      });
      expect(createRes.operation).toBe('create');
      expect(createRes.currentVersion.token).toBeDefined();

      // Verify physical disk reality
      const diskPath = path.join(testVaultDir, 'Chapter1.md');
      expect(fs.existsSync(diskPath)).toBe(true);
      expect(fs.readFileSync(diskPath, 'utf8')).toContain('stormy night');

      // 2. Update Note with OCC
      const updateRes = await backend.updateNote({
        path: 'Chapter1.md',
        content: '---\nstatus: draft\n---\n# Chapter 1\n\nIt was a bright sunny morning.',
        expectedVersion: createRes.currentVersion,
      });
      expect(updateRes.operation).toBe('update');

      // 3. Set Property
      const propRes = await backend.setProperty({
        path: 'Chapter1.md',
        key: 'status',
        value: 'published',
        expectedVersion: updateRes.currentVersion,
      });
      expect(propRes.operation).toBe('set_property');

      const readBack = await backend.readNote('Chapter1.md');
      expect(readBack.properties.status).toBe('published');
      expect(readBack.textContent).toContain('bright sunny morning');
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('4. External File Watcher Synchronization: external file edit updates SQLite index and emits SSE change event', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      debounceMs: 10,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: sessionToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      // Listen for SSE events
      const events: WorkspaceChangeEvent[] = [];
      let sub: any;
      await new Promise<void>((resolve) => {
        sub = client.subscribeToEvents({
          onConnect: () => resolve(),
          onEvent: (event: WorkspaceChangeEvent) => {
            events.push(event);
          },
        });
      });

      // External process writes new file to disk
      fs.writeFileSync(
        path.join(testVaultDir, 'ExternalStory.md'),
        '# External Story\n\nWritten outside OpenOb by external tool.',
        'utf8'
      );

      // Trigger watcher event
      runtime.watcher.handleFsEvent('rename', 'ExternalStory.md');

      // Wait for debounce and index sync
      await new Promise((r) => setTimeout(r, 200));

      // 1. Verify file is indexed in SQLite
      const searchRes = await backend.search({ query: 'external' });
      expect(searchRes.total).toBe(1);
      expect(searchRes.matches[0].path).toBe('ExternalStory.md');

      // 2. Verify SSE change event was published and received
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timeout waiting for event. Received: ${JSON.stringify(events)}`)),
          2000
        );
        const check = () => {
          if (
            events.some(
              (e) =>
                e.path === 'ExternalStory.md' &&
                (e.type === 'note.created' || e.type === 'note.modified')
            )
          ) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 20);
          }
        };
        check();
      });

      sub.unsubscribe();
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('5. Self-Write Deduplication: internal workspace write updates index without triggering redundant change storm', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      debounceMs: 10,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: sessionToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      // 1. Perform internal workspace write
      await backend.createNote({
        path: 'SelfWrite.md',
        content: '# Self Write\n\nInternal write.',
      });

      // 2. Simulate native OS watcher echoing the fs change event
      runtime.watcher.handleFsEvent('change', 'SelfWrite.md');

      await new Promise((r) => setTimeout(r, 150));

      // Verify index contains exactly 1 entry and no duplicate record
      const manifest = await runtime.index.getSourceManifest();
      const entries = manifest.filter((m) => m.path === 'SelfWrite.md');
      expect(entries.length).toBe(1);
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('6. External Concurrent Modification & OCC Conflict: detects external modification and rejects stale client write with 409', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: sessionToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      // 1. Create V1
      const v1 = await backend.createNote({
        path: 'Concurrent.md',
        content: '# Version 1\n\nOriginal text.',
      });

      // 2. External agent updates file directly on disk to V2
      fs.writeFileSync(
        path.join(testVaultDir, 'Concurrent.md'),
        '# Version 2\n\nExternal modification.',
        'utf8'
      );

      // 3. Client attempts to save using stale V1 expectedVersion
      await expect(
        backend.updateNote({
          path: 'Concurrent.md',
          content: '# Stale Version\n\nHuman edit on stale base.',
          expectedVersion: v1.currentVersion,
        })
      ).rejects.toThrow();

      // Verify V2 was preserved on disk and not overwritten
      const diskContent = fs.readFileSync(path.join(testVaultDir, 'Concurrent.md'), 'utf8');
      expect(diskContent).toContain('Version 2');
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('7. SQLite Disposable Index Rebuild: deleting derived index file and restarting fully reconstructs index from Markdown', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const dbPath = path.join(cacheDir, 'index.db');

    // 1. Seed notes on disk
    fs.writeFileSync(path.join(testVaultDir, 'Alpha.md'), '# Alpha\n\nFirst note.', 'utf8');
    fs.writeFileSync(path.join(testVaultDir, 'Beta.md'), '# Beta\n\nSecond note.', 'utf8');

    // 2. Start runtime 1 -> builds and checkpoints index
    const runtime1 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-master-key',
    });
    await runtime1.checkpoint();
    await runtime1.close();

    expect(fs.existsSync(dbPath)).toBe(true);

    // 3. Simulate catastrophic cache loss: delete derived index.db
    fs.unlinkSync(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);

    // 4. Start runtime 2 -> must transparently reconstruct SQLite index from Markdown notes
    const runtime2 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime2.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });

    try {
      const client = new OpenObGatewayClient({
        url: gateway.url,
        token: sessionToken,
      });
      const backend = new GatewayWorkspaceBackend(client);

      const entries = await backend.listEntries();
      const noteEntries = entries.filter((e) => !e.isDirectory && e.path.endsWith('.md'));
      expect(noteEntries.length).toBe(2);

      const searchAlpha = await backend.search({ query: 'Alpha' });
      expect(searchAlpha.total).toBe(1);
      expect(searchAlpha.matches[0].path).toBe('Alpha.md');

      const searchBeta = await backend.search({ query: 'Beta' });
      expect(searchBeta.total).toBe(1);
      expect(searchBeta.matches[0].path).toBe('Beta.md');
    } finally {
      await gateway.stop();
      await runtime2.close();
    }
  });

  it('8. Desktop Secret Store Persistence: securely persists AI credentials across restarts with masked status', async () => {
    const secPath = path.join(secretsDir, 'secrets.json');
    const masterSecret = 'super-secure-passphrase-123';

    // 1. Initialize store 1 and write OpenAI key
    const store1 = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret,
    });
    await store1.setSecret('openai', 'sk-proj-1234567890abcdef');
    expect(await store1.hasSecret('openai')).toBe(true);
    expect(await store1.getMaskedSecret('openai')).toBe('sk-••••••••cdef');

    // Verify secrets.json is encrypted on disk (no plaintext key)
    const diskRaw = fs.readFileSync(secPath, 'utf8');
    expect(diskRaw.includes('sk-proj-1234567890abcdef')).toBe(false);
    expect(diskRaw).toContain('ciphertext');
    expect(diskRaw).toContain('authTag');

    // 2. Initialize store 2 on restart with same masterSecret
    const store2 = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret,
    });
    expect(await store2.hasSecret('openai')).toBe(true);
    expect(await store2.getSecret('openai')).toBe('sk-proj-1234567890abcdef');
    expect(await store2.getMaskedSecret('openai')).toBe('sk-••••••••cdef');

    // 3. Initialize store 3 with incorrect masterSecret -> fails decryption safely without leaking or crashing
    const store3 = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret: 'wrong-passphrase',
    });
    expect(store3.getLoadError()).toBeDefined();
    expect(await store3.hasSecret('openai')).toBe(false);
  });

  it('9. Vault Switching: cleanly tears down old gateway/watcher, boots new vault, and isolates events', async () => {
    const token1 = `OPENOB_DESKTOP_1_${crypto.randomUUID()}`;
    const token2 = `OPENOB_DESKTOP_2_${crypto.randomUUID()}`;

    // Seed notes in vault 1 and vault 2
    fs.writeFileSync(path.join(testVaultDir, 'Vault1Note.md'), '# Vault 1', 'utf8');
    fs.writeFileSync(path.join(testVaultDir2, 'Vault2Note.md'), '# Vault 2', 'utf8');

    // 1. Start Session 1 on Vault 1
    const runtime1 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      masterSecret: 'test-master-key',
    });
    const gateway1 = await startGateway({
      workspace: runtime1.workspace,
      host: '127.0.0.1',
      port: 0,
      token: token1,
    });

    const client1 = new OpenObGatewayClient({
      url: gateway1.url,
      token: token1,
    });
    const backend1 = new GatewayWorkspaceBackend(client1);

    const entries1 = await backend1.listEntries();
    const notes1 = entries1.filter((e) => !e.isDirectory && e.path.endsWith('.md'));
    expect(notes1.length).toBe(1);
    expect(notes1[0].path).toBe('Vault1Note.md');

    // 2. Stop Session 1
    await gateway1.stop();
    await runtime1.close();

    // 3. Start Session 2 on Vault 2
    const runtime2 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir2,
      masterSecret: 'test-master-key',
    });
    const gateway2 = await startGateway({
      workspace: runtime2.workspace,
      host: '127.0.0.1',
      port: 0,
      token: token2,
    });

    const client2 = new OpenObGatewayClient({
      url: gateway2.url,
      token: token2,
    });
    const backend2 = new GatewayWorkspaceBackend(client2);

    const entries2 = await backend2.listEntries();
    const notes2 = entries2.filter((e) => !e.isDirectory && e.path.endsWith('.md'));
    expect(notes2.length).toBe(1);
    expect(notes2[0].path).toBe('Vault2Note.md');

    // Verify old client1 cannot connect to gateway2 (token mismatch)
    const staleClient = new OpenObGatewayClient({
      url: gateway2.url,
      token: token1,
    });
    const staleBackend = new GatewayWorkspaceBackend(staleClient);
    await expect(staleBackend.listEntries()).rejects.toThrow();

    await gateway2.stop();
    await runtime2.close();
  });

  it('10. Embedded Gateway with DESKTOP_GATEWAY_SCOPES authorizes AI endpoints without 403 (P1-1)', async () => {
    const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;
    const secPath = path.join(secretsDir, 'secrets.json');
    const secretStore = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret: 'test-master-key',
    });
    const aiManager = new AIManager({}, secretStore);

    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      masterSecret: 'test-master-key',
    });

    const gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
      scopes: [
        'workspace.read',
        'workspace.search',
        'workspace.write',
        'properties.write',
        'workspace.rename',
        'workspace.delete',
        'workspace.views.write',
        'workspace.ai.use',
        'workspace.ai.configure',
      ],
      secretStore,
      aiManager,
    });

    try {
      // 1. GET /api/v1/ai/providers returns 200 (not 403)
      const providersRes = await fetch(`${gateway.url}/api/v1/ai/providers`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(providersRes.status).toBe(200);
      const providersJson = await providersRes.json();
      expect(Array.isArray(providersJson.providers)).toBe(true);

      // 2. PUT /api/v1/ai/secrets/openai returns 200
      const putSecretRes = await fetch(`${gateway.url}/api/v1/ai/secrets/openai`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ secret: 'sk-test-ai-key-12345678' }),
      });
      expect(putSecretRes.status).toBe(200);

      // 3. Verify secret persisted in secretStore
      expect(await secretStore.hasSecret('openai')).toBe(true);

      // 4. DELETE /api/v1/ai/secrets/openai returns 200
      const delSecretRes = await fetch(`${gateway.url}/api/v1/ai/secrets/openai`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(delSecretRes.status).toBe(200);
      expect(await secretStore.hasSecret('openai')).toBe(false);
    } finally {
      await gateway.stop();
      await runtime.close();
    }
  });

  it('11. DesktopSecretStore status reporting and truthful corruption handling (P1-2)', async () => {
    const secPath = path.join(secretsDir, 'secrets.json');
    const masterSecret = 'correct-passphrase-999';

    const store1 = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret,
    });
    expect(store1.getStorageStatus()).toBe('ready');
    await store1.setSecret('anthropic', 'sk-ant-1234567890');

    // Corrupt the disk file content
    fs.writeFileSync(secPath, 'INVALID_JSON_CORRUPTED_FILE_CONTENT', 'utf8');

    // Initialize store 2 on corrupted disk file
    const store2 = new DesktopSecretStore({
      storagePath: secPath,
      masterSecret,
    });

    expect(store2.getLoadError()).toBeDefined();
    expect(store2.getStorageStatus()).toBe('corrupted');
    expect(await store2.listSecretKeys()).toEqual([]);

    // Verify corrupted disk file is NOT silently overwritten/destroyed
    expect(fs.readFileSync(secPath, 'utf8')).toBe('INVALID_JSON_CORRUPTED_FILE_CONTENT');

    // Explicit reset clears corruption state and allows new secret writes
    store2.resetStorage();
    expect(store2.getStorageStatus()).toBe('ready');
    await store2.setSecret('anthropic', 'sk-ant-new-key');
    expect(await store2.getSecret('anthropic')).toBe('sk-ant-new-key');
  });
});
