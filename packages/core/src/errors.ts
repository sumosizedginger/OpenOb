import { FileVersion, VaultPath } from './types.js';

export class VaultError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VAULT_ERROR'
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export class NotFoundError extends VaultError {
  constructor(
    public readonly path: VaultPath,
    message?: string
  ) {
    super(message || `Path not found: "${path}"`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends VaultError {
  constructor(
    public readonly path: VaultPath,
    public readonly expectedVersion: FileVersion | null,
    public readonly actualVersion: FileVersion | null,
    public readonly currentContent?: Uint8Array,
    message?: string
  ) {
    super(
      message ||
        `Conflict detected on "${path}": expected token "${expectedVersion?.token ?? 'null'}" but current token is "${actualVersion?.token ?? 'null'}"`,
      'CONFLICT'
    );
    this.name = 'ConflictError';
  }
}

export class SecurityError extends VaultError {
  constructor(message: string) {
    super(message, 'SECURITY_VIOLATION');
    this.name = 'SecurityError';
  }
}

export class StorageError extends VaultError {
  constructor(
    message: string,
    public readonly causeError?: unknown
  ) {
    super(message, 'STORAGE_ERROR');
    this.name = 'StorageError';
  }
}
