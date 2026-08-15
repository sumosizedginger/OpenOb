export interface FrontmatterResult {
  properties: Record<string, any>;
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Parses YAML frontmatter from a Markdown document (M-03, P5-1).
 * Supports inline lists [a, b] and multiline list items (- item).
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  // Strip BOM if present (M-03)
  const cleanText = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const match = cleanText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return {
      properties: {},
      body: cleanText,
      hasFrontmatter: false,
    };
  }

  const rawYaml = match[1];
  const body = cleanText.slice(match[0].length);
  const properties: Record<string, any> = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentListKey: string | null = null;

  for (const line of lines) {
    const rawTrimmed = line.trim();
    if (!rawTrimmed || rawTrimmed.startsWith('#')) continue;

    // Check for multiline list item (- item) under current list key
    if (line.match(/^\s*-\s+/) && currentListKey) {
      const itemVal = rawTrimmed.replace(/^-\s+/, '').trim().replace(/^["']|["']$/g, '');
      if (!Array.isArray(properties[currentListKey])) {
        properties[currentListKey] = [];
      }
      properties[currentListKey].push(itemVal);
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let valStr = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    if (!valStr) {
      // Key with no value on the same line -> start of multiline list
      currentListKey = key;
      properties[key] = [];
      continue;
    } else {
      currentListKey = null;
    }

    // Parse value
    if (valStr.startsWith('[') && valStr.endsWith(']')) {
      const items = valStr
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      properties[key] = items;
    } else if (valStr.toLowerCase() === 'true') {
      properties[key] = true;
    } else if (valStr.toLowerCase() === 'false') {
      properties[key] = false;
    } else if (valStr.toLowerCase() === 'null') {
      properties[key] = null;
    } else if (!isNaN(Number(valStr)) && valStr !== '') {
      properties[key] = Number(valStr);
    } else {
      if (
        (valStr.startsWith('"') && valStr.endsWith('"')) ||
        (valStr.startsWith("'") && valStr.endsWith("'"))
      ) {
        valStr = valStr.slice(1, -1);
      }
      properties[key] = valStr;
    }
  }

  return {
    properties,
    body,
    hasFrontmatter: true,
  };
}

/**
 * Safely serializes a JavaScript value to YAML.
 */
export function serializeYamlValue(val: any): string {
  if (val === null || val === undefined) {
    return '""';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'number') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => serializeYamlValue(item)).join(', ')}]`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Quote strings that could be misinterpreted by YAML parsers
    const needsQuoting =
      trimmed === 'true' ||
      trimmed === 'false' ||
      trimmed === 'null' ||
      trimmed === 'yes' ||
      trimmed === 'no' ||
      !isNaN(Number(trimmed)) ||
      /[:#{}[\]"',&*!|>?%@`]/.test(trimmed) ||
      trimmed.includes('\n');

    if (needsQuoting) {
      return JSON.stringify(trimmed);
    }
    return trimmed;
  }
  return JSON.stringify(val);
}

/**
 * Safely updates YAML frontmatter in a Markdown document while preserving
 * line endings (CRLF / LF) and formatting (D-012, P5-1).
 */
export function updateDocumentFrontmatter(
  content: string,
  properties: Record<string, any>
): string {
  const isCrlf = content.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  // 1. Separate existing frontmatter from body
  let body = content;
  const cleanContent = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const fmMatch = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch && fmMatch.index === 0) {
    body = cleanContent.slice(fmMatch[0].length);
  }

  // If properties are empty, return body without frontmatter
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    return body;
  }

  // 2. Build new frontmatter block
  const lines: string[] = ['---'];
  for (const key of keys) {
    const serializedVal = serializeYamlValue(properties[key]);
    lines.push(`${key}: ${serializedVal}`);
  }
  lines.push('---');

  const newFrontmatter = lines.join(eol) + eol;
  return newFrontmatter + body;
}
