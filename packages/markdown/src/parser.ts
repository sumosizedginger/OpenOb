import {
  basenameVaultPath,
  computeContentHash,
  DocumentParser,
  normalizeVaultPath,
  ParsedDocument,
  VaultPath,
} from '@okw/core';
import { parseFrontmatter } from './frontmatter.js';
import { extractHeadings } from './headings.js';
import { extractTags } from './tags.js';
import { extractWikilinks } from './wikilinks.js';

export class DefaultDocumentParser implements DocumentParser {
  async parse(
    rawPath: VaultPath,
    content: string | Uint8Array,
    sourceHash?: string
  ): Promise<ParsedDocument> {
    const path = normalizeVaultPath(rawPath);
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    const hash = sourceHash ?? computeContentHash(text);

    // 1. Extract Frontmatter
    const { properties, body } = parseFrontmatter(text);

    // 2. Extract Headings
    const headings = extractHeadings(body);

    // 3. Extract Links
    const links = extractWikilinks(body);

    // 4. Extract Tags
    const bodyTags = extractTags(body);
    const fmTagsRaw = properties.tags || properties.tag;
    const fmTags: string[] = Array.isArray(fmTagsRaw)
      ? fmTagsRaw.map(String)
      : typeof fmTagsRaw === 'string'
      ? [fmTagsRaw]
      : [];
    const allTags = Array.from(new Set([...bodyTags, ...fmTags]));

    // 5. Title & Aliases
    const baseName = basenameVaultPath(path, '.md');
    const title = typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim() : (headings[0]?.level === 1 ? headings[0].text : baseName);

    const aliasesRaw = properties.aliases || properties.alias;
    const aliases: string[] = Array.isArray(aliasesRaw)
      ? aliasesRaw.map(String)
      : typeof aliasesRaw === 'string'
      ? [aliasesRaw]
      : [];

    // 6. Metrics
    const lines = text.split(/\r?\n/);
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;

    return {
      id: path,
      path,
      title,
      aliases,
      headings,
      links,
      tags: allTags,
      properties,
      textContent: text,
      sourceHash: hash,
      lineCount: lines.length,
      wordCount: words,
    };
  }
}
