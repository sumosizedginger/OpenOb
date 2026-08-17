import {
  DocumentIndex,
  normalizeVaultPath,
  ParsedDocument,
  PropertyFilter,
  PropertyQuery,
  PropertyQueryResult,
  PropertySort,
  QueryRow,
  VaultPath,
  ViewConfig,
} from '@okw/core';

/**
 * Extracts a typed or raw field value from a ParsedDocument.
 * Checks core document properties first, then YAML frontmatter properties.
 */
export function getDocumentFieldValue(doc: ParsedDocument, field: string): any {
  if (field === 'title') return doc.title;
  if (field === 'path') return doc.path;
  if (field === 'tags') return doc.tags;
  if (field === 'aliases') return doc.aliases;
  if (field === 'lineCount') return doc.lineCount;
  if (field === 'wordCount') return doc.wordCount;
  if (field === 'modifiedAt') return (doc as any).modifiedAt;
  return doc.properties?.[field];
}

const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isIsoDate(str: string): boolean {
  return (
    typeof str === 'string' && ISO_DATE_REGEX.test(str.trim()) && !isNaN(Date.parse(str.trim()))
  );
}

function parseBoolean(val: any): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return null;
}

function compareScalars(a: any, b: any): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    if (isIsoDate(a) && isIsoDate(b)) {
      return Date.parse(a) - Date.parse(b);
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Evaluates whether a ParsedDocument matches a single PropertyFilter.
 */
export function matchPropertyFilter(doc: ParsedDocument, filter: PropertyFilter): boolean {
  const val = getDocumentFieldValue(doc, filter.field);
  const target = filter.value;

  // Handle empty / non-empty checks first
  if (filter.operator === 'is_empty') {
    if (val === null || val === undefined || val === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'object' && Object.keys(val).length === 0) return true;
    return false;
  }

  if (filter.operator === 'is_not_empty') {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (typeof val === 'object' && Object.keys(val).length === 0) return false;
    return true;
  }

  // Prevent misleading "[object Object]" comparisons on YAML objects/maps
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return false;
  }

  // Boolean matching
  const boolTarget = parseBoolean(target);
  const boolVal = parseBoolean(val);
  if (boolTarget !== null && boolVal !== null) {
    if (filter.operator === 'equals') return boolVal === boolTarget;
    if (filter.operator === 'not_equals') return boolVal !== boolTarget;
    return false;
  }

  // Array value handling (e.g. tags or array property)
  if (Array.isArray(val)) {
    switch (filter.operator) {
      case 'equals':
        return val.some((v) => {
          if (typeof v === 'number' && typeof target === 'number') return v === target;
          return String(v).toLowerCase() === String(target ?? '').toLowerCase();
        });
      case 'not_equals':
        return !val.some((v) => {
          if (typeof v === 'number' && typeof target === 'number') return v === target;
          return String(v).toLowerCase() === String(target ?? '').toLowerCase();
        });
      case 'contains':
        return val.some((v) =>
          String(v)
            .toLowerCase()
            .includes(String(target ?? '').toLowerCase())
        );
      case 'not_contains':
        return !val.some((v) =>
          String(v)
            .toLowerCase()
            .includes(String(target ?? '').toLowerCase())
        );
      default:
        return false;
    }
  }

  // Numeric comparisons
  const isValNum = typeof val === 'number' && !isNaN(val);
  const isTargetNum = typeof target === 'number' && !isNaN(target);

  switch (filter.operator) {
    case 'equals': {
      if (isValNum && isTargetNum) return val === target;
      if (val === undefined || val === null) {
        return target === undefined || target === null || target === '';
      }
      return String(val).toLowerCase() === String(target ?? '').toLowerCase();
    }

    case 'not_equals': {
      if (isValNum && isTargetNum) return val !== target;
      if (val === undefined || val === null) {
        return target !== undefined && target !== null && target !== '';
      }
      return String(val).toLowerCase() !== String(target ?? '').toLowerCase();
    }

    case 'contains': {
      if (val === undefined || val === null) return false;
      return String(val)
        .toLowerCase()
        .includes(String(target ?? '').toLowerCase());
    }

    case 'not_contains': {
      if (val === undefined || val === null) return true;
      return !String(val)
        .toLowerCase()
        .includes(String(target ?? '').toLowerCase());
    }

    case 'greater_than': {
      if (val === undefined || val === null) return false;
      if (isValNum && isTargetNum) return val > target;
      if (typeof val === 'string' && typeof target === 'string') {
        if (isIsoDate(val) && isIsoDate(target)) {
          return Date.parse(val) > Date.parse(target);
        }
      }
      const numV = Number(val);
      const numT = Number(target);
      if (!isNaN(numV) && !isNaN(numT)) {
        return numV > numT;
      }
      return String(val).localeCompare(String(target)) > 0;
    }

    case 'less_than': {
      if (val === undefined || val === null) return false;
      if (isValNum && isTargetNum) return val < target;
      if (typeof val === 'string' && typeof target === 'string') {
        if (isIsoDate(val) && isIsoDate(target)) {
          return Date.parse(val) < Date.parse(target);
        }
      }
      const numV = Number(val);
      const numT = Number(target);
      if (!isNaN(numV) && !isNaN(numT)) {
        return numV < numT;
      }
      return String(val).localeCompare(String(target)) < 0;
    }

    default:
      return true;
  }
}

/**
 * Sorts documents by multiple fields with ascending or descending order.
 * Uses a stable secondary sort tie-breaker (path ASC) to guarantee deterministic result order.
 */
export function sortDocuments(docs: ParsedDocument[], sorts?: PropertySort[]): ParsedDocument[] {
  return [...docs].sort((a, b) => {
    if (sorts && sorts.length > 0) {
      for (const sort of sorts) {
        const valA = getDocumentFieldValue(a, sort.field);
        const valB = getDocumentFieldValue(b, sort.field);

        const cmp = compareScalars(valA, valB);
        if (cmp !== 0) {
          return sort.direction === 'asc' ? cmp : -cmp;
        }
      }
    }
    // Stable secondary tie-breaker
    return a.path.localeCompare(b.path);
  });
}

/**
 * Normalizes and checks if a document path falls within a folderScope.
 */
export function matchesFolderScope(docPath: VaultPath, folderScope?: string): boolean {
  if (!folderScope) return true;
  const rawTrimmed = folderScope.trim().replace(/^[/\\]+/, '');
  if (!rawTrimmed || rawTrimmed === '.' || rawTrimmed === '/') return true;

  const normalizedScope = normalizeVaultPath(rawTrimmed);
  const normalizedDoc = normalizeVaultPath(docPath);

  if (normalizedDoc === normalizedScope) return true;
  const prefix = normalizedScope.endsWith('/') ? normalizedScope : normalizedScope + '/';
  return normalizedDoc.startsWith(prefix);
}

/**
 * Executes a property query against the DocumentIndex (Constitution Law 21: Pure Derived State).
 */
export async function executePropertyQuery(
  index: DocumentIndex,
  config: ViewConfig
): Promise<ParsedDocument[]> {
  const allDocs = await index.getAll();

  // 1. Filter by folder scope if specified
  let filtered = allDocs;
  if (config.folderScope) {
    filtered = filtered.filter((doc) => matchesFolderScope(doc.path, config.folderScope));
  }

  // 2. Apply property filters
  if (config.filters && config.filters.length > 0) {
    filtered = filtered.filter((doc) =>
      config.filters!.every((filter) => matchPropertyFilter(doc, filter))
    );
  }

  // 3. Apply sorting
  return sortDocuments(filtered, config.sorts);
}

/**
 * Executes a protocol-neutral PropertyQuery with bounded pagination and returns PropertyQueryResult.
 */
export async function executeProtocolPropertyQuery(
  index: DocumentIndex,
  query: PropertyQuery,
  options?: { indexStatus?: 'verified' | 'degraded' }
): Promise<PropertyQueryResult> {
  const allDocs = await index.getAll();

  // 1. Filter by folder scope
  let filtered = allDocs;
  if (query.folderScope) {
    filtered = filtered.filter((doc) => matchesFolderScope(doc.path, query.folderScope));
  }

  // 2. Apply property filters
  if (query.filters && query.filters.length > 0) {
    filtered = filtered.filter((doc) =>
      query.filters!.every((filter) => matchPropertyFilter(doc, filter))
    );
  }

  // 3. Apply deterministic sorting
  const sorted = sortDocuments(filtered, query.sorts);
  const total = sorted.length;

  // 4. Bounded pagination
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const paged = sorted.slice(offset, offset + limit);

  // 5. Build DTO rows
  const rows: QueryRow[] = paged.map((doc) => {
    const rawVersion = (doc as any).version;
    const version = rawVersion
      ? {
          token: rawVersion.token ?? '',
          hash: rawVersion.hash ?? '',
          modifiedAt: rawVersion.modifiedAt,
          size: rawVersion.size,
        }
      : undefined;

    return {
      path: doc.path,
      title: doc.title,
      properties: doc.properties || {},
      tags: doc.tags || [],
      wordCount: doc.wordCount || 0,
      lineCount: doc.lineCount || 0,
      version,
    };
  });

  const availableProperties = await discoverVaultProperties(index);

  return {
    rows,
    total,
    offset,
    limit,
    availableProperties,
    indexStatus: options?.indexStatus ?? 'verified',
  };
}

/**
 * Groups documents by a property (e.g. status, priority, category) for Kanban board views.
 */
export function groupDocumentsByProperty(
  docs: ParsedDocument[],
  field: string
): Map<string, ParsedDocument[]> {
  const groups = new Map<string, ParsedDocument[]>();

  for (const doc of docs) {
    const rawVal = getDocumentFieldValue(doc, field);
    let groupName = `No ${field}`;

    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      if (Array.isArray(rawVal) && rawVal.length > 0) {
        groupName = String(rawVal[0]);
      } else if (!Array.isArray(rawVal)) {
        groupName = String(rawVal);
      }
    }

    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName)!.push(doc);
  }

  return groups;
}

/**
 * Discovers all unique property keys used across the vault.
 */
export async function discoverVaultProperties(index: DocumentIndex): Promise<string[]> {
  const docs = await index.getAll();
  const keys = new Set<string>(['title', 'path', 'tags']);

  for (const doc of docs) {
    if (doc.properties) {
      for (const k of Object.keys(doc.properties)) {
        keys.add(k);
      }
    }
  }

  return Array.from(keys);
}
