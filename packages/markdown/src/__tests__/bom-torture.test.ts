import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../frontmatter.js';
import { DefaultDocumentParser } from '../parser.js';

describe('UTF-8 BOM Frontmatter Torture Test (M-03)', () => {
  it('correctly parses frontmatter when file begins with UTF-8 BOM (\\uFEFF)', async () => {
    const rawWithBOM = '\uFEFF---\ntitle: BOM Notes\ntags: [windows, unicode]\n---\n# BOM Notes\nBody text.';
    
    const fm = parseFrontmatter(rawWithBOM);
    expect(fm.hasFrontmatter).toBe(true);
    expect(fm.properties.title).toBe('BOM Notes');
    expect(fm.properties.tags).toEqual(['windows', 'unicode']);

    const parser = new DefaultDocumentParser();
    const doc = await parser.parse('bom.md', rawWithBOM);
    expect(doc.title).toBe('BOM Notes');
    expect(doc.tags).toContain('windows');
    expect(doc.tags).toContain('unicode');
  });
});
