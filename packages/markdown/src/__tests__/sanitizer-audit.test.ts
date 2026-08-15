import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '../parser.js';

describe('Promoted Audit Probes: Markdown Parser Hostile Corpus (W0-BASELINE-001)', () => {
  const parser = new DefaultDocumentParser();

  it('malformed YAML frontmatter does not crash or destroy content', async () => {
    const docs = [
      '---\ntitle: unclosed\n# body',
      '---\n: : : bad yaml :\n---\n# body',
      '---\ntitle: dup\ntitle: dup2\ntags: [a]\n---\n# body',
      '---\n' + 'key: value\n'.repeat(500) + '---\n# body',
      '# Heading\n\n[[link with space]]\n\n![[embed.md]]\n\n[[a|alias#heading]]',
      '```\n[[not-a-link]]\n# not a heading\n```\n\n# Real Heading',
      '\\[\\[escaped\\]\\]\n\n# Head',
      '## 日本語見出し with unicode 🎉\n\nbody',
      '#1\n\nbody',
      '###### H6\n\n####### H7?\n\nbody',
    ];
    for (const content of docs) {
      const parsed = await parser.parse('probe.md', content);
      expect(parsed).toBeDefined();
      expect(parsed.title).toBeDefined();
      expect(parsed.path).toBe('probe.md');
    }
  });

  it('links inside code fences are NOT extracted as links', async () => {
    const content = '```\n[[fake-link]]\n```\n\nReal: [[real-link]]\n';
    const parsed = await parser.parse('fence.md', content);
    const targets = parsed.links.map((l) => l.target);
    expect(targets).toContain('real-link');
    expect(targets).not.toContain('fake-link');
  });

  it('CRLF content parses with correct line numbers', async () => {
    const content = '# Title\r\n\r\nBody [[target]]\r\n## Sub\r\n';
    const parsed = await parser.parse('crlf.md', content);
    expect(parsed.headings.length).toBe(2);
    const link = parsed.links.find((l) => l.target === 'target');
    expect(link).toBeDefined();
    expect(link!.line).toBe(3);
  });

  it('empty and whitespace-only notes parse safely', async () => {
    for (const c of ['', '   ', '\n\n\n', '# Only heading']) {
      const parsed = await parser.parse('empty.md', c);
      expect(parsed).toBeDefined();
    }
  });

  it('very large note parses without throwing', async () => {
    const big = '# H\n\nparagraph with [[link]] and text.\n\n'.repeat(10000);
    const t = Date.now();
    const parsed = await parser.parse('big.md', big);
    expect(Date.now() - t).toBeLessThan(10000);
    expect(parsed.textContent.length).toBeGreaterThan(100000);
  });
});
