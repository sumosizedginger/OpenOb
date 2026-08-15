export interface FrontmatterResult {
  properties: Record<string, any>;
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Parses scalar YAML values into their JavaScript types (number, boolean, null, string).
 */
export function parseScalar(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed === '~') {
    return null;
  }
  if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'yes') {
    return true;
  }
  if (trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'no') {
    return false;
  }

  // Quoted strings
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1);
  }

  // Preserve leading zero strings like '007' as strings
  if (/^0\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Numbers
  if (!isNaN(Number(trimmed)) && !trimmed.startsWith('0x') && !trimmed.startsWith('0b')) {
    return Number(trimmed);
  }

  return trimmed;
}

/**
 * Parses YAML frontmatter from a Markdown document (M-03, P5-1).
 * Supports inline lists [a, b], multiline list items (- item), and typed array items.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  // Strip BOM if present (M-03)
  const cleanText = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const match = cleanText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

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
      const itemValStr = rawTrimmed.replace(/^-\s+/, '').trim();
      const itemVal = parseScalar(itemValStr);
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
        .map((s) => parseScalar(s))
        .filter((item) => item !== undefined);
      properties[key] = items;
    } else {
      properties[key] = parseScalar(valStr);
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
    return 'null';
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
    const trimmed = val;
    // Quote strings that could be misinterpreted by YAML parsers
    const needsQuoting =
      trimmed === '' ||
      trimmed === 'true' ||
      trimmed === 'false' ||
      trimmed === 'null' ||
      trimmed === '~' ||
      trimmed === 'yes' ||
      trimmed === 'no' ||
      /^0\d+$/.test(trimmed) ||
      !isNaN(Number(trimmed)) ||
      /[:#{}[\]"',&*!|>?%@`]/.test(trimmed) ||
      trimmed.includes('\n') ||
      trimmed.includes('\r');

    if (needsQuoting) {
      return JSON.stringify(trimmed);
    }
    return trimmed;
  }
  return JSON.stringify(val);
}

/**
 * Safely updates YAML frontmatter in a Markdown document while preserving
 * comments (# ...), untouched fields, line endings (CRLF / LF), and BOM (D-012, P5-1).
 */
export function updateDocumentFrontmatter(
  content: string,
  newProperties: Record<string, any>
): string {
  const hasBom = content.startsWith('\uFEFF');
  const cleanContent = hasBom ? content.slice(1) : content;
  const isCrlf = cleanContent.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  // 1. Separate existing frontmatter from body
  let existingYaml: string | null = null;
  let body = cleanContent;

  const fmMatch = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fmMatch && fmMatch.index === 0) {
    existingYaml = fmMatch[1];
    body = cleanContent.slice(fmMatch[0].length);
  }

  // If new properties are empty and no existing frontmatter, return body
  const newKeys = Object.keys(newProperties);
  if (newKeys.length === 0 && !existingYaml) {
    return (hasBom ? '\uFEFF' : '') + body;
  }

  const processedKeys = new Set<string>();
  const outputLines: string[] = ['---'];

  if (existingYaml !== null) {
    const lines = existingYaml.split(/\r?\n/);
    let skippingKey: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check if continuing a multiline list of a deleted key
      if (skippingKey && line.match(/^\s*-\s+/)) {
        continue;
      } else {
        skippingKey = null;
      }

      // Preserve comments and blank lines inside frontmatter
      if (!trimmed || trimmed.startsWith('#')) {
        outputLines.push(line);
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        if (key in newProperties) {
          // In-place key update
          const val = newProperties[key];
          outputLines.push(`${key}: ${serializeYamlValue(val)}`);
          processedKeys.add(key);
        } else {
          // Key was deleted: skip this line and any multiline children
          skippingKey = key;
        }
      }
    }
  }

  // Append any new properties that were not present in existing lines
  for (const key of newKeys) {
    if (!processedKeys.has(key)) {
      outputLines.push(`${key}: ${serializeYamlValue(newProperties[key])}`);
    }
  }

  outputLines.push('---');

  const newFrontmatter = outputLines.join(eol) + eol;
  const result = (hasBom ? '\uFEFF' : '') + newFrontmatter + body;
  return result;
}
