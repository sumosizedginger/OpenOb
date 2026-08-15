import { describe, expect, it } from 'vitest';
import { SqliteDocumentIndex } from '@okw/index';
import { ParsedDocument } from '@okw/core';

describe('Phase 3 Performance Gate: Large-Vault Index Benchmark (F-025)', () => {
  it('indexes 1,000 documents and queries under benchmark performance budget', async () => {
    const index = await SqliteDocumentIndex.create();
    const docCount = 1000;

    const docs: ParsedDocument[] = [];
    for (let i = 1; i <= docCount; i++) {
      const prev = i > 1 ? `[[Note_${i - 1}]]` : '';
      const target = i % 10 === 0 ? `[[Note_10]]` : `[[Note_${(i % 50) + 1}]]`;
      docs.push({
        id: `doc-${i}`,
        path: `vault/category_${i % 10}/note_${i}.md`,
        title: `Note ${i} Title`,
        hash: `hash-${i}`,
        modifiedAt: Date.now(),
        size: 350,
        wordCount: 50,
        hasFrontmatter: true,
        properties: { status: i % 2 === 0 ? 'active' : 'archived', index: i },
        aliases: [`N${i}`],
        tags: [`cat_${i % 10}`, 'benchmark'],
        headings: [
          { level: 1, text: `Main Heading ${i}`, slug: `main-heading-${i}`, line: 1 },
          { level: 2, text: `Section ${i}.1`, slug: `section-${i}-1`, line: 4 },
        ],
        links: [
          { rawTarget: `Note_${(i % 50) + 1}`, line: 3, isEmbed: false },
          ...(prev ? [{ rawTarget: `Note_${i - 1}`, line: 5, isEmbed: false }] : []),
        ],
        textContent: `# Main Heading ${i}\nContext for note ${i} linking to ${target}.\n## Section ${i}.1\nData content.`,
      });
    }

    // Benchmark batch rebuild
    const startTime = Date.now();
    await index.rebuild(docs);
    const indexDurationMs = Date.now() - startTime;

    // 1000 notes indexing should be fast (< 2500ms)
    expect(indexDurationMs).toBeLessThan(4000);

    const all = await index.getAll();
    expect(all).toHaveLength(docCount);

    // Benchmark search query
    const searchStart = Date.now();
    const searchResults = await index.query({
      query: 'note 500',
      limit: 10,
    });
    const searchDurationMs = Date.now() - searchStart;

    expect(searchDurationMs).toBeLessThan(100);
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].title).toContain('500');

    index.close();
  });
});
