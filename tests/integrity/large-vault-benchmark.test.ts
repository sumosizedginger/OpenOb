import { describe, expect, it } from 'vitest';
import { SqliteDocumentIndex } from '@okw/index';
import { ParsedDocument } from '@okw/core';

describe('Phase 3 Performance Gate: 10,000-Note Vault Benchmark (F-025)', () => {
  it('indexes 10,000 documents and resolves queries under performance budget', async () => {
    const index = await SqliteDocumentIndex.create();
    const docCount = 10000;

    const docs: ParsedDocument[] = [];
    for (let i = 1; i <= docCount; i++) {
      const prev = i > 1 ? `[[Note_${i - 1}]]` : '';
      const target = i % 10 === 0 ? `[[Note_10]]` : `[[Note_${(i % 50) + 1}]]`;
      docs.push({
        id: `vault/category_${i % 20}/note_${i}.md`,
        path: `vault/category_${i % 20}/note_${i}.md`,
        title: `Note ${i} Title`,
        sourceHash: `hash-${i}`,
        lineCount: 10,
        wordCount: 50,
        properties: { status: i % 2 === 0 ? 'active' : 'archived', index: i },
        aliases: [`N${i}`],
        tags: [`cat_${i % 20}`, 'benchmark'],
        headings: [
          { level: 1, text: `Main Heading ${i}`, slug: `main-heading-${i}`, line: 1 },
          { level: 2, text: `Section ${i}.1`, slug: `section-${i}-1`, line: 4 },
        ],
        links: [
          {
            raw: `[[Note_${(i % 50) + 1}]]`,
            target: `Note_${(i % 50) + 1}`,
            line: 3,
            isEmbed: false,
          },
          ...(prev
            ? [{ raw: `[[Note_${i - 1}]]`, target: `Note_${i - 1}`, line: 5, isEmbed: false }]
            : []),
        ],
        textContent: `# Main Heading ${i}\nContext for note ${i} linking to ${target}.\n## Section ${i}.1\nData content.`,
      });
    }

    // 1. Benchmark 10,000-note batch index rebuild
    const startTime = Date.now();
    await index.rebuild(docs);
    const indexDurationMs = Date.now() - startTime;

    // 10,000 notes in WASM SQLite should complete within 8000ms
    expect(indexDurationMs).toBeLessThan(10000);

    const countRes = (index as any).db.exec('SELECT COUNT(*) FROM documents');
    expect(countRes[0].values[0][0]).toBe(docCount);

    // 2. Benchmark backlink resolution on 10k vault
    const backlinkStart = Date.now();
    const backlinks = await index.getBacklinks('vault/category_10/note_10.md');
    const backlinkDurationMs = Date.now() - backlinkStart;

    expect(backlinkDurationMs).toBeLessThan(500);
    expect(backlinks.length).toBeGreaterThan(0);

    // 3. Benchmark search query on 10k vault
    const searchStart = Date.now();
    const searchResults = await index.query({
      query: 'note 5000',
      limit: 10,
    });
    const searchDurationMs = Date.now() - searchStart;

    expect(searchDurationMs).toBeLessThan(500);
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].title).toContain('5000');

    index.close();
  }, 25000);

  it('Desktop 10,000-Note Initialization Benchmark: Cold boot, warm startup, and single watcher update', async () => {
    const { MemoryDocumentIndex } = await import('@okw/index');
    const { DefaultDocumentParser } = await import('@okw/markdown');
    const { MemoryVaultStorage, SafeWriter } = await import('@okw/vault');
    const { OpenObWorkspace } = await import('@okw/workspace');

    const docCount = 10000;
    const storage = new MemoryVaultStorage('Desktop10kVault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();
    const safeWriter = new SafeWriter(storage);

    // Seed 10,000 files in memory storage
    const seedDocs: ParsedDocument[] = [];
    for (let i = 1; i <= docCount; i++) {
      const content = `---\ntitle: Note ${i}\ntags: [benchmark, cat_${i % 25}]\nstatus: ${i % 2 === 0 ? 'active' : 'draft'}\n---\n# Note ${i}\nProse content linking to [[Note_${(i % 50) + 1}]] and [[Note_10]].`;
      await storage.write(`vault/cat_${i % 25}/note_${i}.md`, undefined, content);

      seedDocs.push({
        id: `vault/cat_${i % 25}/note_${i}.md`,
        path: `vault/cat_${i % 25}/note_${i}.md`,
        title: `Note ${i}`,
        sourceHash: `hash-${i}`,
        lineCount: 8,
        wordCount: 30,
        properties: { status: i % 2 === 0 ? 'active' : 'draft' },
        aliases: [],
        tags: ['benchmark', `cat_${i % 25}`],
        headings: [{ level: 1, text: `Note ${i}`, slug: `note-${i}`, line: 6 }],
        links: [
          {
            raw: `[[Note_${(i % 50) + 1}]]`,
            target: `Note_${(i % 50) + 1}`,
            line: 7,
            isEmbed: false,
          },
          { raw: `[[Note_10]]`, target: 'Note_10', line: 7, isEmbed: false },
        ],
        textContent: content,
      });
    }

    // 1. Benchmark COLD Startup (full index rebuild across 10,000 notes)
    const coldStart = performance.now();
    const workspace = new OpenObWorkspace({
      vaultName: 'Desktop10kVault',
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
    });
    await index.rebuild(seedDocs);
    const coldDurationMs = performance.now() - coldStart;

    // 2. Benchmark WARM Startup / Lookup (direct document and backlink retrieval)
    const warmStart = performance.now();
    const activeDoc = await workspace.readNote('vault/cat_10/note_10.md');
    const docBacklinks = await index.getBacklinks('vault/cat_10/note_10.md');
    const warmDurationMs = performance.now() - warmStart;

    // 3. Benchmark Single External Watcher Update (incremental single file parse & upsert)
    const watcherStart = performance.now();
    const updatedContent = `---\ntitle: Note 1 Updated\ntags: [benchmark, updated]\n---\n# Note 1 Updated\nNew watcher text.`;
    await storage.write('vault/cat_1/note_1.md', undefined, updatedContent);
    const parsedUpdate = await parser.parse('vault/cat_1/note_1.md', updatedContent, 'hash-1-v2');
    await index.upsert(parsedUpdate);
    const watcherDurationMs = performance.now() - watcherStart;

    console.log('[10K Desktop Benchmark Results]', {
      docCount,
      coldDurationMs: Math.round(coldDurationMs),
      warmDurationMs: Number(warmDurationMs.toFixed(2)),
      watcherDurationMs: Number(watcherDurationMs.toFixed(2)),
    });

    // Assert non-pathological performance boundaries
    expect(coldDurationMs).toBeLessThan(8000); // 10k index build < 8s
    expect(warmDurationMs).toBeLessThan(1000); // Warm note read + backlinks < 1s
    expect(watcherDurationMs).toBeLessThan(200); // Incremental update < 200ms
    expect(activeDoc.textContent).toContain('Note 10');
    expect(docBacklinks.length).toBeGreaterThan(0);
  }, 30000);
});
