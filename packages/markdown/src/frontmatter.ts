export interface FrontmatterResult {
  readonly properties: Record<string, unknown>;
  readonly body: string;
  readonly hasFrontmatter: boolean;
  readonly rawFrontmatter?: string;
}

/**
 * Extracts and parses YAML frontmatter from Markdown text.
 * Expects `---` at the beginning of the file followed by key-value pairs.
 */
export function parseFrontmatter(rawMarkdown: string): FrontmatterResult {
  const markdown = rawMarkdown.startsWith('\uFEFF') ? rawMarkdown.slice(1) : rawMarkdown;
  if (!markdown.startsWith('---')) {
    return { properties: {}, body: markdown, hasFrontmatter: false };
  }

  const endMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!endMatch) {
    return { properties: {}, body: markdown, hasFrontmatter: false };
  }

  const rawYaml = endMatch[1];
  const body = markdown.slice(endMatch[0].length);
  const properties = parseSimpleYaml(rawYaml);

  return {
    properties,
    body,
    hasFrontmatter: true,
    rawFrontmatter: rawYaml,
  };
}

/**
 * Lightweight, safe YAML subset parser for frontmatter
 * Handles strings, numbers, booleans, arrays (inline and multi-line `- `), and key-values.
 */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Multi-line list item: "- item"
    if (trimmed.startsWith('- ') && currentKey) {
      const valStr = trimmed.slice(2).trim();
      const parsedVal = parseYamlValue(valStr);
      if (!currentArray) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      currentArray.push(parsedVal);
      continue;
    }

    // Key: value pair
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const rawVal = line.slice(colonIndex + 1).trim();

      currentKey = key;
      currentArray = null;

      if (rawVal === '') {
        // Value might be a multi-line list on subsequent lines
        result[key] = [];
        currentArray = result[key] as unknown[];
      } else {
        result[key] = parseYamlValue(rawVal);
      }
    }
  }

  return result;
}

function parseYamlValue(val: string): unknown {
  // Quoted string
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }

  // Boolean
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;
  if (val.toLowerCase() === 'null') return null;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(val)) {
    return Number(val);
  }

  // Inline array: [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((s) => s.trim())
      .map(parseYamlValue);
  }

  return val;
}
