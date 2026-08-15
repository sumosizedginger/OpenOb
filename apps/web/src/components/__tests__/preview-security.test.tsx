import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewPane } from '../PreviewPane.js';
import { ParsedDocument } from '@okw/core';

describe('PreviewPane Renderer Security & Hostile HTML Text Escaping', () => {
  const hostileCorpus = [
    '<img src="x" on&#101;rror=alert(1)>',
    '<div style="background:url(javascript:alert(1))">',
    '<scr<script>ipt>alert(1)</scr<script>ipt>',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
  ];

  it('renders hostile HTML payloads strictly as escaped text without executable elements or attributes', () => {
    const rawMarkdown = hostileCorpus.join('\n\n');
    const doc: ParsedDocument = {
      id: 'hostile-test.md',
      path: 'hostile-test.md',
      title: 'Hostile Preview Security Test',
      sourceHash: 'hash-hostile-123',
      wordCount: 50,
      lineCount: 12,
      textContent: rawMarkdown,
      links: [],
      headings: [],
      tags: [],
      properties: {},
      aliases: [],
    };

    const markup = renderToStaticMarkup(
      <PreviewPane
        document={doc}
        onNavigateWikilink={() => {}}
      />
    );

    // 1. Ensure HTML tags are escaped and never rendered as live HTML DOM tags
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<div style=');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('<iframe');
    expect(markup).not.toContain('<a href="javascript:');
    expect(markup).not.toContain('<a xlink:href=');
    expect(markup).not.toContain('onerror=');

    // 2. Ensure all hostile strings appear safely escaped in the output
    expect(markup).toContain('&lt;img src=&quot;x&quot; on&amp;#101;rror=alert(1)&gt;');
    expect(markup).toContain('&lt;div style=&quot;background:url(javascript:alert(1))&quot;&gt;');
    expect(markup).toContain('&lt;scr&lt;script&gt;ipt&gt;alert(1)&lt;/scr&lt;script&gt;ipt&gt;');
    expect(markup).toContain('&lt;svg&gt;&lt;a xlink:href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;&lt;/svg&gt;');
    expect(markup).toContain('&lt;iframe srcdoc=&quot;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;/iframe&gt;');
    expect(markup).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;');
  });

  it('prohibits dangerouslySetInnerHTML across the entire web application code tree', async () => {
    const fs = await import('fs');
    const path = await import('path');

    function scanDir(dir: string): string[] {
      let results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(scanDir(full));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          results.push(full);
        }
      }
      return results;
    }

    const appRoot = path.resolve(__dirname, '../../../../');
    const files = scanDir(appRoot);
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('dangerouslySetInnerHTML')) {
        violations.push(path.relative(appRoot, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
