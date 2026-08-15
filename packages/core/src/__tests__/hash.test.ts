import { describe, expect, it } from 'vitest';
import { computeContentHash, createVersionToken } from '../hash.js';

describe('computeContentHash & createVersionToken', () => {
  it('generates consistent hashes for same content', () => {
    const text = '# Hello World\nThis is a test document.';
    const h1 = computeContentHash(text);
    const h2 = computeContentHash(text);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it('generates different hashes for modified content', () => {
    const h1 = computeContentHash('version 1');
    const h2 = computeContentHash('version 2');
    expect(h1).not.toBe(h2);
  });

  it('works with Uint8Array content', () => {
    const bytes = new TextEncoder().encode('binary content');
    const h = computeContentHash(bytes);
    expect(h).toBe(computeContentHash('binary content'));
  });

  it('generates version token with metadata', () => {
    const token = createVersionToken('1234567890abcdef', 1700000000000, 512);
    expect(token).toContain('1234567890abcdef');
    expect(token.split(':')).toHaveLength(3);
  });
});
