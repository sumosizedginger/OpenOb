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

export class DesktopSecretStore implements SecretStore {
  private readonly storagePath: string | null;
  private readonly masterKey: Buffer;
  private memoryCache: Map<string, string> = new Map();

  constructor(options: DesktopSecretStoreOptions) {
    if (!options?.masterSecret || typeof options.masterSecret !== 'string' || options.masterSecret.trim().length === 0) {
      throw new Error('DesktopSecretStore requires a non-empty masterSecret passphrase');
    }

    this.storagePath = options.storagePath ? path.resolve(options.storagePath) : null;

    // Derive 256-bit key using PBKDF2 with system salt
    const salt = Buffer.from('okw-desktop-key-salt-v1', 'utf8');
    this.masterKey = crypto.pbkdf2Sync(options.masterSecret, salt, 100000, 32, 'sha256');

    this.loadFromDisk();
  }

  async getSecret(providerId: string): Promise<string | null> {
    return this.memoryCache.get(providerId) || null;
  }

  async setSecret(providerId: string, value: string): Promise<void> {
    const cleanSecret = value.trim();
    if (!cleanSecret) {
      await this.clearSecret(providerId);
      return;
    }
    this.memoryCache.set(providerId, cleanSecret);
    this.persistToDisk();
  }

  async clearSecret(providerId: string): Promise<void> {
    this.memoryCache.delete(providerId);
    this.persistToDisk();
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
      const records: Record<string, EncryptedPayload> = JSON.parse(raw);
      for (const [k, encrypted] of Object.entries(records)) {
        try {
          const decrypted = this.decrypt(encrypted);
          this.memoryCache.set(k, decrypted);
        } catch {
          // Authentication error or corrupted entry
        }
      }
    } catch {
      // File read error
    }
  }

  private persistToDisk(): void {
    if (!this.storagePath) return;

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const records: Record<string, EncryptedPayload> = {};
      for (const [k, v] of this.memoryCache.entries()) {
        records[k] = this.encrypt(v);
      }

      fs.writeFileSync(this.storagePath, JSON.stringify(records, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist secrets to disk:', err);
    }
  }
}
