// Matches #tag or #nested/tag, ensuring it's not a heading or part of a URL
const TAG_REGEX = /(?:^|[\s(\[{<])(#[a-zA-Z0-9_\-\/]+)(?=[\s)\]}>.,;:!?]|$)/g;

/**
 * Extracts hashtags from Markdown text (e.g. #project, #work/tasks).
 */
export function extractTags(markdown: string): string[] {
  const tags = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Skip headings
    if (/^#{1,6}\s/.test(line.trim())) continue;

    TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_REGEX.exec(line)) !== null) {
      const rawTag = match[1];
      // Strip leading '#' and ensure it's not empty or numeric only
      const tagContent = rawTag.slice(1);
      if (tagContent && !/^\d+$/.test(tagContent)) {
        tags.add(tagContent);
      }
    }
  }

  return Array.from(tags);
}
