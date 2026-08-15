import { describe, expect, it } from 'vitest';
import { ParsedDocument } from '@okw/core';
import { DefaultLinkResolver } from '../link-resolver.js';

describe('LinkResolver', () => {
  const sampleDocs: ParsedDocument[] = [
    {
      id: 'notes/architecture.md',
      path: 'notes/architecture.md',
      title: 'System Architecture',
      aliases: ['Architecture Guide', 'Design Doc'],
      headings: [],
      links: [],
      tags: [],
      properties: {},
      textContent: '',
      sourceHash: 'h1',
      lineCount: 1,
      wordCount: 1,
    },
    {
      id: 'notes/sub/details.md',
      path: 'notes/sub/details.md',
      title: 'Architecture Details',
      aliases: [],
      headings: [],
      links: [],
      tags: [],
      properties: {},
      textContent: '',
      sourceHash: 'h2',
      lineCount: 1,
      wordCount: 1,
    },
    {
      id: 'other/architecture.md',
      path: 'other/architecture.md',
      title: 'Ancient Architecture',
      aliases: [],
      headings: [],
      links: [],
      tags: [],
      properties: {},
      textContent: '',
      sourceHash: 'h3',
      lineCount: 1,
      wordCount: 1,
    },
  ];

  const resolver = new DefaultLinkResolver(() => sampleDocs);

  it('resolves relative path from same directory', () => {
    const res = resolver.resolve('notes/intro.md', 'sub/details');
    expect(res.resolved).toBe(true);
    expect(res.targetPath).toBe('notes/sub/details.md');
  });

  it('resolves exact path from vault root', () => {
    const res = resolver.resolve('other/file.md', 'notes/architecture');
    expect(res.resolved).toBe(true);
    expect(res.targetPath).toBe('notes/architecture.md');
  });

  it('resolves by alias', () => {
    const res = resolver.resolve('any/file.md', 'Architecture Guide');
    expect(res.resolved).toBe(true);
    expect(res.targetPath).toBe('notes/architecture.md');
  });

  it('detects ambiguous targets when basename exists in multiple folders', () => {
    const res = resolver.resolve('random/file.md', 'architecture');
    expect(res.resolved).toBe(true);
    expect(res.isAmbiguous).toBe(true);
    expect(res.candidatePaths).toEqual(['notes/architecture.md', 'other/architecture.md']);
  });

  it('returns false for non-existent target', () => {
    const res = resolver.resolve('file.md', 'NonExistentNote');
    expect(res.resolved).toBe(false);
  });
});
