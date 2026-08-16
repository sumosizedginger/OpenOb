export type CalloutType =
  'note' | 'tip' | 'important' | 'warning' | 'caution' | 'info' | 'quote' | 'todo';

export interface ParsedCallout {
  readonly type: CalloutType;
  readonly title: string;
  readonly content: string[];
  readonly startLine: number;
  readonly endLine: number;
}

const CALLOUT_HEADER_REGEX = /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/;

/**
 * Checks if a line begins a callout block.
 */
export function matchCalloutHeader(line: string): { type: CalloutType; title: string } | null {
  const match = line.trim().match(CALLOUT_HEADER_REGEX);
  if (!match) return null;

  const rawType = match[1].toLowerCase();
  const title = match[2].trim();

  let type: CalloutType = 'note';
  if (
    ['note', 'tip', 'important', 'warning', 'caution', 'info', 'quote', 'todo'].includes(rawType)
  ) {
    type = rawType as CalloutType;
  }

  return {
    type,
    title: title || type.toUpperCase(),
  };
}
