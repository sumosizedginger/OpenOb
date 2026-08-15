import { DocumentIndex, VaultPath, VaultStorage } from '@okw/core';
import { Citation, RetrievalScope, RetrievedContext, RetrievedContextChunk } from './types.js';

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
 * Retrieves bounded context for AI queries based on explicit user scope (Constitution Law 18/19).
 */
export async function retrieveContext(
  storage: VaultStorage,
  index: DocumentIndex,
  query: string,
  scope: RetrievalScope,
  options: { maxChunks?: number; maxTokens?: number } = {}
): Promise<RetrievedContext> {
  const maxChunks = options.maxChunks || 5;
  const chunks: RetrievedContextChunk[] = [];

  // Scope 1: Active selection
  if (scope.type === 'selection' && scope.selectedText) {
    chunks.push({
      notePath: scope.notePath || 'selection.md',
      noteTitle: scope.notePath?.replace(/\.md$/, '') || 'Selected Text',
      content: scope.selectedText,
      lineStart: 1,
      lineEnd: scope.selectedText.split('\n').length,
      score: 2.0,
    });
  }

  // Scope 2: Current note
  else if (scope.type === 'current_note' && scope.notePath) {
    try {
      const snap = await storage.read(scope.notePath);
      const text =
        typeof snap.content === 'string'
          ? snap.content
          : new TextDecoder().decode(snap.content);
      const noteTitle = scope.notePath.replace(/\.md$/, '').split('/').pop() || scope.notePath;
      const noteChunks = chunkDocumentByHeadings(scope.notePath, noteTitle, text);
      chunks.push(...noteChunks.slice(0, maxChunks));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // Scope 3: Selected notes or Folder scope
  else if (scope.type === 'folder' || scope.type === 'selected_notes') {
    const searchScope =
      scope.type === 'folder' && scope.folderPrefix
        ? { folders: [scope.folderPrefix] }
        : undefined;

    const searchResults = await index.query({
      query: query.trim() || 'note',
      scope: searchScope,
      limit: maxChunks,
    });

    for (const res of searchResults) {
      if (scope.type === 'selected_notes' && scope.selectedPaths && !scope.selectedPaths.includes(res.path)) {
        continue;
      }
      try {
        const snap = await storage.read(res.path);
        const text =
          typeof snap.content === 'string'
            ? snap.content
            : new TextDecoder().decode(snap.content);
        const noteChunks = chunkDocumentByHeadings(res.path, res.title, text);
        if (noteChunks.length > 0) {
          chunks.push(noteChunks[0]);
        }
      } catch {}
    }
  }

  // Scope 4: Whole Vault
  else if (scope.type === 'vault') {
    const searchResults = await index.query({
      query: query.trim() || 'note',
      limit: maxChunks,
    });

    for (const res of searchResults) {
      try {
        const snap = await storage.read(res.path);
        const text =
          typeof snap.content === 'string'
            ? snap.content
            : new TextDecoder().decode(snap.content);
        const noteChunks = chunkDocumentByHeadings(res.path, res.title, text);
        if (noteChunks.length > 0) {
          chunks.push(noteChunks[0]);
        }
      } catch {}
    }
  }

  // Estimate tokens (~4 characters per token)
  const totalChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
  const totalTokensEstimate = Math.ceil(totalChars / 4);

  return {
    scope,
    chunks: chunks.slice(0, maxChunks),
    totalTokensEstimate,
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
 * Extracts note citations and wikilink references from an AI assistant response.
 */
export function extractCitations(
  aiResponse: string,
  availableDocs: { path: VaultPath; title: string }[]
): Citation[] {
  const citations: Citation[] = [];
  const seenPaths = new Set<string>();

  // 1. Match [[Wikilinks]]
  const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikilinkRegex.exec(aiResponse)) !== null) {
    const targetName = match[1].trim().toLowerCase();
    const foundDoc = availableDocs.find(
      (d) =>
        d.title.toLowerCase() === targetName ||
        d.path.toLowerCase().replace(/\.md$/, '') === targetName ||
        d.path.toLowerCase() === targetName
    );

    if (foundDoc && !seenPaths.has(foundDoc.path)) {
      seenPaths.add(foundDoc.path);
      citations.push({
        notePath: foundDoc.path,
        noteTitle: foundDoc.title,
      });
    }
  }

  // 2. Match [Source: path.md (Lines X-Y)]
  const sourceTagRegex = /\[(?:Source:\s*)?([^\]\s:]+\.md)(?::L?(\d+)(?:-(\d+))?)?\]/g;
  while ((match = sourceTagRegex.exec(aiResponse)) !== null) {
    const path = match[1].trim();
    const startLine = match[2] ? parseInt(match[2], 10) : undefined;
    const endLine = match[3] ? parseInt(match[3], 10) : startLine;

    const foundDoc = availableDocs.find((d) => d.path.toLowerCase() === path.toLowerCase());
    const noteTitle = foundDoc ? foundDoc.title : path.replace(/\.md$/, '');

    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      citations.push({
        notePath: path,
        noteTitle,
        lineStart: startLine,
        lineEnd: endLine,
      });
    }
  }

  return citations;
}
