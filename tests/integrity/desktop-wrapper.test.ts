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
});
