import {
  DocumentIndex,
  DocumentParser,
  normalizeVaultPath,
  NotFoundError,
  ParsedDocument,
  SearchRequest,
  VaultEntry,
  VaultPath,
  VaultStorage,
} from '@okw/core';
import { buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { NoteWriteCoordinator, SafeWriter } from '@okw/vault';
import { InvalidRequestError } from './errors.js';
import {
  BacklinkDTO,
  ClientContext,
  GraphNeighborDTO,
  NoteReadResult,
  NoteSummary,
  OutgoingLinkDTO,
  PropertyMapDTO,
  SearchRequestDTO,
  SearchResultDTO,
  SearchResultMatch,
  WorkspaceInfo,
} from './types.js';

export interface OpenObWorkspaceOptions {
  readonly storage: VaultStorage;
  readonly index: DocumentIndex;
  readonly parser?: DocumentParser;
  readonly safeWriter?: SafeWriter;
  readonly coordinator?: NoteWriteCoordinator;
  readonly vaultName?: string;
  readonly readOnly?: boolean;
}

/**
 * OpenObWorkspace is the unified application-service boundary for Open Knowledge Workspace.
 * All external interfaces (REST Gateway, MCP, CLI, Agents) and UI adapters interact through
 * this service layer, guaranteeing single-writer consistency and strict data integrity.
 */
export class OpenObWorkspace {
  private readonly storage: VaultStorage;
  private readonly index: DocumentIndex;
  private readonly parser: DocumentParser;
  private readonly safeWriter: SafeWriter;
  private readonly coordinator: NoteWriteCoordinator;
  public readonly vaultName: string;
  public readonly readOnly: boolean;

  constructor(options: OpenObWorkspaceOptions) {
    this.storage = options.storage;
    this.index = options.index;
    this.parser = options.parser ?? new DefaultDocumentParser();
    this.safeWriter = options.safeWriter ?? new SafeWriter(this.storage);
    this.coordinator =
      options.coordinator ?? new NoteWriteCoordinator(this.storage, this.safeWriter);
    this.vaultName = options.vaultName ?? (this.storage as any).name ?? 'default-vault';
    this.readOnly = options.readOnly ?? true; // Phase 1 is strictly read-only
  }

  /**
   * Retrieves summary information about the workspace.
   */
  async getWorkspaceInfo(_context?: ClientContext): Promise<WorkspaceInfo> {
    const allDocs = await this.index.getAll();
    const rootEntries = await this.storage.list('');

    const storageType =
      this.storage.constructor.name === 'NodeFsVaultStorage'
        ? 'node-fs'
        : this.storage.constructor.name === 'BrowserFSAVaultStorage'
          ? 'browser-fsa'
          : this.storage.constructor.name === 'MemoryVaultStorage'
            ? 'memory'
            : 'custom';

    return {
      name: this.vaultName,
      storageType,
      readOnly: this.readOnly,
      apiVersion: 'v1',
      noteCount: allDocs.length,
      totalFiles: rootEntries.length,
      capabilities: ['workspace.read', 'workspace.search'],
    };
  }

  /**
   * Lists entries within a vault directory.
   */
  async listEntries(subPath = '', _context?: ClientContext): Promise<VaultEntry[]> {
    const normalized = subPath ? normalizeVaultPath(subPath) : '';
    return this.storage.list(normalized);
  }

  /**
   * Reads a note, returning full parsed metadata, links, headings, and raw text content.
   */
  async readNote(rawPath: string, _context?: ClientContext): Promise<NoteReadResult> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const exists = await this.storage.exists(resolvedPath);
    if (!exists) {
      throw new NotFoundError(resolvedPath);
    }

    const snapshot = await this.storage.read(resolvedPath);
    const textContent =
      snapshot.textContent ??
      (typeof snapshot.content === 'string'
        ? snapshot.content
        : new TextDecoder().decode(snapshot.content));

    const parsed = await this.parser.parse(resolvedPath, textContent, snapshot.version.hash);

    return {
      path: resolvedPath,
      title: parsed.title,
      textContent,
      version: {
        token: snapshot.version.token,
        hash: snapshot.version.hash,
        modifiedAt: snapshot.modifiedAt,
        size: snapshot.size,
      },
      properties: parsed.properties ?? {},
      tags: parsed.tags ?? [],
      headings: (parsed.headings ?? []).map((h) => ({
        level: h.level,
        text: h.text,
        line: h.line,
      })),
      links: (parsed.links ?? []).map((l) => ({
        target: l.target,
        raw: l.raw,
        displayText: l.displayText,
        subpath: l.subpath,
        line: l.line,
        isEmbed: Boolean(l.isEmbed),
      })),
      aliases: parsed.aliases ?? [],
      wordCount: parsed.wordCount ?? 0,
      lineCount: parsed.lineCount ?? 0,
      hasBom: Boolean(snapshot.hasBom),
    };
  }

  /**
   * Retrieves summary metadata for a note without returning its full body text.
   */
  async getNoteMetadata(rawPath: string, _context?: ClientContext): Promise<NoteSummary> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const cached = await this.index.get(resolvedPath);
    if (cached) {
      const stat = await this.storage.stat(resolvedPath).catch(() => null);
      return {
        path: cached.path,
        title: cached.title,
        wordCount: cached.wordCount,
        lineCount: cached.lineCount,
        modifiedAt: stat?.modifiedAt,
        size: stat?.size,
        tags: cached.tags,
        aliases: cached.aliases,
        hasFrontmatter: Object.keys(cached.properties ?? {}).length > 0,
      };
    }

    // If not in index, read from storage directly
    const note = await this.readNote(resolvedPath, _context);
    return {
      path: note.path,
      title: note.title,
      wordCount: note.wordCount,
      lineCount: note.lineCount,
      modifiedAt: note.version.modifiedAt,
      size: note.version.size,
      tags: note.tags,
      aliases: note.aliases,
      hasFrontmatter: Object.keys(note.properties).length > 0,
    };
  }

  /**
   * Executes a search query across documents in the index.
   */
  async search(request: SearchRequestDTO, _context?: ClientContext): Promise<SearchResultDTO> {
    if (!request || typeof request.query !== 'string') {
      throw new InvalidRequestError('Search request must include a valid "query" string parameter');
    }

    const searchReq: SearchRequest = {
      query: request.query,
      limit: 1000,
      scope: {
        folders: request.pathPrefix ? [normalizeVaultPath(request.pathPrefix)] : undefined,
        tags: request.tags && request.tags.length > 0 ? request.tags : undefined,
      },
    };

    const results = await this.index.query(searchReq);

    const offset = Math.max(0, request.offset ?? 0);
    const limit = Math.max(1, Math.min(100, request.limit ?? 50));
    const paginated = results.slice(offset, offset + limit);

    const matches: SearchResultMatch[] = paginated.map((r) => ({
      path: r.path,
      title: r.title,
      matchSnippet: r.excerpt,
      score: r.score,
      source: r.source,
    }));

    return {
      query: request.query,
      total: results.length,
      matches,
      limit,
      offset,
    };
  }

  /**
   * Retrieves all backlinks pointing to a note.
   */
  async getBacklinks(rawPath: string, _context?: ClientContext): Promise<BacklinkDTO[]> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const exists = await this.storage.exists(resolvedPath);
    if (!exists) {
      throw new NotFoundError(resolvedPath);
    }

    const rawBacklinks = await this.index.getBacklinks(resolvedPath);

    return rawBacklinks.map((b) => ({
      sourcePath: b.sourcePath,
      sourceTitle: b.sourceTitle,
      rawLink: b.rawLink,
      line: b.line,
      displayText: undefined,
      isEmbed: undefined,
      excerpt: b.excerpt,
    }));
  }

  /**
   * Retrieves all outgoing wikilinks from a note, including their resolution status.
   */
  async getOutgoingLinks(rawPath: string, _context?: ClientContext): Promise<OutgoingLinkDTO[]> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const doc = await this.getParsedDocument(resolvedPath);

    const outgoing: OutgoingLinkDTO[] = [];
    for (const link of doc.links) {
      const resolution = this.index.resolveLink(doc.path, link.target);
      outgoing.push({
        targetPath: resolution.targetPath,
        rawTarget: link.target,
        displayText: link.displayText,
        line: link.line,
        isEmbed: Boolean(link.isEmbed),
        resolved: resolution.resolved,
      });
    }

    return outgoing;
  }

  /**
   * Retrieves the YAML frontmatter properties of a note.
   */
  async getProperties(rawPath: string, _context?: ClientContext): Promise<PropertyMapDTO> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const doc = await this.getParsedDocument(resolvedPath);
    return {
      path: resolvedPath,
      properties: doc.properties ?? {},
    };
  }

  /**
   * Retrieves graph neighbors and direct relationships for a note.
   */
  async getGraphNeighbors(
    rawPath: string,
    options: { maxDepth?: number } = {},
    _context?: ClientContext
  ): Promise<GraphNeighborDTO> {
    const resolvedPath = this.resolveNotePath(rawPath);
    const doc = await this.getParsedDocument(resolvedPath);

    const graphData = await buildGraphData(this.index, {
      focusNodeId: resolvedPath,
      maxDepth: options.maxDepth ?? 1,
    });

    const incoming = await this.getBacklinks(resolvedPath, _context);
    const outgoing = await this.getOutgoingLinks(resolvedPath, _context);

    const neighborMap = new Map<
      string,
      {
        path: VaultPath;
        title: string;
        direction: 'incoming' | 'outgoing' | 'bidirectional';
        kind: 'wikilink' | 'embed' | 'tag' | 'property';
      }
    >();

    const outgoingPaths = new Set(outgoing.map((o) => o.targetPath).filter(Boolean) as string[]);
    const incomingPaths = new Set(incoming.map((i) => i.sourcePath));

    for (const edge of graphData.edges) {
      if (edge.source === resolvedPath && edge.target !== resolvedPath) {
        const isBidi = incomingPaths.has(edge.target);
        const node = graphData.nodes.find((n) => n.id === edge.target);
        neighborMap.set(edge.target, {
          path: edge.target,
          title: node?.title ?? edge.target,
          direction: isBidi ? 'bidirectional' : 'outgoing',
          kind: edge.kind,
        });
      } else if (edge.target === resolvedPath && edge.source !== resolvedPath) {
        const isBidi = outgoingPaths.has(edge.source);
        const node = graphData.nodes.find((n) => n.id === edge.source);
        neighborMap.set(edge.source, {
          path: edge.source,
          title: node?.title ?? edge.source,
          direction: isBidi ? 'bidirectional' : 'incoming',
          kind: edge.kind,
        });
      }
    }

    return {
      path: resolvedPath,
      title: doc.title,
      incoming,
      outgoing,
      neighbors: Array.from(neighborMap.values()),
    };
  }

  // --- Internal Helpers ---

  private resolveNotePath(rawPath: string): VaultPath {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new InvalidRequestError('A valid path string is required');
    }
    const normalized = normalizeVaultPath(rawPath);
    return normalized;
  }

  private async getParsedDocument(path: VaultPath): Promise<ParsedDocument> {
    const cached = await this.index.get(path);
    if (cached) return cached;

    const exists = await this.storage.exists(path);
    if (!exists) {
      throw new NotFoundError(path);
    }

    const snapshot = await this.storage.read(path);
    const text =
      snapshot.textContent ??
      (typeof snapshot.content === 'string'
        ? snapshot.content
        : new TextDecoder().decode(snapshot.content));

    return this.parser.parse(path, text, snapshot.version.hash);
  }
}
