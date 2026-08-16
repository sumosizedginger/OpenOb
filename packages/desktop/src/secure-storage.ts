import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SecretStore } from '@okw/ai';

export interface DesktopSecretStoreOptions {
  readonly storagePath?: string;
  readonly masterSecret: string;
}

interface EncryptedPayload {
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

interface SecretFileFormat {
  readonly version: number;
  readonly salt: string;
  readonly records: Record<string, EncryptedPayload>;
}

export class DesktopSecretStore implements SecretStore {
  private readonly storagePath: string | null;
  private readonly masterSecret: string;
  private salt: string;
  private masterKey: Buffer;
  private memoryCache: Map<string, string> = new Map();
  private lastLoadError: Error | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options: DesktopSecretStoreOptions) {
    if (!options?.masterSecret || typeof options.masterSecret !== 'string' || options.masterSecret.trim().length === 0) {
      throw new Error('DesktopSecretStore requires a non-empty masterSecret passphrase');
    }

    this.masterSecret = options.masterSecret;
    this.storagePath = options.storagePath ? path.resolve(options.storagePath) : null;

    // Generate fresh random 16-byte salt (will be overwritten if existing file has its own salt)
    this.salt = crypto.randomBytes(16).toString('hex');
    this.masterKey = this.deriveKey(this.salt);

    this.loadFromDisk();
  }

  private deriveKey(saltHex: string): Buffer {
    const saltBuf = Buffer.from(saltHex, 'hex');
    // PBKDF2 with 600,000 iterations (OWASP recommendation for SHA-256)
    return crypto.pbkdf2Sync(this.masterSecret, saltBuf, 600000, 32, 'sha256');
  }

  getLoadError(): Error | null {
    return this.lastLoadError;
  }

  async getSecret(providerId: string): Promise<string | null> {
    return this.memoryCache.get(providerId) || null;
  }

  async setSecret(providerId: string, value: string): Promise<void> {
    const cleanSecret = value.trim();

    const op = this.writeLock
      .catch(() => {})
      .then(async () => {
        const previousValue = this.memoryCache.get(providerId);
        if (!cleanSecret) {
          this.memoryCache.delete(providerId);
        } else {
          this.memoryCache.set(providerId, cleanSecret);
        }
        try {
          this.persistToDisk();
        } catch (err) {
          if (previousValue === undefined) {
            this.memoryCache.delete(providerId);
          } else {
            this.memoryCache.set(providerId, previousValue);
          }
          throw err;
        }
      });

    this.writeLock = op.catch(() => {});
    return op;
  }

  async clearSecret(providerId: string): Promise<void> {
    const op = this.writeLock
      .catch(() => {})
      .then(async () => {
        const previousValue = this.memoryCache.get(providerId);
        this.memoryCache.delete(providerId);
        try {
          this.persistToDisk();
        } catch (err) {
          if (previousValue !== undefined) {
            this.memoryCache.set(providerId, previousValue);
          }
          throw err;
        }
      });

    this.writeLock = op.catch(() => {});
    return op;
  }

  async hasSecret(providerId: string): Promise<boolean> {
    const sec = await this.getSecret(providerId);
    return sec !== null && sec.length > 0;
  }

  async getMaskedSecret(providerId: string): Promise<string | null> {
    const secret = await this.getSecret(providerId);
    if (!secret) return null;
    if (secret.length <= 8) return '••••••••';
    const start = secret.slice(0, 3);
    const end = secret.slice(-4);
    return `${start}••••••••${end}`;
  }

  async listSecretKeys(): Promise<string[]> {
    return Array.from(this.memoryCache.keys());
  }

  private encrypt(plainText: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let ciphertext = cipher.update(plainText, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      authTag,
      ciphertext,
    };
  }

  private decrypt(payload: EncryptedPayload): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(payload.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    let plain = decipher.update(payload.ciphertext, 'hex', 'utf8');
    plain += decipher.final('utf8');
    return plain;
  }

  private loadFromDisk(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;

    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);

      let records: Record<string, EncryptedPayload> = {};
      if (parsed && typeof parsed === 'object') {
        if (parsed.salt && parsed.records) {
          // New format with per-file random salt
          this.salt = parsed.salt;
          this.masterKey = this.deriveKey(this.salt);
          records = parsed.records;
        } else {
          // Legacy format fallback
          records = parsed;
        }
      }

      for (const [k, encrypted] of Object.entries(records)) {
        try {
          const decrypted = this.decrypt(encrypted);
          this.memoryCache.set(k, decrypted);
        } catch (err: any) {
          this.lastLoadError = new Error(`Failed to decrypt secret "${k}": invalid passphrase or corrupted record.`);
        }
      }
    } catch (err: any) {
      this.lastLoadError = new Error(`Failed to read secrets file: ${err.message}`);
    }
  }

  private persistToDisk(): void {
    if (!this.storagePath) return;

    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const records: Record<string, EncryptedPayload> = {};
    for (const [k, v] of this.memoryCache.entries()) {
      records[k] = this.encrypt(v);
    }

    const payload: SecretFileFormat = {
      version: 1,
      salt: this.salt,
      records,
    };

    // Atomic Temporary Write + Rename
    const tmpPath = `${this.storagePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storagePath);
    } catch (err: any) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      throw new Error(`Failed to persist secrets to disk at "${this.storagePath}": ${err.message}`);
    }
  }
}
