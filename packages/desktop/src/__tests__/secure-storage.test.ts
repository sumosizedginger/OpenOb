import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesktopSecretStore } from '../secure-storage.js';

describe('DesktopSecretStore Hardening (P1-SECRET-001 / Law 17)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-sec-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. constructing with missing or empty masterSecret throws', () => {
    expect(() => new DesktopSecretStore({} as any)).toThrow(/requires a non-empty masterSecret/);
    expect(() => new DesktopSecretStore({ masterSecret: '' })).toThrow(
      /requires a non-empty masterSecret/
    );
    expect(() => new DesktopSecretStore({ masterSecret: '   ' })).toThrow(
      /requires a non-empty masterSecret/
    );
  });

  it('2. round-trip with passphrase persists and decrypts across new store instance', async () => {
    const secretsPath = path.join(tmpDir, 'secrets.json');
    const store1 = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-strong-user-passphrase',
    });

    const apiKey = 'sk-proj-test-12345-secret-key';
    await store1.setSecret('openai', apiKey);
    await store1.setSecret('anthropic', 'sk-ant-test-54321');

    expect(await store1.getSecret('openai')).toBe(apiKey);
    expect(await store1.hasSecret('openai')).toBe(true);
    expect(await store1.getMaskedSecret('openai')).toBe('sk-••••••••-key');

    // Load in fresh store with same passphrase
    const store2 = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-strong-user-passphrase',
    });

    expect(await store2.getSecret('openai')).toBe(apiKey);
    expect(await store2.getSecret('anthropic')).toBe('sk-ant-test-54321');
  });

  it('3. wrong passphrase fails to decrypt without leaking plaintext', async () => {
    const secretsPath = path.join(tmpDir, 'secrets.json');
    const store1 = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'correct-passphrase',
    });

    await store1.setSecret('openai', 'super-secret-key');

    // Fresh store with wrong passphrase
    const storeWrong = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'wrong-passphrase',
    });

    expect(await storeWrong.getSecret('openai')).toBeNull();
    expect(await storeWrong.hasSecret('openai')).toBe(false);
    expect(storeWrong.getLoadError()).not.toBeNull();
    expect(storeWrong.getLoadError()?.message).toContain('Failed to decrypt secret');

    // Assert raw file on disk has no plaintext
    const rawDisk = fs.readFileSync(secretsPath, 'utf8');
    expect(rawDisk).not.toContain('super-secret-key');
  });

  it('4. tampered ciphertext fails authentication and surfaces error', async () => {
    const secretsPath = path.join(tmpDir, 'secrets.json');
    const store = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-passphrase',
    });

    await store.setSecret('openai', 'super-secret-key');

    // Tamper with disk file records
    const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const records = raw.records || raw;
    records.openai.ciphertext = records.openai.ciphertext.slice(0, -4) + '0000';
    fs.writeFileSync(secretsPath, JSON.stringify(raw));

    const freshStore = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-passphrase',
    });

    expect(await freshStore.getSecret('openai')).toBeNull();
    expect(freshStore.getLoadError()).not.toBeNull();
  });

  it('5. uses unique random per-file salt and serializes concurrent setSecret operations', async () => {
    const path1 = path.join(tmpDir, 'secrets1.json');
    const path2 = path.join(tmpDir, 'secrets2.json');

    const store1 = new DesktopSecretStore({ storagePath: path1, masterSecret: 'pass' });
    const store2 = new DesktopSecretStore({ storagePath: path2, masterSecret: 'pass' });

    await store1.setSecret('k1', 'v1');
    await store2.setSecret('k1', 'v1');

    const file1 = JSON.parse(fs.readFileSync(path1, 'utf8'));
    const file2 = JSON.parse(fs.readFileSync(path2, 'utf8'));

    expect(file1.salt).toBeDefined();
    expect(file2.salt).toBeDefined();
    expect(file1.salt).not.toEqual(file2.salt);

    // Test concurrent writes
    await Promise.all([
      store1.setSecret('k2', 'v2'),
      store1.setSecret('k3', 'v3'),
      store1.setSecret('k4', 'v4'),
    ]);

    expect(await store1.getSecret('k2')).toBe('v2');
    expect(await store1.getSecret('k3')).toBe('v3');
    expect(await store1.getSecret('k4')).toBe('v4');
  });

  it('6. rejects setSecret on disk write or rename failure and prevents silent ephemeral writes (F4)', async () => {
    // Create a plain file where a directory is expected to cause filesystem write failure
    const blockingFile = path.join(tmpDir, 'blocking-file');
    fs.writeFileSync(blockingFile, 'i-am-a-file');
    const invalidPath = path.join(blockingFile, 'secrets.json');

    const store = new DesktopSecretStore({ storagePath: invalidPath, masterSecret: 'pass' });

    await expect(store.setSecret('ephemeral_key', 'my-secret-value')).rejects.toThrow();
    // In-memory cache must be rolled back on failure (not retained ephemerally)
    expect(await store.getSecret('ephemeral_key')).toBeNull();

    // Verify fresh store instance sees null
    const freshStore = new DesktopSecretStore({ storagePath: invalidPath, masterSecret: 'pass' });
    expect(await freshStore.getSecret('ephemeral_key')).toBeNull();
  });

  it('7. failed write does not poison queue: subsequent operations succeed (G6)', async () => {
    const secretsPath = path.join(tmpDir, 'secrets-queue.json');
    const store = new DesktopSecretStore({ storagePath: secretsPath, masterSecret: 'pass' });

    await store.setSecret('k1', 'initial-val');
    expect(await store.getSecret('k1')).toBe('initial-val');

    // Force failure on persistToDisk
    let shouldFail = true;
    const origPersist = (store as any).persistToDisk.bind(store);
    (store as any).persistToDisk = () => {
      if (shouldFail) {
        throw new Error('EIO: Simulated disk failure');
      }
      return origPersist();
    };

    // Failed write
    await expect(store.setSecret('k1', 'new-failed-val')).rejects.toThrow('EIO');
    // Memory cache rolled back to previous value
    expect(await store.getSecret('k1')).toBe('initial-val');

    // Turn off failure: next operation must succeed on the same store instance!
    shouldFail = false;
    await store.setSecret('k1', 'recovered-val');
    expect(await store.getSecret('k1')).toBe('recovered-val');
  });

  it('8. concurrent failed and succeeding writes for same key resolve correctly without corruption (G6)', async () => {
    const secretsPath = path.join(tmpDir, 'secrets-concurrent.json');
    const store = new DesktopSecretStore({ storagePath: secretsPath, masterSecret: 'pass' });

    await store.setSecret('target', 'v0');

    let failCount = 1;
    const origPersist = (store as any).persistToDisk.bind(store);
    (store as any).persistToDisk = () => {
      if (failCount > 0) {
        failCount--;
        throw new Error('Simulated transient failure');
      }
      return origPersist();
    };

    // Queue operation 1 (will fail) and operation 2 (will succeed) concurrently
    const p1 = store.setSecret('target', 'v1-fail');
    const p2 = store.setSecret('target', 'v2-success');

    await expect(p1).rejects.toThrow('Simulated transient failure');
    await expect(p2).resolves.toBeUndefined();

    expect(await store.getSecret('target')).toBe('v2-success');

    // Fresh store instance matches
    const fresh = new DesktopSecretStore({ storagePath: secretsPath, masterSecret: 'pass' });
    expect(await fresh.getSecret('target')).toBe('v2-success');
  });

  it('9. concurrent failed and succeeding writes for different keys preserve consistency (G6)', async () => {
    const secretsPath = path.join(tmpDir, 'secrets-diff-keys.json');
    const store = new DesktopSecretStore({ storagePath: secretsPath, masterSecret: 'pass' });

    await store.setSecret('keyA', 'valA0');
    await store.setSecret('keyB', 'valB0');

    let failFirst = true;
    const origPersist = (store as any).persistToDisk.bind(store);
    (store as any).persistToDisk = () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('First op disk failure');
      }
      return origPersist();
    };

    const pA = store.setSecret('keyA', 'valA1');
    const pB = store.setSecret('keyB', 'valB1');

    await expect(pA).rejects.toThrow('First op disk failure');
    await expect(pB).resolves.toBeUndefined();

    // keyA rolled back to valA0, keyB committed valB1
    expect(await store.getSecret('keyA')).toBe('valA0');
    expect(await store.getSecret('keyB')).toBe('valB1');

    const fresh = new DesktopSecretStore({ storagePath: secretsPath, masterSecret: 'pass' });
    expect(await fresh.getSecret('keyA')).toBe('valA0');
    expect(await fresh.getSecret('keyB')).toBe('valB1');
  });
});
