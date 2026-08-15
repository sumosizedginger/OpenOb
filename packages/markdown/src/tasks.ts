export interface ParsedTaskItem {
  readonly line: number;
  readonly text: string;
  readonly checked: boolean;
  readonly indent: number;
}

const TASK_REGEX = /^(\s*[-*+]\s+\[([ xX])\])\s*(.*)$/;

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
 * Detects whether the text uses Windows (CRLF) or POSIX (LF) line endings.
 */
export function detectLineEnding(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Toggles a task checkbox in markdown with content-aware line re-location and EOL preservation (P2-1 & P2-2).
 *
 * @param markdown The full markdown document string.
 * @param approxLineNumber 1-indexed line number from parsed snapshot.
 * @param targetText Optional task text to verify and locate if live buffer has shifted lines.
 */
export function toggleTaskAtLine(
  markdown: string,
  approxLineNumber: number,
  targetText?: string
): string {
  const eol = detectLineEnding(markdown);
  const lines = markdown.split(/\r?\n/);
  let targetIndex = approxLineNumber - 1;

  // Content-Aware Re-location (P2-1 mitigation)
  if (targetText !== undefined) {
    const trimmedTarget = targetText.trim();
    let bestIndex = -1;
    let minDistance = Infinity;

    for (let i = 0; i < lines.length; i++) {
      const parsed = matchTaskLine(lines[i], i + 1);
      if (parsed && parsed.text.trim() === trimmedTarget) {
        const distance = Math.abs(i - targetIndex);
        if (distance < minDistance) {
          minDistance = distance;
          bestIndex = i;
        }
      }
    }

    if (bestIndex !== -1) {
      targetIndex = bestIndex;
    }
  }

  if (targetIndex < 0 || targetIndex >= lines.length) {
    return markdown;
  }

  const line = lines[targetIndex];
  const match = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s*.*)$/);
  if (!match) {
    return markdown;
  }

  const isCurrentlyChecked = match[2].toLowerCase() === 'x';
  const newCheckbox = isCurrentlyChecked ? ' ' : 'x';
  lines[targetIndex] = `${match[1]}${newCheckbox}${match[3]}`;

  return lines.join(eol);
}
