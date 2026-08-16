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
    expect(() => new DesktopSecretStore({ masterSecret: '' })).toThrow(/requires a non-empty masterSecret/);
    expect(() => new DesktopSecretStore({ masterSecret: '   ' })).toThrow(/requires a non-empty masterSecret/);
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
});
