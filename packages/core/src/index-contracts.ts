import { ParsedDocument } from './document.js';
import { VaultPath } from './types.js';

export interface Backlink {
  readonly sourceDocumentId: string;
  readonly sourcePath: VaultPath;
  readonly sourceTitle: string;
  readonly rawLink: string;
  readonly line: number;
  readonly excerpt?: string;
}

export interface LinkResolution {
  readonly resolved: boolean;
  readonly targetPath?: VaultPath;
  readonly isAmbiguous?: boolean;
  readonly candidatePaths?: VaultPath[];
}

export interface LinkResolver {
  /**
   * Resolves a wikilink target relative to a source document.
   * Disambiguates deterministic order:
   * 1. Exact relative path from source folder
   * 2. Exact path from vault root
   * 3. Matching basename anywhere in vault
   * 4. Matching alias anywhere in vault
   */
  resolve(sourcePath: VaultPath, rawTarget: string): LinkResolution;
}

export type SearchResultSource = 'navigation' | 'fts' | 'semantic' | 'property' | 'link';

export interface SearchResult {
  readonly documentId: string;
  readonly path: VaultPath;
  readonly title: string;
  readonly excerpt?: string;
  readonly score: number;
  readonly source: SearchResultSource;
  readonly matches?: Array<{ start: number; end: number }>;
}

export interface SearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly scope?: {
    readonly folders?: string[];
    readonly tags?: string[];
    readonly extensions?: string[];
  };
}

export interface SearchEngine {
  query(request: SearchRequest): Promise<SearchResult[]>;
}

export interface DocumentIndex {
  upsert(doc: ParsedDocument): Promise<void>;
  remove(documentId: string): Promise<void>;
  rebuild(docs: AsyncIterable<ParsedDocument> | ParsedDocument[]): Promise<void>;
  get(documentId: string): Promise<ParsedDocument | null>;
  getAll(): Promise<ParsedDocument[]>;
  getBacklinks(documentId: string): Promise<Backlink[]>;
  getOutgoingLinks(documentId: string): Promise<ParsedDocument[]>;
  resolveLink(sourcePath: VaultPath, rawTarget: string): LinkResolution;
}
