import { VaultPath } from '@okw/core';

/**
 * Information summarizing the workspace and its runtime state.
 */
export interface WorkspaceInfo {
  readonly name: string;
  readonly storageType: string;
  readonly readOnly: boolean;
  readonly apiVersion: string;
  readonly noteCount: number;
  readonly totalFiles: number;
  readonly capabilities: string[];
  readonly indexStatus?: 'verified' | 'degraded';
}

/**
 * Compact summary of a single note for listings and previews.
 */
export interface NoteSummary {
  readonly path: VaultPath;
  readonly title: string;
  readonly wordCount: number;
  readonly lineCount: number;
  readonly modifiedAt?: number;
  readonly size?: number;
  readonly tags: string[];
  readonly aliases: string[];
  readonly hasFrontmatter: boolean;
}

/**
 * Detailed read result for a note including parsed metadata, headings, wikilinks, and raw content.
 */
export interface NoteReadResult {
  readonly path: VaultPath;
  readonly title: string;
  readonly textContent: string;
  readonly version: {
    readonly token: string;
    readonly hash: string;
    readonly modifiedAt?: number;
    readonly size?: number;
  };
  readonly properties: Record<string, any>;
  readonly tags: string[];
  readonly headings: Array<{
    readonly level: number;
    readonly text: string;
    readonly line: number;
  }>;
  readonly links: Array<{
    readonly target: string;
    readonly raw: string;
    readonly displayText?: string;
    readonly subpath?: string;
    readonly line: number;
    readonly isEmbed: boolean;
  }>;
  readonly aliases: string[];
  readonly wordCount: number;
  readonly lineCount: number;
  readonly hasBom: boolean;
}

/**
 * Protocol-neutral search query request.
 */
export interface SearchRequestDTO {
  readonly query: string;
  readonly tags?: string[];
  readonly pathPrefix?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Single search match result item.
 */
export interface SearchResultMatch {
  readonly path: VaultPath;
  readonly title: string;
  readonly matchSnippet?: string;
  readonly score: number;
  readonly source: string;
}

/**
 * Protocol-neutral search query response.
 */
export interface SearchResultDTO {
  readonly query: string;
  readonly total: number;
  readonly matches: SearchResultMatch[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Backlink referencing a note.
 */
export interface BacklinkDTO {
  readonly sourcePath: VaultPath;
  readonly sourceTitle: string;
  readonly rawLink: string;
  readonly line: number;
  readonly displayText?: string;
  readonly isEmbed?: boolean;
  readonly excerpt?: string;
}

/**
 * Outgoing wikilink from a note.
 */
export interface OutgoingLinkDTO {
  readonly targetPath?: VaultPath;
  readonly rawTarget: string;
  readonly displayText?: string;
  readonly line: number;
  readonly isEmbed: boolean;
  readonly resolved: boolean;
}

/**
 * Structured property map for a note.
 */
export interface PropertyMapDTO {
  readonly path: VaultPath;
  readonly properties: Record<string, any>;
}

/**
 * Graph neighbors and edge relationships for a note.
 */
export interface GraphNeighborDTO {
  readonly path: VaultPath;
  readonly title: string;
  readonly incoming: BacklinkDTO[];
  readonly outgoing: OutgoingLinkDTO[];
  readonly neighbors: Array<{
    readonly path: VaultPath;
    readonly title: string;
    readonly direction: 'incoming' | 'outgoing' | 'bidirectional';
    readonly kind: 'wikilink' | 'embed' | 'tag' | 'property';
  }>;
}

/**
 * Expected version token passed for optimistic concurrency control.
 */
export interface ExpectedVersionDTO {
  readonly token: string;
  readonly hash?: string;
  readonly modifiedAt?: number;
  readonly size?: number;
}

/**
 * Request payload to create a new note in the workspace.
 */
export interface CreateNoteRequest {
  readonly path: string;
  readonly content?: string;
  readonly properties?: Record<string, unknown>;
}

/**
 * Request payload to update the body content of an existing note.
 */
export interface UpdateNoteRequest {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion: ExpectedVersionDTO;
}

/**
 * Request payload to set or delete a property on a note.
 */
export interface SetPropertyRequest {
  readonly path: string;
  readonly key: string;
  readonly value?: unknown;
  readonly expectedVersion: ExpectedVersionDTO;
}

/**
 * Structured response for any note mutation operation.
 */
export interface MutationResultDTO {
  readonly operation: 'create' | 'update' | 'set_property';
  readonly path: VaultPath;
  readonly previousVersion: ExpectedVersionDTO | null;
  readonly currentVersion: ExpectedVersionDTO;
  readonly durableSuccess: boolean;
  readonly indexStatus: 'verified' | 'degraded';
  readonly indexError?: string;
  readonly requestId?: string;
  readonly clientId?: string;
}

/**
 * Structured audit record captured for every mutation attempt.
 */
export interface MutationAuditEvent {
  readonly timestamp: string;
  readonly requestId?: string;
  readonly clientId?: string;
  readonly operation: 'create' | 'update' | 'set_property';
  readonly path: VaultPath;
  readonly success: boolean;
  readonly previousVersion?: ExpectedVersionDTO | null;
  readonly currentVersion?: ExpectedVersionDTO | null;
  readonly grantedScope: string;
  readonly indexStatus: 'verified' | 'degraded';
  readonly errorMessage?: string;
}

/**
 * Injectable audit sink interface.
 */
export interface AuditSink {
  record(event: MutationAuditEvent): Promise<void> | void;
}

/**
 * Standard machine-readable error categories for external API access.
 */
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_PATH'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'STORAGE_ERROR'
  | 'UNSUPPORTED'
  | 'INTERNAL_ERROR';

/**
 * Protocol-neutral structured API error DTO.
 */
export interface ApiErrorDTO {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly path?: VaultPath;
  readonly details?: Record<string, any>;
}

/**
 * Request context carrying client identity and capability metadata.
 */
export interface ClientContext {
  readonly clientId?: string;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly scopes?: string[];
}
