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
  getAllKnownSecrets?(): string[];
}

/**
 * Standard in-memory SecretStore (no persistence to browser storage).
 */
export class StandardSecretStore implements SecretStore {
  private readonly memoryStorage = new Map<string, string>();

  getAllKnownSecrets(): string[] {
    return Array.from(this.memoryStorage.values()).filter(Boolean);
  }

  async setSecret(providerId: string, secret: string): Promise<void> {
    const cleanSecret = secret.trim();
    if (!cleanSecret) {
      await this.clearSecret(providerId);
      return;
    }
    this.memoryStorage.set(providerId, cleanSecret);
  }

  async getSecret(providerId: string): Promise<string | null> {
    return this.memoryStorage.get(providerId) ?? null;
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
  }
}

/**
 * Environment variable mapping for supported cloud AI providers.
 */
const ENV_SECRET_MAP: Record<string, string> = {
  openai: 'OPENOB_AI_OPENAI_KEY',
  anthropic: 'OPENOB_AI_ANTHROPIC_KEY',
  gemini: 'OPENOB_AI_GEMINI_KEY',
  openrouter: 'OPENOB_AI_OPENROUTER_KEY',
};

/**
 * Server-side SecretStore with process-memory storage and optional environment-variable fallback.
 * Precedence: runtime memory override -> environment variable -> absent.
 * No vault file, no .openob file, no browser storage, no logs.
 */
export class ServerSecretStore implements SecretStore {
  private readonly memoryStorage = new Map<string, string>();
  private readonly envSource: Record<string, string | undefined>;

  constructor(envSource?: Record<string, string | undefined>) {
    this.envSource = envSource ?? (typeof process !== 'undefined' ? process.env : {});
  }

  async setSecret(providerId: string, secret: string): Promise<void> {
    const cleanSecret = secret.trim();
    if (!cleanSecret) {
      await this.clearSecret(providerId);
      return;
    }
    this.memoryStorage.set(providerId.toLowerCase(), cleanSecret);
  }

  async getSecret(providerId: string): Promise<string | null> {
    const key = providerId.toLowerCase();
    // 1. Runtime memory override
    const memVal = this.memoryStorage.get(key);
    if (memVal) return memVal;

    // 2. Environment variable fallback
    const envVarName = ENV_SECRET_MAP[key];
    if (envVarName) {
      const envVal = this.envSource[envVarName]?.trim();
      if (envVal) return envVal;
    }

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
    this.memoryStorage.delete(providerId.toLowerCase());
  }

  /**
   * Returns all secrets known to this store (for redaction purposes only).
   */
  getAllKnownSecrets(): string[] {
    const secrets: string[] = [];
    for (const val of this.memoryStorage.values()) {
      if (val) secrets.push(val);
    }
    for (const envVarName of Object.values(ENV_SECRET_MAP)) {
      const envVal = this.envSource[envVarName]?.trim();
      if (envVal) secrets.push(envVal);
    }
    return secrets;
  }
}

/**
 * Removes legacy plain-text cloud secrets from browser sessionStorage (Constitution Law 17).
 */
export function cleanupLegacyBrowserSecrets(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('okw_sec_')) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {}
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

  // 3. Pattern-based redaction: Anthropic keys (sk-ant-...)
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_\-]{10,}/g, 'sk-ant-[REDACTED]');

  // 4. Pattern-based redaction: OpenAI keys (sk-...)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_\-]{10,}/g, 'sk-[REDACTED]');

  // 5. Pattern-based redaction: Google AI Studio keys (AIza...)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{20,}/g, 'AIza[REDACTED]');

  return sanitized;
}
