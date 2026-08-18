import { DocumentIndex, VaultPath, VaultStorage } from '@okw/core';
import {
  AIKnowledgeSource,
  Citation,
  RetrievalScope,
  RetrievedContext,
  RetrievedContextChunk,
} from './types.js';

/**
 * Checks if a path targets the reserved .openob namespace across all case variants (Constitution Law 14).
 */
export function isReservedOpenObPath(path: string): boolean {
  if (!path) return false;
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const lower = normalized.toLowerCase();
  return lower === '.openob' || lower.startsWith('.openob/');
}

/**
 * Splits text into logical sections based on markdown headings.
 */
function chunkDocumentByHeadings(
  path: VaultPath,
  title: string,
  content: string
): RetrievedContextChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: RetrievedContextChunk[] = [];

  let currentLines: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.startsWith('#') && currentLines.length > 0) {
      chunks.push({
        notePath: path,
        noteTitle: title,
        content: currentLines.join('\n'),
        lineStart: startLine,
        lineEnd: lineNum - 1,
        score: 1.0,
      });
      currentLines = [line];
      startLine = lineNum;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    chunks.push({
      notePath: path,
      noteTitle: title,
      content: currentLines.join('\n'),
      lineStart: startLine,
      lineEnd: lines.length,
      score: 1.0,
    });
  }

  return chunks;
}

/**
 * Adapts legacy VaultStorage + DocumentIndex into an AIKnowledgeSource.
 */
export function createStorageKnowledgeSource(
  storage: VaultStorage,
  index: DocumentIndex
): AIKnowledgeSource {
  return {
    async readNote(path: VaultPath) {
      if (isReservedOpenObPath(path)) {
        throw new Error(`Access to reserved ".openob" folder is forbidden: "${path}"`);
      }
      const snap = await storage.read(path);
      const text =
        typeof snap.content === 'string' ? snap.content : new TextDecoder().decode(snap.content);
      return {
        text,
        version: {
          token: snap.version.token,
          hash: snap.version.hash,
          modifiedAt: snap.version.modifiedAt,
          size: snap.version.size,
        },
      };
    },
    async search(query: string, scope?: { folders?: string[] }, limit?: number) {
      const results = await index.query({
        query: query.trim() || 'note',
        scope: scope?.folders ? { folders: scope.folders } : undefined,
        limit: limit || 10,
      });
      return results
        .filter((r) => !isReservedOpenObPath(r.path))
        .map((r) => ({ path: r.path, title: r.title }));
    },
  };
}

/**
 * Retrieves bounded context for AI queries based on explicit user scope (Constitution Law 18/19).
 * Hard maximum: Scope never widens if search yields empty results.
 * Excludes reserved .openob namespace.
 */
export async function retrieveContext(
  sourceOrStorage: AIKnowledgeSource | VaultStorage,
  indexOrQuery: DocumentIndex | string,
  queryOrScope: string | RetrievalScope,
  scopeOrOptions?: RetrievalScope | { maxChunks?: number; maxTokens?: number },
  maybeOptions?: { maxChunks?: number; maxTokens?: number }
): Promise<RetrievedContext> {
  // Support both (knowledgeSource, query, scope, options) and legacy (storage, index, query, scope, options)
  let knowledgeSource: AIKnowledgeSource;
  let query: string;
  let scope: RetrievalScope;
  let options: { maxChunks?: number; maxTokens?: number } = {};

  if ('readNote' in sourceOrStorage && typeof (sourceOrStorage as any).readNote === 'function') {
    knowledgeSource = sourceOrStorage as AIKnowledgeSource;
    query = (indexOrQuery as string) || '';
    scope = (queryOrScope as RetrievalScope) || { type: 'vault' };
    options = (scopeOrOptions as { maxChunks?: number; maxTokens?: number }) || {};
  } else {
    knowledgeSource = createStorageKnowledgeSource(
      sourceOrStorage as VaultStorage,
      indexOrQuery as DocumentIndex
    );
    query = (queryOrScope as string) || '';
    scope = (scopeOrOptions as RetrievalScope) || { type: 'vault' };
    options = maybeOptions || {};
  }

  const maxChunks = options.maxChunks || 5;
  const chunks: RetrievedContextChunk[] = [];

  // Scope 1: Active selection
  if (scope.type === 'selection' && scope.selectedText) {
    const p =
      scope.notePath && !isReservedOpenObPath(scope.notePath) ? scope.notePath : 'selection.md';
    chunks.push({
      notePath: p,
      noteTitle: p.replace(/\.md$/, '').split('/').pop() || 'Selected Text',
      content: scope.selectedText,
      lineStart: 1,
      lineEnd: scope.selectedText.split('\n').length,
      score: 2.0,
    });
  }

  // Scope 2: Current note (hard maximum: only this note)
  else if (scope.type === 'current_note' && scope.notePath) {
    if (!isReservedOpenObPath(scope.notePath)) {
      try {
        const { text } = await knowledgeSource.readNote(scope.notePath);
        const noteTitle = scope.notePath.replace(/\.md$/, '').split('/').pop() || scope.notePath;
        const noteChunks = chunkDocumentByHeadings(scope.notePath, noteTitle, text);
        chunks.push(...noteChunks.slice(0, maxChunks));
      } catch {
        // Do not widen scope if note is not found
      }
    }
  }

  // Scope 3: Explicitly selected notes
  else if (scope.type === 'selected_notes' && scope.selectedPaths) {
    for (const p of scope.selectedPaths) {
      if (isReservedOpenObPath(p)) continue;
      try {
        const { text } = await knowledgeSource.readNote(p);
        const noteTitle = p.replace(/\.md$/, '').split('/').pop() || p;
        const noteChunks = chunkDocumentByHeadings(p, noteTitle, text);
        chunks.push(...noteChunks.slice(0, 2));
      } catch {}
    }
  }

  // Scope 4: Folder scope (hard maximum: only notes within folder)
  else if (scope.type === 'folder' && scope.folderPrefix) {
    if (!isReservedOpenObPath(scope.folderPrefix)) {
      const searchResults = await knowledgeSource.search(
        query.trim() || 'note',
        { folders: [scope.folderPrefix] },
        maxChunks
      );

      for (const res of searchResults) {
        if (isReservedOpenObPath(res.path)) continue;
        try {
          const { text } = await knowledgeSource.readNote(res.path);
          const noteChunks = chunkDocumentByHeadings(res.path, res.title, text);
          chunks.push(...noteChunks.slice(0, 2));
        } catch {}
      }
    }
  }

  // Scope 5: Whole Vault
  else if (scope.type === 'vault') {
    const searchResults = await knowledgeSource.search(
      query.trim() || 'note',
      undefined,
      maxChunks
    );

    for (const res of searchResults) {
      if (isReservedOpenObPath(res.path)) continue;
      try {
        const { text } = await knowledgeSource.readNote(res.path);
        const noteChunks = chunkDocumentByHeadings(res.path, res.title, text);
        chunks.push(...noteChunks.slice(0, 2));
      } catch {}
    }
  }

  // Enforce Max Tokens Budget (P7-4)
  const maxTokens = options.maxTokens || 4096;
  const boundedChunks: RetrievedContextChunk[] = [];
  let currentTokens = 0;

  for (const chunk of chunks.slice(0, maxChunks)) {
    const chunkTokens = Math.ceil(chunk.content.length / 4);
    if (currentTokens + chunkTokens <= maxTokens) {
      boundedChunks.push(chunk);
      currentTokens += chunkTokens;
    } else {
      const allowedChars = Math.max(0, (maxTokens - currentTokens) * 4);
      if (allowedChars > 50) {
        boundedChunks.push({
          ...chunk,
          content: chunk.content.slice(0, allowedChars) + '\n...[truncated to token budget]',
        });
        currentTokens = maxTokens;
      }
      break;
    }
  }

  return {
    scope,
    chunks: boundedChunks,
    totalTokensEstimate: currentTokens,
  };
}

/**
 * Formats retrieved context chunks into a structured system context block for the model.
 */
export function formatContextPrompt(context: RetrievedContext): string {
  if (context.chunks.length === 0) {
    return '';
  }

  const sections = context.chunks.map((chunk) => {
    return `---
[Source: ${chunk.notePath} (Lines ${chunk.lineStart}-${chunk.lineEnd})]
${chunk.content}
---`;
  });

  return `Relevant Vault Context:\n${sections.join('\n\n')}\n\nWhen referencing information from these sources, cite them using wikilinks [[${context.chunks[0]?.noteTitle || 'Note'}]] or [Source: path.md].`;
}

/**
 * Grounds a model's claimed line range against retrieved chunks for a specific note.
 *
 * Contract:
 * - CASE A: Claimed range is fully contained within ONE retrieved chunk -> preserve exact claimed range.
 * - CASE B: Claimed range partially overlaps ONE retrieved chunk -> clamp to the intersection.
 * - CASE C: Claimed range has NO overlap with any retrieved chunk -> omit line range (path only).
 * - CASE D: Claimed range overlaps multiple discontiguous retrieved chunks -> omit line range (path only).
 * - Invalid model ranges (NaN, start < 1, end < start, enormous values) -> omit line range (defensive).
 */
export function groundLineRange(
  claimedStart: number | undefined,
  claimedEnd: number | undefined,
  matchingChunks: { lineStart?: number; lineEnd?: number }[]
): { lineStart?: number; lineEnd?: number } | undefined {
  if (claimedStart === undefined) {
    return undefined;
  }

  // Defensive validation on claimed range
  if (!Number.isSafeInteger(claimedStart) || claimedStart < 1) {
    return undefined;
  }
  const effectiveEnd = claimedEnd !== undefined ? claimedEnd : claimedStart;
  if (!Number.isSafeInteger(effectiveEnd) || effectiveEnd < 1 || effectiveEnd < claimedStart) {
    return undefined;
  }

  const validChunks = matchingChunks.filter(
    (c): c is { lineStart: number; lineEnd: number } =>
      typeof c.lineStart === 'number' &&
      typeof c.lineEnd === 'number' &&
      Number.isSafeInteger(c.lineStart) &&
      Number.isSafeInteger(c.lineEnd) &&
      c.lineStart >= 1 &&
      c.lineEnd >= c.lineStart
  );

  if (validChunks.length === 0) {
    return undefined;
  }

  // Find all chunks that have a valid intersection with [claimedStart, effectiveEnd]
  const overlappingChunks: { start: number; end: number }[] = [];

  for (const chunk of validChunks) {
    const overlapStart = Math.max(claimedStart, chunk.lineStart);
    const overlapEnd = Math.min(effectiveEnd, chunk.lineEnd);
    if (overlapStart <= overlapEnd) {
      overlappingChunks.push({ start: overlapStart, end: overlapEnd });
    }
  }

  // CASE C: No overlap -> path only
  if (overlappingChunks.length === 0) {
    return undefined;
  }

  // CASE D: Overlaps multiple discontiguous chunks -> path only
  if (overlappingChunks.length > 1) {
    return undefined;
  }

  // Exactly one overlapping chunk (CASE A or CASE B)
  const single = overlappingChunks[0];
  return {
    lineStart: single.start,
    lineEnd: single.end,
  };
}

/**
 * Extracts note citations from an AI assistant response.
 * Strictly ground citations: A structured citation is ONLY created if the referenced note
 * was actually included in the retrieved context (Constitution Law 19), and line ranges
 * are strictly grounded to retrieved chunk intervals (G3G-1).
 */
export function extractCitations(
  aiResponse: string,
  retrievedSources:
    | { path: VaultPath; title: string; lineStart?: number; lineEnd?: number }[]
    | RetrievedContextChunk[]
): Citation[] {
  const citations: Citation[] = [];
  const seenPaths = new Set<string>();

  const availableDocs = retrievedSources.map((s) => ({
    path: 'notePath' in s ? (s as RetrievedContextChunk).notePath : s.path,
    title: 'noteTitle' in s ? (s as RetrievedContextChunk).noteTitle : s.title,
    lineStart: 'lineStart' in s ? s.lineStart : undefined,
    lineEnd: 'lineEnd' in s ? s.lineEnd : undefined,
  }));

  const getChunksForPath = (path: string) => {
    const lower = path.toLowerCase();
    return availableDocs.filter(
      (d) => d.path.toLowerCase() === lower || d.path.toLowerCase().replace(/\.md$/, '') === lower
    );
  };

  const findDoc = (targetName: string) => {
    const lower = targetName.toLowerCase();
    return availableDocs.find(
      (d) =>
        d.title.toLowerCase() === lower ||
        d.path.toLowerCase().replace(/\.md$/, '') === lower ||
        d.path.toLowerCase() === lower
    );
  };

  // 1. Match [[Wikilinks]]
  const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikilinkRegex.exec(aiResponse)) !== null) {
    const targetName = match[1].trim();
    const foundDoc = findDoc(targetName);

    // Grounding check: ONLY include if found in actually retrieved context
    if (foundDoc && !seenPaths.has(foundDoc.path)) {
      seenPaths.add(foundDoc.path);
      citations.push({
        notePath: foundDoc.path,
        noteTitle: foundDoc.title,
      });
    }
  }

  // 2. Match [Source: path.md (Lines X-Y)] or [path.md:L1-20]
  const sourceTagRegex =
    /\[(?:Source:\s*)?([^\]\s:]+\.md)(?:(?::L?|\s*\(Lines?\s*)(\d+)(?:-(\d+))?\)?)?\]/gi;
  while ((match = sourceTagRegex.exec(aiResponse)) !== null) {
    const path = match[1].trim();
    const rawStart = match[2] ? parseInt(match[2], 10) : undefined;
    const rawEnd = match[3] ? parseInt(match[3], 10) : rawStart;

    // Grounding check: ONLY include if found in actually retrieved context
    const foundDoc = findDoc(path);
    if (foundDoc) {
      const matchingChunks = getChunksForPath(foundDoc.path);
      const groundedRange = groundLineRange(rawStart, rawEnd, matchingChunks);

      const existing = citations.find(
        (c) => c.notePath.toLowerCase() === foundDoc.path.toLowerCase()
      );
      if (existing) {
        if (groundedRange && existing.lineStart === undefined) {
          (existing as any).lineStart = groundedRange.lineStart;
          (existing as any).lineEnd = groundedRange.lineEnd;
        }
      } else {
        seenPaths.add(foundDoc.path);
        citations.push({
          notePath: foundDoc.path,
          noteTitle: foundDoc.title,
          lineStart: groundedRange?.lineStart,
          lineEnd: groundedRange?.lineEnd,
        });
      }
    }
  }

  return citations;
}
