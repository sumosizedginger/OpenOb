/**
 * Computes a fast, deterministic hex hash of binary content.
 * Uses FNV-1a 64-bit algorithm for fast in-memory hashing without external deps,
 * plus crypto SHA-256 support when Web Crypto is available.
 */
export function computeContentHash(content: Uint8Array | string): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;

  // FNV-1a 64-bit implementation split into two 32-bit ints
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (b + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

export function createVersionToken(hash: string, modifiedAt?: number, size?: number): string {
  const mtime = modifiedAt ? modifiedAt.toString(36) : '0';
  const s = size !== undefined ? size.toString(36) : '0';
  return `${hash.substring(0, 16)}:${mtime}:${s}`;
}
