import { ParsedLink } from '@okw/core';

// Regex for extracting wikilinks: !?[[Target|Alias]]
const WIKILINK_REGEX = /(!?)\[\[([^\]\n]+)\]\]/g;

/**
 * Extracts all wikilinks from Markdown text with line numbers and parsed targets/aliases/subpaths.
 */
export function extractWikilinks(markdown: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = markdown.split(/\r?\n/);

  let inCodeBlock = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // Toggle fenced code block
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    let match: RegExpExecArray | null;
    WIKILINK_REGEX.lastIndex = 0;

    while ((match = WIKILINK_REGEX.exec(line)) !== null) {
      const isEmbed = match[1] === '!';
      const inner = match[2].trim();

      // Check for alias separator '|'
      const pipeIndex = inner.indexOf('|');
      let targetWithSubpath = pipeIndex !== -1 ? inner.slice(0, pipeIndex).trim() : inner;
      const displayText = pipeIndex !== -1 ? inner.slice(pipeIndex + 1).trim() : undefined;

      // Check for subpath separator '#' or '^'
      let target = targetWithSubpath;
      let subpath: string | undefined;

      const hashIndex = targetWithSubpath.indexOf('#');
      const caretIndex = targetWithSubpath.indexOf('^');

      if (hashIndex !== -1) {
        target = targetWithSubpath.slice(0, hashIndex).trim();
        subpath = targetWithSubpath.slice(hashIndex).trim();
      } else if (caretIndex !== -1) {
        target = targetWithSubpath.slice(0, caretIndex).trim();
        subpath = targetWithSubpath.slice(caretIndex).trim();
      }

      links.push({
        raw: match[0],
        target,
        displayText,
        subpath,
        isEmbed,
        line: lineIndex + 1,
      });
    }
  }

  return links;
}
