import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser, updateDocumentFrontmatter, serializeYamlValue } from '../index.js';

describe('Phase 5 Frontmatter Serializer & Properties Updater (P5-1)', () => {
  it('correctly serializes YAML values and safely quotes ambiguous strings', () => {
    expect(serializeYamlValue('simple')).toBe('simple');
    expect(serializeYamlValue('true')).toBe('"true"'); // Ambiguous boolean string quoted!
    expect(serializeYamlValue('123')).toBe('"123"'); // Ambiguous numeric string quoted!
    expect(serializeYamlValue('key: value')).toBe('"key: value"'); // Special colon quoted!
    expect(serializeYamlValue(true)).toBe('true');
    expect(serializeYamlValue(42)).toBe('42');
    expect(serializeYamlValue(['tag1', 'tag2', 'with: colon'])).toBe('[tag1, tag2, "with: colon"]');
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

  it('attaches frontmatter to markdown documents that originally lacked frontmatter', async () => {
    const parser = new DefaultDocumentParser();
    const plainDoc = `# Plain Document\n\nNo initial frontmatter here.`;

    const updated = updateDocumentFrontmatter(plainDoc, { category: 'docs', published: false });
    expect(updated.startsWith('---\ncategory: docs\npublished: false\n---\n')).toBe(true);

    const parsed = await parser.parse('plain.md', updated);
    expect(parsed.properties?.category).toBe('docs');
    expect(parsed.properties?.published).toBe(false);
  });
});
