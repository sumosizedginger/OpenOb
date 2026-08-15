import {
  Backlink,
  DocumentIndex,
  LinkResolver,
  ParsedDocument,
  SearchEngine,
  SearchRequest,
  SearchResult,
} from '@okw/core';
import { DefaultLinkResolver } from './link-resolver.js';

/**
 * High-performance in-memory index for fast full-text search, backlinks,
 * graph relationships, and metadata.
 * Designed to be 100% disposable and rebuildable at any time.
 */
export class MemoryDocumentIndex implements DocumentIndex, SearchEngine {
  private documents = new Map<string, ParsedDocument>();
  private linkResolver: LinkResolver;
  private cachedDocArray: ParsedDocument[] | null = null;

  constructor() {
    this.linkResolver = new DefaultLinkResolver(() => this.getDocArray());
  }

  private getDocArray(): ParsedDocument[] {
    if (!this.cachedDocArray) {
      this.cachedDocArray = Array.from(this.documents.values());
    }
    return this.cachedDocArray;
  }

  private invalidateCache(): void {
    this.cachedDocArray = null;
  }

  async upsert(doc: ParsedDocument): Promise<void> {
    this.documents.set(doc.id, doc);
    this.invalidateCache();
  }

  async remove(documentId: string): Promise<void> {
    this.documents.delete(documentId);
    this.invalidateCache();
  }

  async get(documentId: string): Promise<ParsedDocument | null> {
    return this.documents.get(documentId) || null;
  }

  async getAll(): Promise<ParsedDocument[]> {
    return Array.from(this.documents.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  async rebuild(docs: AsyncIterable<ParsedDocument> | ParsedDocument[]): Promise<void> {
    this.documents.clear();
    for await (const doc of docs) {
      this.documents.set(doc.id, doc);
    }
    this.invalidateCache();
  }

  resolveLink(sourcePath: string, rawTarget: string) {
    return this.linkResolver.resolve(sourcePath, rawTarget);
  }

  async getBacklinks(documentPathOrId: string): Promise<Backlink[]> {
    const targetDoc =
      (await this.get(documentPathOrId)) ||
      Array.from(this.documents.values()).find((d) => d.path === documentPathOrId);

    if (!targetDoc) {
      return [];
    }

    const backlinks: Backlink[] = [];

    for (const sourceDoc of this.documents.values()) {
      if (sourceDoc.id === targetDoc.id) continue;

      for (const link of sourceDoc.links) {
        const resolution = this.linkResolver.resolve(sourceDoc.path, link.target);
        if (resolution.resolved && resolution.targetPath === targetDoc.path) {
          const lines = sourceDoc.textContent.split(/\r?\n/);
          const lineText = lines[link.line - 1] || '';

          backlinks.push({
            sourceDocumentId: sourceDoc.id,
            sourcePath: sourceDoc.path,
            sourceTitle: sourceDoc.title,
            rawLink: link.raw,
            line: link.line,
            excerpt: lineText.trim(),
          });
        }
      }
    }

    return backlinks;
  }

  async getOutgoingLinks(documentId: string): Promise<ParsedDocument[]> {
    const doc = await this.get(documentId);
    if (!doc) return [];

    const outgoing: ParsedDocument[] = [];
    const seenPaths = new Set<string>();

    for (const link of doc.links) {
      const res = this.linkResolver.resolve(doc.path, link.target);
      if (res.resolved && res.targetPath && !seenPaths.has(res.targetPath)) {
        seenPaths.add(res.targetPath);
        const targetDoc = Array.from(this.documents.values()).find(
          (d) => d.path === res.targetPath
        );
        if (targetDoc) {
          outgoing.push(targetDoc);
        }
      }
    }

    return outgoing;
  }

  async query(request: SearchRequest): Promise<SearchResult[]> {
    const q = request.query.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];
    const tokens = q.split(/\s+/).filter(Boolean);

    for (const doc of this.documents.values()) {
      if (request.scope?.folders && request.scope.folders.length > 0) {
        const inScope = request.scope.folders.some((f) => {
          const normF = f.replace(/\/+$/, '');
          return doc.path === normF || doc.path.startsWith(`${normF}/`);
        });
        if (!inScope) continue;
      }

      if (request.scope?.tags && request.scope.tags.length > 0) {
        const hasTag = doc.tags.some((t) => request.scope!.tags!.includes(t));
        if (!hasTag) continue;
      }

      let score = 0;
      let source: SearchResult['source'] = 'fts';
      let excerpt: string | undefined;

      const titleLower = doc.title.toLowerCase();
      const pathLower = doc.path.toLowerCase();
      const bodyLower = doc.textContent.toLowerCase();

      if (titleLower === q || pathLower === q) {
        score += 100;
        source = 'navigation';
      } else if (titleLower.startsWith(q) || pathLower.startsWith(q)) {
        score += 70;
        source = 'navigation';
      } else if (titleLower.includes(q)) {
        score += 50;
        source = 'navigation';
      }

      if (doc.aliases?.some((a) => a.toLowerCase().includes(q))) {
        score += 40;
      }

      if (doc.tags.some((t) => t.toLowerCase().includes(q))) {
        score += 30;
        source = 'property';
      }

      const matchingHeading = doc.headings.find((h) => h.text.toLowerCase().includes(q));
      if (matchingHeading) {
        score += 20;
        if (!excerpt) excerpt = `## ${matchingHeading.text}`;
      }

      let bodyMatches = 0;
      for (const token of tokens) {
        const idx = bodyLower.indexOf(token);
        if (idx !== -1) {
          bodyMatches++;
          if (!excerpt) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(doc.textContent.length, idx + token.length + 60);
            excerpt = (start > 0 ? '...' : '') + doc.textContent.slice(start, end).trim() + '...';
          }
        }
      }

      if (bodyMatches === tokens.length) {
        score += 15 + bodyMatches * 2;
      } else if (bodyMatches > 0) {
        score += bodyMatches * 2;
      }

      if (score > 0) {
        results.push({
          documentId: doc.id,
          path: doc.path,
          title: doc.title,
          excerpt,
          score,
          source,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, request.limit ?? 50);
  }
}
