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

  constructor() {
    this.linkResolver = new DefaultLinkResolver(() => Array.from(this.documents.values()));
  }

  async upsert(doc: ParsedDocument): Promise<void> {
    this.documents.set(doc.id, doc);
  }

  async remove(documentId: string): Promise<void> {
    this.documents.delete(documentId);
  }

  async get(documentId: string): Promise<ParsedDocument | null> {
    return this.documents.get(documentId) || null;
  }

  async getAll(): Promise<ParsedDocument[]> {
    return Array.from(this.documents.values());
  }

  async rebuild(docs: AsyncIterable<ParsedDocument> | ParsedDocument[]): Promise<void> {
    this.documents.clear();
    if (Array.isArray(docs)) {
      for (const doc of docs) {
        this.documents.set(doc.id, doc);
      }
    } else {
      for await (const doc of docs) {
        this.documents.set(doc.id, doc);
      }
    }
  }

  async getBacklinks(documentId: string): Promise<Backlink[]> {
    const targetDoc = this.documents.get(documentId);
    if (!targetDoc) return [];

    const backlinks: Backlink[] = [];

    for (const sourceDoc of this.documents.values()) {
      if (sourceDoc.id === documentId) continue;

      for (const link of sourceDoc.links) {
        const resolution = this.linkResolver.resolve(sourceDoc.path, link.target);
        if (resolution.resolved && resolution.targetPath === targetDoc.path) {
          // Extract line snippet as excerpt
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
    const doc = this.documents.get(documentId);
    if (!doc) return [];

    const outgoing: ParsedDocument[] = [];

    for (const link of doc.links) {
      const resolution = this.linkResolver.resolve(doc.path, link.target);
      if (resolution.resolved && resolution.targetPath) {
        const targetDoc = this.documents.get(resolution.targetPath);
        if (targetDoc && !outgoing.some((d) => d.id === targetDoc.id)) {
          outgoing.push(targetDoc);
        }
      }
    }

    return outgoing;
  }

  resolveLink(sourcePath: string, rawTarget: string) {
    return this.linkResolver.resolve(sourcePath, rawTarget);
  }

  async query(request: SearchRequest): Promise<SearchResult[]> {
    const q = request.query.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];
    const tokens = q.split(/\s+/).filter(Boolean);

    for (const doc of this.documents.values()) {
      // Scope filtering: ensure folder prefix has a trailing slash or matches exactly (L-01)
      if (request.scope?.folders && request.scope.folders.length > 0) {
        const inScope = request.scope.folders.some((f) => {
          const normF = f.replace(/\/+$/, '');
          return doc.path === normF || doc.path.startsWith(`${normF}/`);
        });
        if (!inScope) continue;
      }
      if (request.scope?.tags && request.scope.tags.length > 0) {
        const hasTag = request.scope.tags.some((t) => doc.tags.includes(t));
        if (!hasTag) continue;
      }

      let score = 0;
      let source: SearchResult['source'] = 'fts';
      let excerpt: string | undefined;

      const titleLower = doc.title.toLowerCase();
      const pathLower = doc.path.toLowerCase();

      // 1. Exact or prefix title / navigation match
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

      // 2. Alias match
      for (const alias of doc.aliases) {
        if (alias.toLowerCase().includes(q)) {
          score += 40;
          break;
        }
      }

      // 3. Tag match
      for (const tag of doc.tags) {
        if (tag.toLowerCase().includes(q)) {
          score += 30;
          source = 'property';
          break;
        }
      }

      // 4. Heading match
      for (const h of doc.headings) {
        if (h.text.toLowerCase().includes(q)) {
          score += 20;
          if (!excerpt) excerpt = `## ${h.text}`;
          break;
        }
      }

      // 5. Full text body match
      const bodyLower = doc.textContent.toLowerCase();
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

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    if (request.limit && request.limit > 0) {
      return results.slice(0, request.limit);
    }

    return results;
  }
}
