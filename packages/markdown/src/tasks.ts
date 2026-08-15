export interface ParsedTaskItem {
  readonly line: number;
  readonly text: string;
  readonly checked: boolean;
  readonly indent: number;
}

const TASK_REGEX = /^(\s*[-*+]\s+\[([ xX])\])\s+(.*)$/;

/**
 * Checks if a string line is a Markdown checkbox task item.
 */
export function matchTaskLine(line: string, lineNumber: number): ParsedTaskItem | null {
  const match = line.match(TASK_REGEX);
  if (!match) return null;

  const checked = match[2].toLowerCase() === 'x';
  const text = match[3];
  const indent = match[1].search(/\S/);

  return {
    line: lineNumber,
    text,
    checked,
    indent: indent === -1 ? 0 : indent,
  };
}

/**
 * Toggles a task checkbox at a specific line number (1-indexed).
 */
export function toggleTaskAtLine(markdown: string, targetLineNumber: number): string {
  const lines = markdown.split(/\r?\n/);
  const index = targetLineNumber - 1;

  if (index < 0 || index >= lines.length) {
    return markdown;
  }

  const line = lines[index];
  const match = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
  if (!match) {
    return markdown;
  }

  const isCurrentlyChecked = match[2].toLowerCase() === 'x';
  const newCheckbox = isCurrentlyChecked ? ' ' : 'x';
  lines[index] = `${match[1]}${newCheckbox}${match[3]}`;

  return lines.join('\n');
}
