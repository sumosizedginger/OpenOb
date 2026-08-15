import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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

    // Assert raw file on disk has no plaintext
    const rawDisk = fs.readFileSync(secretsPath, 'utf8');
    expect(rawDisk).not.toContain('super-secret-key');
  });

  it('4. tampered ciphertext fails authentication', async () => {
    const secretsPath = path.join(tmpDir, 'secrets.json');
    const store = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-passphrase',
    });

    await store.setSecret('openai', 'super-secret-key');

    // Tamper with disk file
    const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    raw.openai.ciphertext = raw.openai.ciphertext.slice(0, -4) + '0000';
    fs.writeFileSync(secretsPath, JSON.stringify(raw));

    const freshStore = new DesktopSecretStore({
      storagePath: secretsPath,
      masterSecret: 'my-passphrase',
    });

    expect(await freshStore.getSecret('openai')).toBeNull();
  });
});
