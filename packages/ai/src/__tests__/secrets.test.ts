import { describe, expect, it } from 'vitest';
import { StandardSecretStore, redactSecrets } from '../secrets.js';

describe('SecretStore & Redaction (Constitution Law 17, F-005)', () => {
  it('stores, retrieves, masks, and clears secrets securely', async () => {
    const store = new StandardSecretStore();

    expect(await store.hasSecret('openai')).toBe(false);
    expect(await store.getMaskedSecret('openai')).toBeNull();

    await store.setSecret('openai', 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz');
    expect(await store.hasSecret('openai')).toBe(true);

    const masked = await store.getMaskedSecret('openai');
    expect(masked).toBe('sk-••••••••wxyz');
    expect(masked).not.toContain('1234567890abcdef');

    await store.clearSecret('openai');
    expect(await store.hasSecret('openai')).toBe(false);
    expect(await store.getMaskedSecret('openai')).toBeNull();
  });

  it('redacts standard cloud API keys and explicit secrets from error messages', () => {
    const testSecret = 'sk-proj-verysecretkey1234567890abcdef';
    const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';
    const googleKey = 'AIzaSyD-1234567890abcdefghijklmnopqrstuvwxyz';

    const errorMessage = `Failed to connect with Authorization: Bearer ${testSecret} to https://api.openai.com. Also failed anthropic ${anthropicKey} and google ${googleKey}`;

    const sanitized = redactSecrets(errorMessage, [testSecret]);

    expect(sanitized).not.toContain(testSecret);
    expect(sanitized).not.toContain(anthropicKey);
    expect(sanitized).not.toContain(googleKey);
    expect(sanitized).toContain('[REDACTED');
  });
});
