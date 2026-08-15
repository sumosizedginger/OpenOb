import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser, updateDocumentFrontmatter, serializeYamlValue, parseFrontmatter } from '../index.js';

describe('Phase 5 Frontmatter Serializer & Properties Updater (P5-1)', () => {
  it('correctly serializes YAML values and safely quotes ambiguous strings', () => {
    expect(serializeYamlValue('simple')).toBe('simple');
    expect(serializeYamlValue('true')).toBe('"true"'); // Ambiguous boolean string quoted!
    expect(serializeYamlValue('123')).toBe('"123"'); // Ambiguous numeric string quoted!
    expect(serializeYamlValue('007')).toBe('"007"'); // Leading zero string quoted!
    expect(serializeYamlValue('key: value')).toBe('"key: value"'); // Special colon quoted!
    expect(serializeYamlValue(null)).toBe('null');
    expect(serializeYamlValue(undefined)).toBe('null');
    expect(serializeYamlValue(true)).toBe('true');
    expect(serializeYamlValue(42)).toBe('42');
    expect(serializeYamlValue(['tag1', 123, true, 'with: colon'])).toBe('[tag1, 42, true, "with: colon"]'.replace('42', '123'));
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

  it('preserves typed array elements and null values across parse and update', () => {
    const doc = `---
items: [1, true, "string value", null]
code: "007"
---
Body`;

    const parsed = parseFrontmatter(doc);
    expect(parsed.properties.items).toEqual([1, true, 'string value', null]);
    expect(parsed.properties.code).toBe('007');

    const updated = updateDocumentFrontmatter(doc, {
      ...parsed.properties,
      count: 42,
    });

    const reparsed = parseFrontmatter(updated);
    expect(reparsed.properties.items).toEqual([1, true, 'string value', null]);
    expect(reparsed.properties.code).toBe('007');
    expect(reparsed.properties.count).toBe(42);
  });

  it('preserves UTF-8 BOM when updating frontmatter', () => {
    const bomDoc = '\uFEFF---\ntitle: BOM Note\n---\nBody with BOM';
    const updated = updateDocumentFrontmatter(bomDoc, { title: 'Updated BOM Note' });

    expect(updated.startsWith('\uFEFF')).toBe(true);
    expect(updated).toContain('title: Updated BOM Note');
  });

  it('handles frontmatter with no trailing newline at end of file', () => {
    const noTrailing = '---\ntitle: End of File\n---';
    const updated = updateDocumentFrontmatter(noTrailing, { title: 'Updated End of File' });

    expect(updated.startsWith('---\ntitle: Updated End of File\n---\n')).toBe(true);
  });
});
