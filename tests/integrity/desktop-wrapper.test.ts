import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DesktopVaultRuntime,
  NativeVaultWatcher,
  DesktopSecretStore,
  DesktopIpcBridge,
} from '@okw/desktop';
import { executePropertyQuery } from '@okw/index';

describe('Phase 12 Exit Gate: Desktop Wrapper & Native Shell Architecture (D-022)', () => {
  let testVaultDir: string;
  let secretsDir: string;

  beforeEach(() => {
    testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-vault-'));
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-desktop-secrets-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
      fs.rmSync(secretsDir, { recursive: true, force: true });
    } catch {}
  });

  it('DesktopVaultRuntime: indexes real filesystem notes into SQLite engine with full query support', async () => {
    // 1. Seed initial notes on disk
    fs.writeFileSync(
      path.join(testVaultDir, 'Welcome.md'),
      '# Welcome to Desktop\n\nCanonical local note.',
      'utf8'
    );
    fs.mkdirSync(path.join(testVaultDir, 'Characters'), { recursive: true });
    fs.writeFileSync(
      path.join(testVaultDir, 'Characters', 'Kaelen.md'),
      '---\ntitle: Kaelen\ntype: character\nrole: protagonist\n---\n# Kaelen\n\nThe wanderer.',
      'utf8'
    );

    // 2. Initialize Desktop Runtime
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      secretsPath: path.join(secretsDir, 'secrets.json'),
      masterSecret: 'test-master-key',
      debounceMs: 20,
    });

    try {
      // 3. Verify SQLite index contains seeded files
      const allDocs = await runtime.index.getAll();
      expect(allDocs.length).toBe(2);

      const searchRes = await runtime.index.query({ query: 'wanderer' });
      expect(searchRes.length).toBe(1);
      expect(searchRes[0].path).toBe('Characters/Kaelen.md');

      // 4. Verify property query on SQLite
      const propRes = await executePropertyQuery(runtime.index, {
        id: 'chars',
        name: 'Chars',
        type: 'table',
        filters: [{ field: 'type', operator: 'equals', value: 'character' }],
      });
      expect(propRes.length).toBe(1);
      expect(propRes[0].properties.role).toBe('protagonist');
    } finally {
      await runtime.close();
    }
  });

  it('NativeVaultWatcher: ignores .okw.tmp swap files and syncs real external changes to SQLite index', async () => {
    const runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      secretsPath: path.join(secretsDir, 'secrets.json'),
      masterSecret: 'test-master-key',
      debounceMs: 10,
    });

    try {
      // 1. Simulate SafeWriter internal swap file event -> must be ignored
      runtime.watcher.handleFsEvent('change', 'Notes/.okw.tmp.12345.md');

      await new Promise((resolve) => setTimeout(resolve, 30));
      const docsAfterTmp = await runtime.index.getAll();
      expect(docsAfterTmp.some((d: any) => d.path.includes('.okw.tmp'))).toBe(false);

      // 2. Create real external file on disk
      fs.writeFileSync(
        path.join(testVaultDir, 'ExternalNote.md'),
        '# External Note\n\nCreated externally by user.',
        'utf8'
      );
      runtime.watcher.handleFsEvent('rename', 'ExternalNote.md');

      // Wait for debounce and index sync
      await new Promise((resolve) => setTimeout(resolve, 150));

      const docsAfterExternal = await runtime.index.getAll();
      expect(docsAfterExternal.some((d: any) => d.path === 'ExternalNote.md')).toBe(true);

      const searchExternal = await runtime.index.query({ query: 'externally' });
      expect(searchExternal.length).toBe(1);
      expect(searchExternal[0].path).toBe('ExternalNote.md');
    } finally {
      await runtime.close();
    }
  });

  it('DesktopSecretStore: securely persists BYOK API keys with authenticated AES-256-GCM encryption', async () => {
    const secretsFilePath = path.join(secretsDir, 'secrets.json');
    const secretStore = new DesktopSecretStore({
      storagePath: secretsFilePath,
      masterSecret: 'test-master-device-key',
    });

    const apiKey = 'sk-proj-super-secret-production-ai-key-12345';
    await secretStore.setSecret('openai', apiKey);
    await secretStore.setSecret('anthropic', 'sk-ant-api-key-abcde');

    // 1. Verify retrieval matches
    const retrieved = await secretStore.getSecret('openai');
    expect(retrieved).toBe(apiKey);

    // 2. Verify disk persistence is encrypted and contains NO plaintext key (Law 17, F-005)
    expect(fs.existsSync(secretsFilePath)).toBe(true);
    const diskContent = fs.readFileSync(secretsFilePath, 'utf8');
    expect(diskContent).not.toContain('super-secret-production-ai-key');
    expect(diskContent).not.toContain('sk-proj');
    expect(diskContent).toContain('ciphertext');
    expect(diskContent).toContain('authTag');
    expect(diskContent).toContain('iv');

    // 3. Re-instantiate from disk and verify clean decryption
    const newStore = new DesktopSecretStore({
      storagePath: secretsFilePath,
      masterSecret: 'test-master-device-key',
    });
    expect(await newStore.getSecret('openai')).toBe(apiKey);
    expect(await newStore.getSecret('anthropic')).toBe('sk-ant-api-key-abcde');
  });

  it('DesktopIpcBridge: dispatches typed main-to-renderer requests and manages event listeners', async () => {
    const bridge = new DesktopIpcBridge();

    bridge.registerHandler('vault:open-dialog', async (payload: { defaultPath: string }) => {
      return { selectedPath: `${payload.defaultPath}/MyVault` };
    });

    const res = await bridge.handleRequest({
      id: 'req-1',
      channel: 'vault:open-dialog',
      payload: { defaultPath: '/Users/test' },
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ selectedPath: '/Users/test/MyVault' });

    // Unregistered channel returns failure without throwing
    const failRes = await bridge.handleRequest({
      id: 'req-2',
      channel: 'vault:reveal' as any,
    });
    expect(failRes.success).toBe(false);
    expect(failRes.error).toContain('No handler registered');
  });

  it('DesktopVaultRuntime: persists SQLite index to disk, restarts cleanly, and recovers from corruption (P1-SQLITE-001)', async () => {
    const dbPath = path.join(testVaultDir, '.okw', 'index.db');

    // 1. Seed note and start runtime with databasePath
    fs.writeFileSync(path.join(testVaultDir, 'Note1.md'), '# Note One\n\nFirst persistent note.', 'utf8');
    const runtime1 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-pass',
    });

    // Checkpoint should have written database file to disk
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0);
    const docs1 = await runtime1.index.getAll();
    expect(docs1.length).toBe(1);
    expect(docs1[0].path).toBe('Note1.md');
    await runtime1.close();

    // 2. Restart new runtime instance pointing to same databasePath -> loads directly from disk
    const runtime2 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-pass',
    });
    const docs2 = await runtime2.index.getAll();
    expect(docs2.length).toBe(1);
    expect(docs2[0].path).toBe('Note1.md');
    await runtime2.close();

    // 3. Delete DB file -> restart -> exact reconstruction from Markdown
    fs.unlinkSync(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);

    const runtime3 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-pass',
    });
    const docs3 = await runtime3.index.getAll();
    expect(docs3.length).toBe(1);
    expect(docs3[0].path).toBe('Note1.md');
    expect(fs.existsSync(dbPath)).toBe(true);
    await runtime3.close();

    // 4. Corrupt DB file (truncate / write garbage) -> restart -> safe recovery from Markdown
    fs.writeFileSync(dbPath, 'GARBAGE_CORRUPTED_BYTES');
    const runtime4 = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      masterSecret: 'test-pass',
    });
    const docs4 = await runtime4.index.getAll();
    expect(docs4.length).toBe(1);
    expect(docs4[0].path).toBe('Note1.md');
    await runtime4.close();
  });
});
