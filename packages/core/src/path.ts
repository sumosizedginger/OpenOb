import { SecurityError } from './errors.js';
import { VaultPath } from './types.js';

/**
 * Normalizes a path within the vault.
 * - Converts backslashes to forward slashes.
 * - Strips leading and trailing slashes.
 * - Resolves '.' and '..' segments safely.
 * - Throws SecurityError on attempted directory traversal out of the vault root.
 */
export function normalizeVaultPath(rawPath: string): VaultPath {
  if (typeof rawPath !== 'string') {
    throw new SecurityError('Path must be a string');
  }

  const trimmed = rawPath.trim();

  // Check for UNC prefix (\\ or //)
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    throw new SecurityError(`UNC path not allowed in vault: "${rawPath}"`);
  }

  // Check for Windows drive letter prefix (e.g. C: or C:/)
  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new SecurityError(`Drive letter prefix not allowed in vault: "${rawPath}"`);
  }

  // Convert Windows backslashes to forward slashes
  let path = trimmed.replace(/\\/g, '/');

  // Strip leading slashes
  while (path.startsWith('/')) {
    path = path.slice(1);
  }

  // Strip trailing slashes
  while (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }

  if (path === '' || path === '.') {
    return '';
  }

  const segments = path.split('/');
  const resolved: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (resolved.length === 0) {
        throw new SecurityError(`Path traversal attempt detected: "${rawPath}"`);
      }
      resolved.pop();
    } else {
      // Check for illegal or dangerous characters in filename segment
      if (segment.includes('\0') || segment.includes(':')) {
        throw new SecurityError(`Invalid character in path segment: "${rawPath}"`);
      }
      resolved.push(segment);
    }
  }

  return resolved.join('/');
}

export function joinVaultPath(...parts: string[]): VaultPath {
  const joined = parts.filter(Boolean).join('/');
  return normalizeVaultPath(joined);
}

export function dirnameVaultPath(path: VaultPath): VaultPath {
  const normalized = normalizeVaultPath(path);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return '';
  }
  return normalized.substring(0, lastSlash);
}

export function basenameVaultPath(path: VaultPath, ext?: string): string {
  const normalized = normalizeVaultPath(path);
  const lastSlash = normalized.lastIndexOf('/');
  const base = lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
  if (ext && base.endsWith(ext)) {
    return base.substring(0, base.length - ext.length);
  }
  return base;
}

export function extnameVaultPath(path: VaultPath): string {
  const base = basenameVaultPath(path);
  const lastDot = base.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) {
    return '';
  }
  return base.substring(lastDot);
}
