import {
  basenameVaultPath,
  ConflictError,
  dirnameVaultPath,
  DocumentIndex,
  DocumentParser,
  FileSnapshot,
  FileVersion,
  normalizeVaultPath,
  NotFoundError,
  ParsedDocument,
  SearchRequest,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';
import { buildGraphData, rewriteNoteWikilinks } from '@okw/index';
import { DefaultDocumentParser, parseFrontmatter, updateDocumentFrontmatter } from '@okw/markdown';
import { NoteWriteCoordinator, SafeWriter } from '@okw/vault';
import { InMemoryAuditSink } from './audit.js';
import {
  ForbiddenError,
  IndexDegradedError,
  InvalidPathError,
  InvalidRequestError,
  RecoveryRequiredError,
} from './errors.js';
import {
  AuditSink,
  BacklinkDTO,
  ClientContext,
  CreateNoteRequest,
  DeleteNoteRequest,
  DeleteResultDTO,
  GraphNeighborDTO,
  NoteReadResult,
  NoteSummary,
  OutgoingLinkDTO,
  PropertyMapDTO,
  RenameNoteRequest,
  RenameResultDTO,
  SearchRequestDTO,
  SearchResultDTO,
  SearchResultMatch,
  SetPropertyRequest,
  SingleNoteMutationResultDTO,
  UpdateNoteRequest,
  WorkspaceInfo,
} from './types.js';

export interface OpenObWorkspaceOptions {
  readonly storage: VaultStorage;
  readonly index: DocumentIndex;
  readonly parser?: DocumentParser;
  readonly safeWriter?: SafeWriter;
  readonly coordinator?: NoteWriteCoordinator;
  readonly auditSink?: AuditSink;
  readonly vaultName?: string;
  readonly readOnly?: boolean;
}

/**
 * Structural concurrency gate providing shared access for ordinary note edits
 * and exclusive access for structural operations (rename, delete).
 */
class StructuralGate {
  private activeSharedCount = 0;
  private exclusiveActive = false;
  private sharedWaiters: Array<() => void> = [];
  private exclusiveWaiters: Array<() => void> = [];

  async withShared<T>(fn: () => Promise<T>): Promise<T> {
    if (this.exclusiveActive || this.exclusiveWaiters.length > 0) {
      await new Promise<void>((resolve) => this.sharedWaiters.push(resolve));
    }
    this.activeSharedCount++;
    try {
      return await fn();
    } finally {
      this.activeSharedCount--;
      if (this.activeSharedCount === 0 && this.exclusiveWaiters.length > 0) {
        const nextExclusive = this.exclusiveWaiters.shift();
        nextExclusive?.();
      }
    }
  }

  async withExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.exclusiveActive || this.activeSharedCount > 0) {
      await new Promise<void>((resolve) => this.exclusiveWaiters.push(resolve));
    }
    this.exclusiveActive = true;
    try {
      return await fn();
    } finally {
      this.exclusiveActive = false;
      if (this.exclusiveWaiters.length > 0) {
        const nextExclusive = this.exclusiveWaiters.shift();
        nextExclusive?.();
      } else {
        while (this.sharedWaiters.length > 0) {
          const nextShared = this.sharedWaiters.shift();
          nextShared?.();
        }
      }
    }
  }
}

/**
 * OpenObWorkspace is the unified application-service boundary for Open Knowledge Workspace.
 * All external interfaces (REST Gateway, MCP, CLI, Agents) and UI adapters interact through
 * this service layer, guaranteeing single-writer consistency, capability enforcement, and strict data integrity.
 */
export class OpenObWorkspace {
  private readonly storage: VaultStorage;
  private readonly index: DocumentIndex;
  private readonly parser: DocumentParser;
  private readonly safeWriter: SafeWriter;
  private readonly coordinator: NoteWriteCoordinator;
  private readonly auditSink: AuditSink;
  private readonly structuralGate = new StructuralGate();
  private readonly pathLocks = new Map<string, Promise<void>>();
  private indexHealth: 'verified' | 'degraded' = 'verified';

  public readonly vaultName: string;
  public readonly readOnly: boolean;

  constructor(options: OpenObWorkspaceOptions) {
    this.storage = options.storage;
    this.index = options.index;
    this.parser = options.parser ?? new DefaultDocumentParser();
    this.safeWriter = options.safeWriter ?? new SafeWriter(this.storage);
    this.coordinator =
      options.coordinator ?? new NoteWriteCoordinator(this.storage, this.safeWriter);
    this.auditSink = options.auditSink ?? new InMemoryAuditSink();
    this.vaultName = options.vaultName ?? (this.storage as any).name ?? 'default-vault';
    this.readOnly = options.readOnly ?? true;
  }

  public getCoordinator(): NoteWriteCoordinator {
    return this.coordinator;
  }

  /**
   * Retrieves summary information about the workspace and its capabilities.
   */
  async getWorkspaceInfo(context?: ClientContext): Promise<WorkspaceInfo> {
    this.checkCapability('workspace.read', context);
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

    const capabilities = ['workspace.read', 'workspace.search'];
    if (!this.readOnly) {
      capabilities.push(
        'workspace.write',
        'properties.write',
        'workspace.rename',
        'workspace.delete'
      );
    }

    return {
      name: this.vaultName,
      storageType,
      readOnly: this.readOnly,
      apiVersion: 'v1',
      noteCount: allDocs.length,
      totalFiles: rootEntries.length,
      capabilities,
      indexStatus: this.indexHealth,
    };
  }

  /**
   * Lists entries within a vault directory.
   */
  async listEntries(subPath = '', context?: ClientContext): Promise<VaultEntry[]> {
    this.checkCapability('workspace.read', context);
    const normalized = subPath ? normalizeVaultPath(subPath) : '';
    return this.storage.list(normalized, true);
  }

  /**
   * Reads a note, returning full parsed metadata, links, headings, properties, and raw text content.
   */
  async readNote(rawPath: string, context?: ClientContext): Promise<NoteReadResult> {
    this.checkCapability('workspace.read', context);
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
  async getNoteMetadata(rawPath: string, context?: ClientContext): Promise<NoteSummary> {
    this.checkCapability('workspace.read', context);
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
    const note = await this.readNote(resolvedPath, context);
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
  async search(request: SearchRequestDTO, context?: ClientContext): Promise<SearchResultDTO> {
    this.checkCapability('workspace.search', context);
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
  async getBacklinks(rawPath: string, context?: ClientContext): Promise<BacklinkDTO[]> {
    this.checkCapability('workspace.read', context);
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
  async getOutgoingLinks(rawPath: string, context?: ClientContext): Promise<OutgoingLinkDTO[]> {
    this.checkCapability('workspace.read', context);
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
  async getProperties(rawPath: string, context?: ClientContext): Promise<PropertyMapDTO> {
    this.checkCapability('workspace.read', context);
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
    context?: ClientContext
  ): Promise<GraphNeighborDTO> {
    this.checkCapability('workspace.read', context);
    const resolvedPath = this.resolveNotePath(rawPath);
    const doc = await this.getParsedDocument(resolvedPath);

    const graphData = await buildGraphData(this.index, {
      focusNodeId: resolvedPath,
      maxDepth: options.maxDepth ?? 1,
    });

    const incoming = await this.getBacklinks(resolvedPath, context);
    const outgoing = await this.getOutgoingLinks(resolvedPath, context);

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

  // --- Phase 2A: External Mutations ---

  /**
   * Creates a new note in the workspace.
   */
  async createNote(
    request: CreateNoteRequest,
    context?: ClientContext
  ): Promise<SingleNoteMutationResultDTO> {
    this.checkCapability('workspace.write', context);

    if (!request || typeof request.path !== 'string') {
      throw new InvalidRequestError('Missing required field: "path"');
    }

    const normalizedPath = this.resolveNotePath(request.path);
    if (!normalizedPath || normalizedPath === '.' || normalizedPath.endsWith('/')) {
      throw new InvalidPathError(request.path, 'Cannot create note at empty or directory path');
    }

    return this.structuralGate.withShared(async () => {
      return this.withPathLock(normalizedPath, async () => {
        // 1. Check if note already exists
        const existingStat = await this.storage.stat(normalizedPath);
        if (existingStat) {
          const existingVersion: FileVersion = existingStat.version ?? {
            token: 'existing',
            hash: '',
            modifiedAt: existingStat.modifiedAt,
            size: existingStat.size,
          };
          const err = new ConflictError(
            normalizedPath,
            null,
            existingVersion,
            undefined,
            `Conflict on "${normalizedPath}": file already exists`
          );
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'create',
            path: normalizedPath,
            success: false,
            previousVersion: existingVersion,
            currentVersion: null,
            grantedScope: 'workspace.write',
            indexStatus: this.indexHealth,
            errorMessage: err.message,
          });
          throw err;
        }

        // 2. Prepare content
        let textContent = request.content ?? '';
        if (request.properties && Object.keys(request.properties).length > 0) {
          textContent = updateDocumentFrontmatter(textContent, request.properties);
        }

        // 3. Persist canonically via SafeWriter
        let writeResult: WriteResult;
        try {
          writeResult = await this.safeWriter.safeSave(normalizedPath, textContent, {
            expectedVersion: null,
          });
        } catch (err: any) {
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'create',
            path: normalizedPath,
            success: false,
            previousVersion: null,
            currentVersion: null,
            grantedScope: 'workspace.write',
            indexStatus: this.indexHealth,
            errorMessage: err?.message,
          });
          throw err;
        }

        const durableVersion = writeResult.snapshot.version;

        // 4. Update derived index
        let indexStatus: 'verified' | 'degraded' = 'verified';
        let indexError: string | undefined;
        try {
          const parsed = await this.parser.parse(normalizedPath, textContent, durableVersion.hash);
          await this.index.upsert(parsed);
        } catch (err: any) {
          indexStatus = 'degraded';
          this.indexHealth = 'degraded';
          indexError = err?.message || String(err);
        }

        const result: SingleNoteMutationResultDTO = {
          operation: 'create',
          path: normalizedPath,
          previousVersion: null,
          currentVersion: {
            token: durableVersion.token,
            hash: durableVersion.hash,
            modifiedAt: durableVersion.modifiedAt,
            size: durableVersion.size,
          },
          durableSuccess: true,
          indexStatus,
          indexError,
          requestId: context?.requestId,
          clientId: context?.clientId,
        };

        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'create',
          path: normalizedPath,
          success: true,
          previousVersion: null,
          currentVersion: result.currentVersion,
          grantedScope: 'workspace.write',
          indexStatus,
        });

        return result;
      });
    });
  }

  /**
   * Updates an existing note's body content using optimistic concurrency control.
   */
  async updateNote(
    request: UpdateNoteRequest,
    context?: ClientContext
  ): Promise<SingleNoteMutationResultDTO> {
    this.checkCapability('workspace.write', context);

    if (!request || typeof request.path !== 'string') {
      throw new InvalidRequestError('Missing required field: "path"');
    }
    if (typeof request.content !== 'string') {
      throw new InvalidRequestError('Missing required field: "content" (must be string)');
    }
    if (!request.expectedVersion || typeof request.expectedVersion.token !== 'string') {
      throw new InvalidRequestError('Missing required field: "expectedVersion" with valid "token"');
    }

    const normalizedPath = this.resolveNotePath(request.path);

    return this.structuralGate.withShared(async () => {
      return this.withPathLock(normalizedPath, async () => {
        // 1. Check current version on disk
        const currentSnapshot = await this.storage.read(normalizedPath).catch(() => null);
        if (!currentSnapshot) {
          const err = new NotFoundError(normalizedPath);
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'update',
            path: normalizedPath,
            success: false,
            previousVersion: null,
            currentVersion: null,
            grantedScope: 'workspace.write',
            indexStatus: this.indexHealth,
            errorMessage: err.message,
          });
          throw err;
        }

        const currentVersion = currentSnapshot.version;

        // 2. Validate expectedVersion
        if (currentVersion.token !== request.expectedVersion.token) {
          const err = new ConflictError(
            normalizedPath,
            {
              token: request.expectedVersion.token,
              hash: request.expectedVersion.hash ?? '',
              modifiedAt: request.expectedVersion.modifiedAt,
              size: request.expectedVersion.size,
            },
            currentVersion,
            undefined,
            `Conflict on "${normalizedPath}": expected version token "${request.expectedVersion.token}", but current version token is "${currentVersion.token}"`
          );
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'update',
            path: normalizedPath,
            success: false,
            previousVersion: currentVersion,
            currentVersion: null,
            grantedScope: 'workspace.write',
            indexStatus: this.indexHealth,
            errorMessage: err.message,
          });
          throw err;
        }

        const textContent = request.content;

        // 3. Persist canonically via SafeWriter
        let writeResult: WriteResult;
        try {
          writeResult = await this.safeWriter.safeSave(normalizedPath, textContent, {
            expectedVersion: currentVersion,
          });
        } catch (err: any) {
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'update',
            path: normalizedPath,
            success: false,
            previousVersion: currentVersion,
            currentVersion: null,
            grantedScope: 'workspace.write',
            indexStatus: this.indexHealth,
            errorMessage: err?.message,
          });
          throw err;
        }

        const durableVersion = writeResult.snapshot.version;

        // 4. Update derived index
        let indexStatus: 'verified' | 'degraded' = 'verified';
        let indexError: string | undefined;
        try {
          const parsed = await this.parser.parse(normalizedPath, textContent, durableVersion.hash);
          await this.index.upsert(parsed);
        } catch (err: any) {
          indexStatus = 'degraded';
          this.indexHealth = 'degraded';
          indexError = err?.message || String(err);
        }

        const result: SingleNoteMutationResultDTO = {
          operation: 'update',
          path: normalizedPath,
          previousVersion: {
            token: currentVersion.token,
            hash: currentVersion.hash,
            modifiedAt: currentVersion.modifiedAt,
            size: currentVersion.size,
          },
          currentVersion: {
            token: durableVersion.token,
            hash: durableVersion.hash,
            modifiedAt: durableVersion.modifiedAt,
            size: durableVersion.size,
          },
          durableSuccess: true,
          indexStatus,
          indexError,
          requestId: context?.requestId,
          clientId: context?.clientId,
        };

        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'update',
          path: normalizedPath,
          success: true,
          previousVersion: result.previousVersion,
          currentVersion: result.currentVersion,
          grantedScope: 'workspace.write',
          indexStatus,
        });

        return result;
      });
    });
  }

  /**
   * Sets or deletes a frontmatter property on an existing note using optimistic concurrency control.
   */
  async setProperty(
    request: SetPropertyRequest,
    context?: ClientContext
  ): Promise<SingleNoteMutationResultDTO> {
    this.checkCapability('properties.write', context);

    if (!request || typeof request.path !== 'string') {
      throw new InvalidRequestError('Missing required field: "path"');
    }
    if (typeof request.key !== 'string' || !request.key.trim()) {
      throw new InvalidRequestError('Missing required field: "key" (must be non-empty string)');
    }
    if (!request.expectedVersion || typeof request.expectedVersion.token !== 'string') {
      throw new InvalidRequestError('Missing required field: "expectedVersion" with valid "token"');
    }

    const normalizedPath = this.resolveNotePath(request.path);

    return this.structuralGate.withShared(async () => {
      return this.withPathLock(normalizedPath, async () => {
        // 1. Read existing note content and version
        const currentSnapshot = await this.storage.read(normalizedPath).catch(() => null);
        if (!currentSnapshot) {
          const err = new NotFoundError(normalizedPath);
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'set_property',
            path: normalizedPath,
            success: false,
            previousVersion: null,
            currentVersion: null,
            grantedScope: 'properties.write',
            indexStatus: this.indexHealth,
            errorMessage: err.message,
          });
          throw err;
        }

        const currentVersion = currentSnapshot.version;

        // 2. Validate expectedVersion
        if (currentVersion.token !== request.expectedVersion.token) {
          const err = new ConflictError(
            normalizedPath,
            {
              token: request.expectedVersion.token,
              hash: request.expectedVersion.hash ?? '',
              modifiedAt: request.expectedVersion.modifiedAt,
              size: request.expectedVersion.size,
            },
            currentVersion,
            undefined,
            `Conflict on "${normalizedPath}": expected version token "${request.expectedVersion.token}", but current version token is "${currentVersion.token}"`
          );
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'set_property',
            path: normalizedPath,
            success: false,
            previousVersion: currentVersion,
            currentVersion: null,
            grantedScope: 'properties.write',
            indexStatus: this.indexHealth,
            errorMessage: err.message,
          });
          throw err;
        }

        const existingContent =
          currentSnapshot.textContent ??
          (typeof currentSnapshot.content === 'string'
            ? currentSnapshot.content
            : new TextDecoder().decode(currentSnapshot.content));

        const { properties } = parseFrontmatter(existingContent);

        // Mutate property map
        const updatedProperties = { ...properties };
        if (request.value === null || request.value === undefined) {
          delete updatedProperties[request.key];
        } else {
          updatedProperties[request.key] = request.value;
        }

        const newContent = updateDocumentFrontmatter(existingContent, updatedProperties);

        // 3. Persist canonically via SafeWriter
        let writeResult: WriteResult;
        try {
          writeResult = await this.safeWriter.safeSave(normalizedPath, newContent, {
            expectedVersion: currentVersion,
          });
        } catch (err: any) {
          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'set_property',
            path: normalizedPath,
            success: false,
            previousVersion: currentVersion,
            currentVersion: null,
            grantedScope: 'properties.write',
            indexStatus: this.indexHealth,
            errorMessage: err?.message,
          });
          throw err;
        }

        const durableVersion = writeResult.snapshot.version;

        // 4. Update derived index
        let indexStatus: 'verified' | 'degraded' = 'verified';
        let indexError: string | undefined;
        try {
          const parsed = await this.parser.parse(normalizedPath, newContent, durableVersion.hash);
          await this.index.upsert(parsed);
        } catch (err: any) {
          indexStatus = 'degraded';
          this.indexHealth = 'degraded';
          indexError = err?.message || String(err);
        }

        const result: SingleNoteMutationResultDTO = {
          operation: 'set_property',
          path: normalizedPath,
          previousVersion: {
            token: currentVersion.token,
            hash: currentVersion.hash,
            modifiedAt: currentVersion.modifiedAt,
            size: currentVersion.size,
          },
          currentVersion: {
            token: durableVersion.token,
            hash: durableVersion.hash,
            modifiedAt: durableVersion.modifiedAt,
            size: durableVersion.size,
          },
          durableSuccess: true,
          indexStatus,
          indexError,
          requestId: context?.requestId,
          clientId: context?.clientId,
        };

        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'set_property',
          path: normalizedPath,
          success: true,
          previousVersion: result.previousVersion,
          currentVersion: result.currentVersion,
          grantedScope: 'properties.write',
          indexStatus,
        });

        return result;
      });
    });
  }

  /**
   * Safely renames a markdown note and refactors inbound wikilinks across the vault using optimistic concurrency control.
   */
  async renameNote(request: RenameNoteRequest, context?: ClientContext): Promise<RenameResultDTO> {
    this.checkCapability('workspace.rename', context);

    if (!request || typeof request.oldPath !== 'string' || typeof request.newPath !== 'string') {
      throw new InvalidRequestError('Missing required fields: "oldPath" and "newPath"');
    }
    if (!request.expectedVersion || typeof request.expectedVersion.token !== 'string') {
      throw new InvalidRequestError('Missing required field: "expectedVersion" with valid "token"');
    }

    const rawOld = request.oldPath.endsWith('.md') ? request.oldPath : `${request.oldPath}.md`;
    const rawNew = request.newPath.endsWith('.md') ? request.newPath : `${request.newPath}.md`;

    const normOldPath = this.resolveNotePath(rawOld);
    const normNewPath = this.resolveNotePath(rawNew);

    if (this.indexHealth === 'degraded') {
      const err = new IndexDegradedError(
        'Cannot execute safe rename: workspace index is in a degraded state. Rebuild/verify required before renaming.'
      );
      await this.auditSink.record({
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        clientId: context?.clientId,
        operation: 'rename',
        path: normOldPath,
        newPath: normNewPath,
        success: false,
        previousVersion: null,
        currentVersion: null,
        grantedScope: 'workspace.rename',
        indexStatus: 'degraded',
        errorMessage: err.message,
      });
      throw err;
    }

    return this.structuralGate.withExclusive(async () => {
      // 1. Snapshot old note
      const oldSnapshot = await this.storage.read(normOldPath).catch(() => null);
      if (!oldSnapshot) {
        const err = new NotFoundError(normOldPath);
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: false,
          previousVersion: null,
          currentVersion: null,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      const currentVersion = oldSnapshot.version;

      // 2. Validate expectedVersion
      if (currentVersion.token !== request.expectedVersion.token) {
        const err = new ConflictError(
          normOldPath,
          {
            token: request.expectedVersion.token,
            hash: request.expectedVersion.hash ?? '',
            modifiedAt: request.expectedVersion.modifiedAt,
            size: request.expectedVersion.size,
          },
          currentVersion,
          undefined,
          `Conflict on "${normOldPath}": expected version token "${request.expectedVersion.token}", but current version token is "${currentVersion.token}"`
        );
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: false,
          previousVersion: currentVersion,
          currentVersion: null,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      // 3. Check identical path no-op
      if (normOldPath === normNewPath) {
        const result: RenameResultDTO = {
          operation: 'rename',
          oldPath: normOldPath,
          newPath: normNewPath,
          previousVersion: {
            token: currentVersion.token,
            hash: currentVersion.hash,
            modifiedAt: currentVersion.modifiedAt,
            size: currentVersion.size,
          },
          currentVersion: {
            token: currentVersion.token,
            hash: currentVersion.hash,
            modifiedAt: currentVersion.modifiedAt,
            size: currentVersion.size,
          },
          updatedFiles: [],
          rewrittenLinkCount: 0,
          durableSuccess: true,
          indexStatus: this.indexHealth,
          requestId: context?.requestId,
          clientId: context?.clientId,
        };
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: true,
          previousVersion: result.previousVersion,
          currentVersion: result.currentVersion,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          updatedFiles: [],
          rewrittenLinkCount: 0,
        });
        return result;
      }

      // 4. Validate target path does not exist
      const targetExists = await this.storage.exists(normNewPath);
      if (targetExists) {
        const err = new ConflictError(
          normNewPath,
          null,
          null,
          undefined,
          `Target path already exists: "${normNewPath}"`
        );
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: false,
          previousVersion: currentVersion,
          currentVersion: null,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      const oldText =
        oldSnapshot.textContent ??
        (typeof oldSnapshot.content === 'string'
          ? oldSnapshot.content
          : new TextDecoder().decode(oldSnapshot.content));

      const newBasename = basenameVaultPath(normNewPath, '.md');
      const updateLinks = request.updateLinks !== false;
      let renamedNoteContent = oldText;
      let totalRewrittenCount = 0;

      // 5. Rewrite self-links in renamed note
      if (updateLinks) {
        const selfRewrite = rewriteNoteWikilinks(oldText, (targetName) => {
          const res = this.index.resolveLink(normOldPath, targetName);
          if (res.resolved && res.targetPath === normOldPath) {
            return { match: true, newTarget: newBasename };
          }
          return { match: false, newTarget: '' };
        });
        renamedNoteContent = selfRewrite.content;
        totalRewrittenCount += selfRewrite.rewrittenCount;
      }

      // 6. Write target note and verify pre-delete version
      let writeTargetResult: WriteResult;
      try {
        writeTargetResult = await this.safeWriter.safeSave(normNewPath, renamedNoteContent, {
          expectedVersion: null,
        });
      } catch (err: any) {
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: false,
          previousVersion: currentVersion,
          currentVersion: null,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          errorMessage: err?.message,
        });
        throw err;
      }

      const preDeleteStat = await this.storage.stat(normOldPath);
      if (
        preDeleteStat?.version &&
        (preDeleteStat.version.token !== currentVersion.token ||
          preDeleteStat.version.hash !== currentVersion.hash)
      ) {
        await this.storage.remove(normNewPath).catch(() => {});
        const err = new ConflictError(
          normOldPath,
          currentVersion,
          preDeleteStat.version,
          undefined,
          `Safe rename aborted: source note "${normOldPath}" was modified externally prior to deletion.`
        );
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'rename',
          path: normOldPath,
          newPath: normNewPath,
          success: false,
          previousVersion: currentVersion,
          currentVersion: null,
          grantedScope: 'workspace.rename',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      await this.storage.remove(normOldPath);
      const durableNewVersion = writeTargetResult.snapshot.version;

      // 7. Refactor incoming backlinks with transactional OCC rollback
      const updatedFiles: VaultPath[] = [];
      if (updateLinks) {
        const backlinks = await this.index.getBacklinks(normOldPath);
        const referencingPaths = Array.from(new Set(backlinks.map((b) => b.sourcePath))).filter(
          (p) => p !== normOldPath
        );

        const rollbackList: Array<{
          path: VaultPath;
          originalSnapshot: FileSnapshot;
          updatedVersion: FileVersion;
        }> = [];

        try {
          for (const sourcePath of referencingPaths) {
            const sourceSnapshot = await this.storage.read(sourcePath);
            const sourceText =
              sourceSnapshot.textContent ??
              (typeof sourceSnapshot.content === 'string'
                ? sourceSnapshot.content
                : new TextDecoder().decode(sourceSnapshot.content));

            const { content: rewrittenText, rewrittenCount } = rewriteNoteWikilinks(
              sourceText,
              (targetName) => {
                const res = this.index.resolveLink(sourcePath, targetName);
                if (res.resolved && res.targetPath === normOldPath) {
                  let replacementTarget = newBasename;
                  if (targetName.includes('/')) {
                    const sourceDir = dirnameVaultPath(sourcePath);
                    if (sourceDir && targetName.startsWith(`${sourceDir}/`)) {
                      replacementTarget = newBasename;
                    } else {
                      replacementTarget = normNewPath.replace(/\.md$/, '');
                    }
                  }
                  return { match: true, newTarget: replacementTarget };
                }
                return { match: false, newTarget: '' };
              }
            );

            if (rewrittenCount > 0) {
              const writeRes = await this.safeWriter.safeSave(sourcePath, rewrittenText, {
                expectedVersion: sourceSnapshot.version,
              });
              rollbackList.push({
                path: sourcePath,
                originalSnapshot: sourceSnapshot,
                updatedVersion: writeRes.snapshot.version,
              });
              const parsed = await this.parser.parse(
                sourcePath,
                rewrittenText,
                writeRes.snapshot.version.hash
              );
              await this.index.upsert(parsed);
              updatedFiles.push(sourcePath);
              totalRewrittenCount += rewrittenCount;
            }
          }
        } catch (refactorErr: any) {
          // Safe transactional rollback of all mutated references
          let rollbackFailed = false;
          for (const rb of rollbackList) {
            try {
              const origText =
                rb.originalSnapshot.textContent ??
                (typeof rb.originalSnapshot.content === 'string'
                  ? rb.originalSnapshot.content
                  : new TextDecoder().decode(rb.originalSnapshot.content));
              const rbWrite = await this.safeWriter.safeSave(rb.path, origText, {
                expectedVersion: rb.updatedVersion,
              });
              const parsed = await this.parser.parse(
                rb.path,
                origText,
                rbWrite.snapshot.version.hash
              );
              await this.index.upsert(parsed);
            } catch (rbErr) {
              rollbackFailed = true;
            }
          }

          // Rollback renamed target note back to source path
          try {
            await this.safeWriter.safeSave(normOldPath, oldText, { expectedVersion: null });
            await this.storage.remove(normNewPath);
            const parsedOld = await this.parser.parse(
              normOldPath,
              oldText,
              oldSnapshot.version.hash
            );
            await this.index.upsert(parsedOld);
            await this.index.remove(normNewPath);
          } catch (rbErr) {
            rollbackFailed = true;
          }

          if (rollbackFailed) {
            this.indexHealth = 'degraded';
            const recoveryErr = new RecoveryRequiredError(
              `Structural rollback failed during rename of "${normOldPath}" to "${normNewPath}". Manual recovery required. Cause: ${refactorErr?.message || String(refactorErr)}`,
              normOldPath
            );
            await this.auditSink.record({
              timestamp: new Date().toISOString(),
              requestId: context?.requestId,
              clientId: context?.clientId,
              operation: 'rename',
              path: normOldPath,
              newPath: normNewPath,
              success: false,
              previousVersion: currentVersion,
              currentVersion: null,
              grantedScope: 'workspace.rename',
              indexStatus: this.indexHealth,
              errorMessage: recoveryErr.message,
            });
            throw recoveryErr;
          }

          await this.auditSink.record({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId,
            clientId: context?.clientId,
            operation: 'rename',
            path: normOldPath,
            newPath: normNewPath,
            success: false,
            previousVersion: currentVersion,
            currentVersion: null,
            grantedScope: 'workspace.rename',
            indexStatus: this.indexHealth,
            errorMessage: refactorErr?.message || String(refactorErr),
          });
          throw refactorErr;
        }
      }

      // 8. Update index for renamed note
      let indexStatus: 'verified' | 'degraded' = 'verified';
      let indexError: string | undefined;
      try {
        await this.index.remove(normOldPath);
        const parsedNew = await this.parser.parse(
          normNewPath,
          renamedNoteContent,
          durableNewVersion.hash
        );
        await this.index.upsert(parsedNew);
      } catch (err: any) {
        indexStatus = 'degraded';
        this.indexHealth = 'degraded';
        indexError = err?.message || String(err);
      }

      const result: RenameResultDTO = {
        operation: 'rename',
        oldPath: normOldPath,
        newPath: normNewPath,
        previousVersion: {
          token: currentVersion.token,
          hash: currentVersion.hash,
          modifiedAt: currentVersion.modifiedAt,
          size: currentVersion.size,
        },
        currentVersion: {
          token: durableNewVersion.token,
          hash: durableNewVersion.hash,
          modifiedAt: durableNewVersion.modifiedAt,
          size: durableNewVersion.size,
        },
        updatedFiles,
        rewrittenLinkCount: totalRewrittenCount,
        durableSuccess: true,
        indexStatus,
        indexError,
        requestId: context?.requestId,
        clientId: context?.clientId,
      };

      await this.auditSink.record({
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        clientId: context?.clientId,
        operation: 'rename',
        path: normOldPath,
        newPath: normNewPath,
        success: true,
        previousVersion: result.previousVersion,
        currentVersion: result.currentVersion,
        grantedScope: 'workspace.rename',
        indexStatus,
        updatedFiles,
        rewrittenLinkCount: totalRewrittenCount,
      });

      return result;
    });
  }

  /**
   * Safely deletes a markdown note using optimistic concurrency control.
   * Inbound wikilinks are preserved untouched as canonical Markdown.
   */
  async deleteNote(request: DeleteNoteRequest, context?: ClientContext): Promise<DeleteResultDTO> {
    this.checkCapability('workspace.delete', context);

    if (!request || typeof request.path !== 'string') {
      throw new InvalidRequestError('Missing required field: "path"');
    }
    if (!request.expectedVersion || typeof request.expectedVersion.token !== 'string') {
      throw new InvalidRequestError('Missing required field: "expectedVersion" with valid "token"');
    }

    const rawPath = request.path.endsWith('.md') ? request.path : `${request.path}.md`;
    const normalizedPath = this.resolveNotePath(rawPath);

    return this.structuralGate.withExclusive(async () => {
      // 1. Snapshot note and verify existence
      const snapshot = await this.storage.read(normalizedPath).catch(() => null);
      if (!snapshot) {
        const err = new NotFoundError(normalizedPath);
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'delete',
          path: normalizedPath,
          success: false,
          previousVersion: null,
          currentVersion: null,
          grantedScope: 'workspace.delete',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      // 2. Validate expectedVersion
      if (snapshot.version.token !== request.expectedVersion.token) {
        const err = new ConflictError(
          normalizedPath,
          {
            token: request.expectedVersion.token,
            hash: request.expectedVersion.hash ?? '',
            modifiedAt: request.expectedVersion.modifiedAt,
            size: request.expectedVersion.size,
          },
          snapshot.version,
          undefined,
          `Conflict on "${normalizedPath}": expected version token "${request.expectedVersion.token}", but current version token is "${snapshot.version.token}"`
        );
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'delete',
          path: normalizedPath,
          success: false,
          previousVersion: snapshot.version,
          currentVersion: null,
          grantedScope: 'workspace.delete',
          indexStatus: this.indexHealth,
          errorMessage: err.message,
        });
        throw err;
      }

      // 3. Remove file canonically from storage
      try {
        await this.storage.remove(normalizedPath);
      } catch (err: any) {
        await this.auditSink.record({
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          clientId: context?.clientId,
          operation: 'delete',
          path: normalizedPath,
          success: false,
          previousVersion: snapshot.version,
          currentVersion: null,
          grantedScope: 'workspace.delete',
          indexStatus: this.indexHealth,
          errorMessage: err?.message,
        });
        throw err;
      }

      // 4. Remove from derived index
      let indexStatus: 'verified' | 'degraded' = 'verified';
      let indexError: string | undefined;
      try {
        await this.index.remove(normalizedPath);
      } catch (err: any) {
        indexStatus = 'degraded';
        this.indexHealth = 'degraded';
        indexError = err?.message || String(err);
      }

      const result: DeleteResultDTO = {
        operation: 'delete',
        path: normalizedPath,
        previousVersion: {
          token: snapshot.version.token,
          hash: snapshot.version.hash,
          modifiedAt: snapshot.modifiedAt,
          size: snapshot.size,
        },
        durableSuccess: true,
        indexStatus,
        indexError,
        requestId: context?.requestId,
        clientId: context?.clientId,
      };

      await this.auditSink.record({
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        clientId: context?.clientId,
        operation: 'delete',
        path: normalizedPath,
        success: true,
        previousVersion: result.previousVersion,
        currentVersion: null,
        grantedScope: 'workspace.delete',
        indexStatus,
      });

      return result;
    });
  }

  // --- Internal Helpers ---

  private checkCapability(requiredScope: string, context?: ClientContext): void {
    if (
      this.readOnly &&
      (requiredScope === 'workspace.write' ||
        requiredScope === 'properties.write' ||
        requiredScope === 'workspace.rename' ||
        requiredScope === 'workspace.delete')
    ) {
      throw new ForbiddenError(
        `Forbidden: Workspace is mounted in read-only mode and cannot execute "${requiredScope}" operations`
      );
    }
    const scopes = context?.scopes;
    if (scopes && !scopes.includes(requiredScope)) {
      throw new ForbiddenError(
        `Forbidden: Client lacks required capability scope "${requiredScope}" (granted: [${scopes.join(', ')}])`
      );
    }
  }

  private async withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.pathLocks.get(path) ?? Promise.resolve();
    let releaseLock!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.pathLocks.set(
      path,
      currentLock.then(() => nextLock)
    );

    await currentLock;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (this.pathLocks.get(path) === nextLock) {
        this.pathLocks.delete(path);
      }
    }
  }

  private resolveNotePath(rawPath: string): VaultPath {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new InvalidRequestError('A valid path string is required');
    }
    return normalizeVaultPath(rawPath);
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
