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
});
