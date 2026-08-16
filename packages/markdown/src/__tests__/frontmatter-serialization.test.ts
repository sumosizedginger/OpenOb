import { describe, expect, it } from 'vitest';
import {
  DefaultDocumentParser,
  updateDocumentFrontmatter,
  serializeYamlValue,
  parseFrontmatter,
} from '../index.js';

describe('Phase 6 Frontmatter Serializer & YAML 1.2 Compliance', () => {
  it('correctly serializes YAML values and safely quotes ambiguous strings and padded values', () => {
    expect(serializeYamlValue('simple')).toBe('simple');
    expect(serializeYamlValue('true')).toBe('"true"'); // Ambiguous boolean string quoted!
    expect(serializeYamlValue('yes')).toBe('"yes"'); // YAML 1.2 string quoted!
    expect(serializeYamlValue('no')).toBe('"no"'); // YAML 1.2 string quoted!
    expect(serializeYamlValue('123')).toBe('"123"'); // Ambiguous numeric string quoted!
    expect(serializeYamlValue('007')).toBe('"007"'); // Leading zero string quoted!
    expect(serializeYamlValue('0o17')).toBe('"0o17"'); // Octal string quoted!
    expect(serializeYamlValue('  padded  ')).toBe('"  padded  "'); // Whitespace-padded string quoted!
    expect(serializeYamlValue('key: value')).toBe('"key: value"'); // Special colon quoted!
    expect(serializeYamlValue(null)).toBe('null');
    expect(serializeYamlValue(undefined)).toBe('null');
    expect(serializeYamlValue(true)).toBe('true');
    expect(serializeYamlValue(42)).toBe('42');
  });

  it('preserves "yes" and "no" as strings in YAML 1.2 without boolean coercion', () => {
    const doc = `---
published: yes
archived: no
actual_bool: true
---
Body`;

    const parsed = parseFrontmatter(doc);
    expect(parsed.properties.published).toBe('yes');
    expect(parsed.properties.archived).toBe('no');
    expect(parsed.properties.actual_bool).toBe(true);

    const updated = updateDocumentFrontmatter(doc, parsed.properties);
    const reparsed = parseFrontmatter(updated);
    expect(reparsed.properties.published).toBe('yes');
    expect(reparsed.properties.archived).toBe('no');
  });

  it('handles array elements with commas inside quotes', () => {
    const doc = `---
tags: [alpha, "beta, gamma", delta]
---
Body`;

    const parsed = parseFrontmatter(doc);
    expect(parsed.properties.tags).toEqual(['alpha', 'beta, gamma', 'delta']);
  });

  it('preserves whitespace padding in strings', () => {
    const doc = `---
title: "  Padded Title  "
---
Body`;

    const parsed = parseFrontmatter(doc);
    expect(parsed.properties.title).toBe('  Padded Title  ');

    const updated = updateDocumentFrontmatter(doc, parsed.properties);
    expect(updated).toContain('title: "  Padded Title  "');
  });

  it('safely updates frontmatter on markdown documents while preserving body and CRLF line endings', async () => {
    const parser = new DefaultDocumentParser();

    const originalDoc = `---\r\ntitle: My Note\r\nstatus: draft\r\n---\r\n# Heading 1\r\n\r\nBody text with [[Wikilink]].`;

    const newProps = {
      title: 'Updated Note',
      status: 'active',
      priority: 1,
      reviewed: true,
      tags: ['alpha', 'beta'],
    };

    const updatedContent = updateDocumentFrontmatter(originalDoc, newProps);

    // Verify CRLF preserved
    expect(updatedContent.includes('\r\n')).toBe(true);

    // Parse updated document to verify round-trip integrity
    const parsed = await parser.parse('test.md', updatedContent);

    expect(parsed.title).toBe('Updated Note');
    expect(parsed.properties?.status).toBe('active');
    expect(parsed.properties?.priority).toBe(1);
    expect(parsed.properties?.reviewed).toBe(true);
    expect(parsed.properties?.tags).toEqual(['alpha', 'beta']);
    expect(parsed.headings.length).toBe(1);
    expect(parsed.headings[0].text).toBe('Heading 1');
    expect(parsed.links.length).toBe(1);
    expect(parsed.links[0].target).toBe('Wikilink');
  });

  it('preserves comments and untouched fields in YAML frontmatter', () => {
    const docWithComments = `---
# Important Configuration Header
title: Original Title
# Status flag
status: draft
author: Alice
---
# Content here`;

    const updated = updateDocumentFrontmatter(docWithComments, {
      title: 'New Title',
      status: 'published',
      author: 'Alice',
    });

    expect(updated).toContain('# Important Configuration Header');
    expect(updated).toContain('# Status flag');
    expect(updated).toContain('title: New Title');
    expect(updated).toContain('status: published');
    expect(updated).toContain('author: Alice');
    expect(updated).toContain('# Content here');
  });
});
