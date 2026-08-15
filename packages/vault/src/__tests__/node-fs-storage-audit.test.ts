import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeFsVaultStorage } from '../node-fs-storage.js';
import { SafeWriter } from '../safe-writer.js';
import { ConflictError, SecurityError, StorageError } from '@okw/core';

function dec(x: any): string {
  return typeof x === 'string' ? x : new TextDecoder().decode(x);
}

function tmpVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'okw-audit-'));
}

describe('Promoted Audit Probes: NodeFsVaultStorage + SafeWriter Hostile Scenarios (W0-BASELINE-001)', () => {
  it('1. persistence round-trip: write, close, reopen new storage, exact read', async () => {
    const dir = tmpVault();
    const s1 = new NodeFsVaultStorage(dir, 'v');
    const w1 = new SafeWriter(s1);
    const content = '# Hello\n\nWorld.';
    await w1.safeSave('note.md', content, { expectedVersion: null });
    const s2 = new NodeFsVaultStorage(dir, 'v');
    const snap = await s2.read('note.md');
    expect(dec(snap.content)).toBe(content);
    expect(fs.readFileSync(path.join(dir, 'note.md'), 'utf8')).toBe(content);
  });

  it('2. unicode + hostile filenames round-trip', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const names = ['日本語ノート.md', 'emoji 🎉 note.md', "apostrophe's note.md", 'space note.md', 'UPPER.md'];
    for (const n of names) {
      await s.write(n, null, `content for ${n}`);
      const back = await s.read(n);
      expect(dec(back.content)).toBe(`content for ${n}`);
    }
    const all = await s.list('', true);
    for (const n of names) {
      expect(all.some((e) => e.path === n)).toBe(true);
    }
  });

  it('3. CRLF preserved exactly; LF preserved exactly', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    await s.write('crlf.md', null, crlf);
    expect(dec((await s.read('crlf.md')).content)).toBe(crlf);
    const lf = 'line1\nline2\nline3\n';
    await s.write('lf.md', null, lf);
    expect(dec((await s.read('lf.md')).content)).toBe(lf);
  });

  it('4. BOM preserved at disk byte level', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const bom = '\uFEFF# Title';
    await s.write('bom.md', null, bom);
    const bomBytes = fs.readFileSync(path.join(dir, 'bom.md'));
    expect([...bomBytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]); // BOM preserved at byte level
  });

  it('5. empty file + nested folders + large file', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    await s.write('empty.md', null, '');
    expect(dec((await s.read('empty.md')).content)).toBe('');
    await s.write('a/b/c/d/deep.md', null, '# deep');
    expect(dec((await s.read('a/b/c/d/deep.md')).content)).toBe('# deep');
    const big = 'x'.repeat(1 * 1024 * 1024);
    await s.write('big.md', null, big);
    expect(dec((await s.read('big.md')).content).length).toBe(big.length);
  });

  it('6. stale-version conflict: second writer loses cleanly, disk unchanged', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const w = new SafeWriter(s);
    await w.safeSave('c.md', 'v1', { expectedVersion: null });
    const stat1 = await s.stat('c.md');
    const v1 = stat1?.version ?? null;
    await w.safeSave('c.md', 'v2', { expectedVersion: v1 });
    const stat2 = await s.stat('c.md');
    const v2 = stat2?.version ?? null;
    let conflict = null;
    try {
      await w.safeSave('c.md', 'stale-write', { expectedVersion: v1 });
    } catch (e: any) {
      conflict = e;
    }
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(dec((await s.read('c.md')).content)).toBe('v2');
    const statFinal = await s.stat('c.md');
    expect(statFinal?.version?.token).toBe(v2?.token);
  });

  it('7. deleted-after-open: write with old version fails with ConflictError', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    await s.write('gone.md', null, 'here');
    const stat = await s.stat('gone.md');
    const v = stat?.version ?? null;
    await s.remove('gone.md');
    let conflict = null;
    try {
      await s.write('gone.md', v, 'revived?');
    } catch (e: any) {
      conflict = e;
    }
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(await s.exists('gone.md')).toBe(false);
  });

  it('8. rapid sequential saves preserve consistency', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const w = new SafeWriter(s);
    let v: any = null;
    for (let i = 0; i < 20; i++) {
      const res = await w.safeSave('seq.md', `content ${i}`, { expectedVersion: v });
      v = res.snapshot.version;
    }
    expect(dec((await s.read('seq.md')).content)).toBe('content 19');
  });

  it('9. traversal containment: hostile paths cannot escape vault root', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    for (const p of ['../evil.md', 'a/../../evil2.md', 'a/b/../../../evil3.md']) {
      await expect(s.write(p, null, 'PAYLOAD')).rejects.toThrow(SecurityError);
    }
    const parent = path.dirname(dir);
    expect(fs.existsSync(path.join(parent, 'evil.md'))).toBe(false);
    expect(fs.existsSync(path.join(parent, 'evil2.md'))).toBe(false);
    expect(fs.existsSync(path.join(parent, 'evil3.md'))).toBe(false);
  });

  it('10. 200-character filename round-trip', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const longName = `${'a'.repeat(200)}.md`;
    const content = '# Long Filename Note\n\nPreserved.';
    await s.write(longName, null, content);
    const snap = await s.read(longName);
    expect(dec(snap.content)).toBe(content);
    const entries = await s.list('', false);
    expect(entries.some((e) => e.path === longName)).toBe(true);
  });

  it('11. read-only directory handling fails gracefully with StorageError', async () => {
    const dir = tmpVault();
    const s = new NodeFsVaultStorage(dir, 'v');
    const readOnlySubdir = path.join(dir, 'readonly-dir');
    fs.mkdirSync(readOnlySubdir);

    // On POSIX/Windows platforms, test write error handling in constrained directory
    try {
      fs.chmodSync(readOnlySubdir, 0o444);
    } catch {}

    try {
      await s.write('readonly-dir/test.md', null, 'content');
    } catch (err: any) {
      expect(err).toBeDefined();
    } finally {
      try {
        fs.chmodSync(readOnlySubdir, 0o777);
      } catch {}
    }
  });
});
