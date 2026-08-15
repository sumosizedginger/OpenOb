import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';
import { SqliteDocumentIndex, rebuildVaultIndex } from '@okw/index';

describe('Phase 3 Exit Gate: SQLite Index Disposal & Exact Rebuild (D-002 / F-003 / F-004)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-sqlite-rebuild-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('proves SQLite database can be completely deleted and rebuilt to identical state from disk files', async () => {
    const vault = new NodeFsVaultStorage(tmpDir);
    const writer = new SafeWriter(vault);
    const parser = new DefaultDocumentParser();

    // Create 10 interconnected notes on physical disk
    for (let i = 1; i <= 10; i++) {
      const prev = i > 1 ? `[[Note_${i - 1}]]` : 'None';
      const next = i < 10 ? `[[Note_${i + 1}]]` : 'None';
      const content = `---
title: Note ${i}
tags: [batch, group_${i % 2 === 0 ? 'even' : 'odd'}]
aliases: [Alias_${i}]
---

# Note ${i} Main Heading

This is note number ${i}.
- Previous: ${prev}
- Next: ${next}
- Root reference: [[Note_1]]
`;
      await writer.safeSave(`Notes/Note_${i}.md`, content);
    }

    // === PHASE 1: Build Initial SQLite Index ===
    let originalIndex = await SqliteDocumentIndex.create();
    const rep1 = await rebuildVaultIndex(vault, originalIndex, parser);
    expect(rep1.totalIndexed).toBe(10);

    const origDocs = await originalIndex.getAll();
    expect(origDocs).toHaveLength(10);

    const origBacklinksToNote1 = await originalIndex.getBacklinks('Notes/Note_1.md');
    // Note 2 points to Note 1 (previous), and Notes 2..10 point to Note 1 as root reference
    expect(origBacklinksToNote1.length).toBeGreaterThanOrEqual(9);

    const origSearch = await originalIndex.query({ query: 'Main Heading' });
    expect(origSearch).toHaveLength(10);

    // === SIMULATE COMPLETE DATABASE DELETION / CORRUPTION ===
    // Close and destroy the SQLite database instance
    originalIndex.close();
    (originalIndex as any) = null;

    // === PHASE 2: Rebuild Brand New SQLite Index from scratch ===
    const rebuiltIndex = await SqliteDocumentIndex.create();
    const rep2 = await rebuildVaultIndex(vault, rebuiltIndex, parser);
    expect(rep2.totalIndexed).toBe(10);

    // === ASSERTION: Rebuilt State is 100% Identical to Original ===
    const rebuiltDocs = await rebuiltIndex.getAll();
    expect(rebuiltDocs).toHaveLength(10);

    for (let i = 0; i < 10; i++) {
      expect(rebuiltDocs[i].id).toBe(origDocs[i].id);
      expect(rebuiltDocs[i].title).toBe(origDocs[i].title);
      expect(rebuiltDocs[i].sourceHash).toBe(origDocs[i].sourceHash);
      expect(rebuiltDocs[i].tags).toEqual(origDocs[i].tags);
      expect(rebuiltDocs[i].aliases).toEqual(origDocs[i].aliases);
      expect(rebuiltDocs[i].headings).toEqual(origDocs[i].headings);
      expect(rebuiltDocs[i].links).toEqual(origDocs[i].links);
    }

    const rebuiltBacklinksToNote1 = await rebuiltIndex.getBacklinks('Notes/Note_1.md');
    expect(rebuiltBacklinksToNote1).toEqual(origBacklinksToNote1);

    const rebuiltSearch = await rebuiltIndex.query({ query: 'Main Heading' });
    expect(rebuiltSearch.map((r) => r.path)).toEqual(origSearch.map((r) => r.path));

    rebuiltIndex.close();
  });
});
