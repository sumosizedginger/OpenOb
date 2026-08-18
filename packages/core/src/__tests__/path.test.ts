import { describe, expect, it } from 'vitest';
import { SecurityError } from '../errors.js';
import {
  RESERVED_WORKSPACE_PREFIX,
  basenameVaultPath,
  dirnameVaultPath,
  extnameVaultPath,
  isReservedWorkspacePath,
  joinVaultPath,
  normalizeVaultPath,
} from '../path.js';

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
    expect(() => normalizeVaultPath('..\\..\\escape.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('a\\..\\..\\evil.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('..')).toThrow(SecurityError);
  });

  it('throws SecurityError on Windows drive letter and UNC paths', () => {
    expect(() => normalizeVaultPath('C:\\evil.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('C:evil.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('D:/folder/note.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('\\\\server\\share\\note.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('//server/share/note.md')).toThrow(SecurityError);
  });

  it('throws SecurityError on null bytes and colon characters', () => {
    expect(() => normalizeVaultPath('notes/test\0.md')).toThrow(SecurityError);
    expect(() => normalizeVaultPath('notes/test:stream.md')).toThrow(SecurityError);
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

describe('isReservedWorkspacePath and RESERVED_WORKSPACE_PREFIX', () => {
  it('exports RESERVED_WORKSPACE_PREFIX as .openob', () => {
    expect(RESERVED_WORKSPACE_PREFIX).toBe('.openob');
  });

  it('correctly identifies exact and nested reserved .openob paths across all case variants', () => {
    expect(isReservedWorkspacePath('.openob')).toBe(true);
    expect(isReservedWorkspacePath('.openob/')).toBe(true);
    expect(isReservedWorkspacePath('.openob/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('.openob/evil.md')).toBe(true);
    expect(isReservedWorkspacePath('.openob/foo/bar')).toBe(true);

    // Case-variant tests (P1)
    expect(isReservedWorkspacePath('.OPENOB')).toBe(true);
    expect(isReservedWorkspacePath('.OpenOb')).toBe(true);
    expect(isReservedWorkspacePath('.oPeNoB')).toBe(true);
    expect(isReservedWorkspacePath('.OPENOB/')).toBe(true);
    expect(isReservedWorkspacePath('.OPENOB/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('.OpenOb/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('.oPeNoB/evil.md')).toBe(true);
    expect(isReservedWorkspacePath('.OPENOB/foo/bar')).toBe(true);
  });

  it('correctly identifies normalized aliases resolving to .openob across case variants', () => {
    expect(isReservedWorkspacePath('./.openob/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('foo/../.openob/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('.openob\\views\\x.json')).toBe(true);
    expect(isReservedWorkspacePath('/.openob/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('/.openob')).toBe(true);
    expect(isReservedWorkspacePath('./.openob')).toBe(true);

    // Case-variant aliases
    expect(isReservedWorkspacePath('./.OPENOB/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('foo/../.OPENOB/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('.OPENOB\\views\\x.json')).toBe(true);
    expect(isReservedWorkspacePath('/.OPENOB/views/x.json')).toBe(true);
    expect(isReservedWorkspacePath('/.OpenOb')).toBe(true);
    expect(isReservedWorkspacePath('./.oPeNoB')).toBe(true);
  });

  it('does NOT incorrectly match near-miss or prefix-like note names across case variants', () => {
    expect(isReservedWorkspacePath('.openobserver.md')).toBe(false);
    expect(isReservedWorkspacePath('.OPENOBSERVER.md')).toBe(false);
    expect(isReservedWorkspacePath('.OpenObserver.md')).toBe(false);
    expect(isReservedWorkspacePath('.openob-notes/foo.md')).toBe(false);
    expect(isReservedWorkspacePath('.OPENOB-NOTES/foo.md')).toBe(false);
    expect(isReservedWorkspacePath('notes/.openobservation.md')).toBe(false);
    expect(isReservedWorkspacePath('notes/.OPENOBservation.md')).toBe(false);
    expect(isReservedWorkspacePath('foo.openob/bar.md')).toBe(false);
    expect(isReservedWorkspacePath('foo.OPENOB/bar.md')).toBe(false);
    expect(isReservedWorkspacePath('notes/ordinary.md')).toBe(false);
    expect(isReservedWorkspacePath('ordinary.md')).toBe(false);
    expect(isReservedWorkspacePath('')).toBe(false);
    expect(isReservedWorkspacePath('.')).toBe(false);
  });
});
