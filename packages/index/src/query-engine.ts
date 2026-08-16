import { DocumentIndex, ParsedDocument, PropertyFilter, PropertySort, ViewConfig } from '@okw/core';

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
  return doc.properties?.[field];
}

/**
 * Evaluates whether a ParsedDocument matches a single PropertyFilter.
 */
export function matchPropertyFilter(doc: ParsedDocument, filter: PropertyFilter): boolean {
  const val = getDocumentFieldValue(doc, filter.field);
  const target = filter.value;

  switch (filter.operator) {
    case 'equals':
      if (Array.isArray(val)) {
        return val.some((v) => String(v).toLowerCase() === String(target).toLowerCase());
      }
      return String(val ?? '').toLowerCase() === String(target ?? '').toLowerCase();

    case 'not_equals':
      if (Array.isArray(val)) {
        return !val.some((v) => String(v).toLowerCase() === String(target).toLowerCase());
      }
      return String(val ?? '').toLowerCase() !== String(target ?? '').toLowerCase();

    case 'contains':
      if (Array.isArray(val)) {
        return val.some((v) => String(v).toLowerCase().includes(String(target).toLowerCase()));
      }
      return String(val ?? '')
        .toLowerCase()
        .includes(String(target ?? '').toLowerCase());

    case 'not_contains':
      if (Array.isArray(val)) {
        return !val.some((v) => String(v).toLowerCase().includes(String(target).toLowerCase()));
      }
      return !String(val ?? '')
        .toLowerCase()
        .includes(String(target ?? '').toLowerCase());

    case 'greater_than': {
      if (typeof val === 'number' && typeof target === 'number') {
        return val > target;
      }
      if (typeof val === 'string' && typeof target === 'string') {
        const dateVal = Date.parse(val);
        const dateTarget = Date.parse(target);
        if (!isNaN(dateVal) && !isNaN(dateTarget)) {
          return dateVal > dateTarget;
        }
      }
      return Number(val) > Number(target);
    }

    case 'less_than': {
      if (typeof val === 'number' && typeof target === 'number') {
        return val < target;
      }
      if (typeof val === 'string' && typeof target === 'string') {
        const dateVal = Date.parse(val);
        const dateTarget = Date.parse(target);
        if (!isNaN(dateVal) && !isNaN(dateTarget)) {
          return dateVal < dateTarget;
        }
      }
      return Number(val) < Number(target);
    }

    case 'is_empty':
      if (val === null || val === undefined || val === '') return true;
      if (Array.isArray(val) && val.length === 0) return true;
      return false;

    case 'is_not_empty':
      if (val === null || val === undefined || val === '') return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;

    default:
      return true;
  }
}

/**
 * Sorts documents by multiple fields with ascending or descending order.
 */
export function sortDocuments(docs: ParsedDocument[], sorts?: PropertySort[]): ParsedDocument[] {
  if (!sorts || sorts.length === 0) return docs;

  return [...docs].sort((a, b) => {
    for (const sort of sorts) {
      const valA = getDocumentFieldValue(a, sort.field);
      const valB = getDocumentFieldValue(b, sort.field);

      if (valA === valB) continue;
      if (valA === undefined || valA === null) return sort.direction === 'asc' ? 1 : -1;
      if (valB === undefined || valB === null) return sort.direction === 'asc' ? -1 : 1;

      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else if (typeof valA === 'string' && typeof valB === 'string') {
        const dateA = Date.parse(valA);
        const dateB = Date.parse(valB);
        if (!isNaN(dateA) && !isNaN(dateB) && valA.includes('-') && valB.includes('-')) {
          cmp = dateA - dateB;
        } else {
          cmp = String(valA).localeCompare(String(valB), undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }
      } else {
        cmp = String(valA).localeCompare(String(valB), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }

      if (cmp !== 0) {
        return sort.direction === 'asc' ? cmp : -cmp;
      }
    }
    return 0;
  });
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
    const prefix = config.folderScope.endsWith('/') ? config.folderScope : config.folderScope + '/';
    filtered = filtered.filter((doc) => doc.path.startsWith(prefix));
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
