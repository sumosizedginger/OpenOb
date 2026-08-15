import { ParsedHeading } from '@okw/core';

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts Markdown headings (#, ##, ...) with levels, text, and slug anchors.
 */
export function extractHeadings(markdown: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(HEADING_REGEX);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      headings.push({
        level,
        text,
        slug: slugify(text),
        line: i + 1,
      });
    }
  }

  return headings;
}
