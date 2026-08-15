import { describe, expect, it } from 'vitest';
import { SecurityError } from '../errors.js';
import { basenameVaultPath, dirnameVaultPath, extnameVaultPath, joinVaultPath, normalizeVaultPath } from '../path.js';

describe('normalizeVaultPath', () => {
  it('normalizes standard relative paths', () => {
    expect(normalizeVaultPath('notes/test.md')).toBe('notes/test.md');
    expect(normalizeVaultPath('/notes/test.md')).toBe('notes/test.md');
    expect(normalizeVaultPath('notes//test.md/')).toBe('notes/test.md');
    expect(normalizeVaultPath('notes\\sub\\test.md')).toBe('notes/sub/test.md');
  });

  it('handles empty and root paths', () => {
    expect(normalizeVaultPath('')).toBe('');
    expect(normalizeVaultPath('/')).toBe('');
    expect(normalizeVaultPath('.')).toBe('');
  });

  it('resolves relative segments within bounds', () => {
    expect(normalizeVaultPath('notes/sub/../test.md')).toBe('notes/test.md');
    expect(normalizeVaultPath('a/b/c/../../d.md')).toBe('a/d.md');
  });

  it('throws SecurityError on directory traversal out of root', () => {
    expect(() => normalizeVaultPath('../escape.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('notes/../../escape.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('..')).toThrow(SecurityError);
  });

  it('throws SecurityError on null bytes', () => {
    expect(() => normalizeVaultPath('notes/test\0.md')).toThrow(SecurityError);
  });
});

describe('path helper functions', () => {
  it('joinVaultPath joins and normalizes', () => {
    expect(joinVaultPath('folder', 'sub', 'note.md')).toBe('folder/sub/note.md');
    expect(joinVaultPath('folder/', '/sub/', 'note.md')).toBe('folder/sub/note.md');
  });

  it('dirnameVaultPath returns parent directory', () => {
    expect(dirnameVaultPath('folder/sub/note.md')).toBe('folder/sub');
    expect(dirnameVaultPath('note.md')).toBe('');
    expect(dirnameVaultPath('')).toBe('');
  });

  it('basenameVaultPath extracts base name', () => {
    expect(basenameVaultPath('folder/sub/note.md')).toBe('note.md');
    expect(basenameVaultPath('folder/sub/note.md', '.md')).toBe('note');
    expect(basenameVaultPath('note.md', '.md')).toBe('note');
  });

  it('extnameVaultPath extracts extension', () => {
    expect(extnameVaultPath('folder/note.md')).toBe('.md');
    expect(extnameVaultPath('note.tar.gz')).toBe('.gz');
    expect(extnameVaultPath('note')).toBe('');
    expect(extnameVaultPath('.hidden')).toBe('');
  });
});
