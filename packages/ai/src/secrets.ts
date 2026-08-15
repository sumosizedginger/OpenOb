/**
 * Secret management and API key redaction utilities.
 * Enforces Constitution Law 17 (Secret Non-Leakage) and prevents F-005.
 */

export interface SecretStore {
  setSecret(providerId: string, secret: string): Promise<void>;
  getSecret(providerId: string): Promise<string | null>;
  hasSecret(providerId: string): Promise<boolean>;
  getMaskedSecret(providerId: string): Promise<string | null>;
  clearSecret(providerId: string): Promise<void>;
}

/**
 * In-memory / browser-storage backed SecretStore with masking and secure isolation.
 */
export class StandardSecretStore implements SecretStore {
  private readonly memoryStorage = new Map<string, string>();
  private readonly storagePrefix = 'okw_sec_';

  async setSecret(providerId: string, secret: string): Promise<void> {
    const cleanSecret = secret.trim();
    if (!cleanSecret) {
      await this.clearSecret(providerId);
      return;
    }

    this.memoryStorage.set(providerId, cleanSecret);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(`${this.storagePrefix}${providerId}`, cleanSecret);
      }
    } catch {}
  }

  async getSecret(providerId: string): Promise<string | null> {
    const inMem = this.memoryStorage.get(providerId);
    if (inMem) return inMem;

    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(`${this.storagePrefix}${providerId}`);
        if (stored) {
          this.memoryStorage.set(providerId, stored);
          return stored;
        }
      }
    } catch {}

    return null;
  }

  async hasSecret(providerId: string): Promise<boolean> {
    const sec = await this.getSecret(providerId);
    return sec !== null && sec.length > 0;
  }

  async getMaskedSecret(providerId: string): Promise<string | null> {
    const secret = await this.getSecret(providerId);
    if (!secret) return null;

    if (secret.length <= 8) {
      return '••••••••';
    }

    const prefix = secret.slice(0, 3);
    const suffix = secret.slice(-4);
    return `${prefix}••••••••${suffix}`;
  }

  async clearSecret(providerId: string): Promise<void> {
    this.memoryStorage.delete(providerId);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(`${this.storagePrefix}${providerId}`);
      }
    } catch {}
  }
}

/**
 * Sanitizes and redacts API keys and auth bearer tokens from error strings and logs (Constitution Law 17).
 */
export function redactSecrets(text: string, knownSecrets: string[] = []): string {
  if (!text) return '';

  let sanitized = text;

  // 1. Redact known secrets explicitly
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) {
      sanitized = sanitized.split(secret).join('[REDACTED_API_KEY]');
    }
  }

  // 2. Pattern-based redaction: Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+([A-Za-z0-9_\-\.]{10,})/gi, 'Bearer [REDACTED_TOKEN]');

  // 3. Pattern-based redaction: OpenAI keys (sk-...)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, 'sk-[REDACTED]');

  // 4. Pattern-based redaction: Anthropic keys (sk-ant-...)
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_\-]{20,}/g, 'sk-ant-[REDACTED]');

  // 5. Pattern-based redaction: Google AI Studio keys (AIza...)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{30,}/g, 'AIza[REDACTED]');

  return sanitized;
}
