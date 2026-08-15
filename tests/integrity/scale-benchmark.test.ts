import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeFsVaultStorage } from '@okw/vault';
import { SqliteDocumentIndex, rebuildVaultIndex, buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';

function genDoc(i: number, n: number): string {
  const prev = i > 1 ? `[[Note_${i - 1}]]` : '';
  const target = `[[Note_${((i % 50) + 1).toString().padStart(5, '0')}]]`;
  return `---
title: Note ${i}
status: ${i % 2 === 0 ? 'active' : 'archived'}
tags: [cat_${i % 20}, benchmark]
---
# Note ${i}

Context paragraph for note ${i} referencing ${target}.
${prev ? `See also ${prev}.` : ''}

## Section A
- bullet one
- bullet two

## Section B
More content about category ${i % 20}.
`;
}

describe('Promoted Scale Benchmark (W0-BASELINE-001 / P1-SCALE-001)', () => {
  it('Real Pipeline: 1,000 files on disk -> parse -> rebuild -> search -> backlinks -> graph', { timeout: 30000 }, async () => {
    const n = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `okw-bench-${n}-`));
    const s = new NodeFsVaultStorage(dir, 'v');

    try {
      // 1. Seed files
      for (let i = 1; i <= n; i++) {
        const sub = `cat_${i % 20}`;
        await s.write(`${sub}/Note_${String(i).padStart(5, '0')}.md`, null, genDoc(i, n));
      }

      // 2. Index rebuild
      const idx = await SqliteDocumentIndex.create();
      const t1 = Date.now();
      await rebuildVaultIndex(s, idx, new DefaultDocumentParser());
      const rebuildMs = Date.now() - t1;

      // 3. Search query
      const t2 = Date.now();
      const res = await idx.query({ query: `Note 500`, limit: 10 });
      const searchMs = Date.now() - t2;

      // 4. Backlinks
      const t3 = Date.now();
      await idx.getBacklinks(`cat_0/Note_00001.md`);
      const backlinkMs = Date.now() - t3;

      // 5. Graph
      const t4 = Date.now();
      await buildGraphData(idx);
      const graphMs = Date.now() - t4;

      idx.close();

      expect(rebuildMs).toBeLessThan(10000);
      expect(searchMs).toBeLessThan(500);
      expect(backlinkMs).toBeLessThan(200);
      expect(graphMs).toBeLessThan(5000);
      expect(res.length).toBeGreaterThanOrEqual(1);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('Engine-Only: 10,000 synthetic documents into SqliteDocumentIndex', { timeout: 30000 }, async () => {
    const n = 10000;
    const docs: any[] = [];
    for (let i = 1; i <= n; i++) {
      const target = `Note_${((i % 50) + 1).toString().padStart(5, '0')}`;
      docs.push({
        id: `cat_${i % 20}/note_${i}.md`,
        path: `cat_${i % 20}/note_${i}.md`,
        title: `Note ${i}`,
        sourceHash: `hash-${i}`,
        lineCount: 12,
        wordCount: 60,
        properties: { status: i % 2 === 0 ? 'active' : 'archived', index: i },
        aliases: [`N${i}`],
        tags: [`cat_${i % 20}`, 'benchmark'],
        headings: [
          { level: 1, text: `Note ${i}`, slug: `note-${i}`, line: 1 },
          { level: 2, text: `Section A ${i}`, slug: `section-a-${i}`, line: 5 },
        ],
        links: [
          { raw: `[[${target}]]`, target, line: 3, isEmbed: false },
          ...(i > 1 ? [{ raw: `[[Note_${String(i - 1).padStart(5, '0')}]]`, target: `Note_${String(i - 1).padStart(5, '0')}`, line: 5, isEmbed: false }] : []),
        ],
        textContent: `Note ${i} content`,
      });
    }

    const idx = await SqliteDocumentIndex.create();
    const t0 = Date.now();
    await idx.rebuild(docs);
    const rebuildMs = Date.now() - t0;

    const t1 = Date.now();
    const searchRes = await idx.query({ query: 'Note 5000', limit: 10 });
    const searchMs = Date.now() - t1;

    idx.close();

    expect(rebuildMs).toBeLessThan(5000);
    expect(searchMs).toBeLessThan(500);
    expect(searchRes.length).toBeGreaterThanOrEqual(1);
  });
});
