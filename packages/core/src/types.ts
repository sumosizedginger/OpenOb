/**
 * VaultPath is a normalized, relative POSIX-style path within a vault.
 * Examples: "notes/index.md", "daily/2026-08-15.md", "attachments/image.png"
 * Never starts with a leading slash or contains ".." traversal.
 */
export type VaultPath = string;

/**
 * FileVersion represents a concurrency token.
 * It is calculated from content hash and/or modified timestamp
 * to detect external or concurrent modifications.
 */
export interface FileVersion {
  readonly token: string;
  readonly hash: string;
  readonly modifiedAt?: number;
  readonly size?: number;
}

/**
 * FileSnapshot represents an immutable read-snapshot of a file at a specific version.
 */
export interface FileSnapshot {
  readonly path: VaultPath;
  readonly version: FileVersion;
  readonly content: Uint8Array;
  readonly textContent?: string;
  readonly modifiedAt: number;
  readonly size: number;
}

/**
 * FileStat represents filesystem metadata for a file or directory.
 */
export interface FileStat {
  readonly path: VaultPath;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly modifiedAt: number;
  readonly version?: FileVersion;
}

/**
 * VaultEntry represents an item in a directory listing.
 */
export interface VaultEntry {
  readonly path: VaultPath;
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size?: number;
  readonly modifiedAt?: number;
}

/**
 * WriteResult returned after a successful safe-write operation.
 */
export interface WriteResult {
  readonly snapshot: FileSnapshot;
  readonly previousVersion: FileVersion | null;
  readonly wasCreated: boolean;
}

/**
 * Phase 5 Graph Model Interfaces (Constitution Law 21: Derived from DocumentIndex only)
 */

export type GraphEdgeKind = 'wikilink' | 'embed' | 'tag' | 'property';

export interface GraphEdgeProvenance {
  readonly line?: number;
  readonly isEmbed?: boolean;
  readonly propertyKey?: string;
  readonly tag?: string;
}

export interface GraphNode {
  readonly id: string;
  readonly path: VaultPath;
  readonly title: string;
  readonly tags: string[];
  readonly val: number; // Node weight (degree / backlink count)
  readonly group: string; // Folder or primary category
  readonly properties?: Record<string, any>;
  readonly isTagNode?: boolean;
}

export interface GraphEdge {
  readonly source: string; // Source node id / path
  readonly target: string; // Target node id / path
  readonly kind: GraphEdgeKind;
  readonly provenance?: GraphEdgeProvenance;
}

export interface GraphData {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}

export interface GraphFilterOptions {
  readonly includeTags?: boolean;
  readonly folders?: string[];
  readonly filterTags?: string[];
  readonly searchQuery?: string;
  readonly hideOrphans?: boolean;
  readonly focusNodeId?: string; // Local graph center
  readonly maxDepth?: number; // Local graph radius (default: 1 or 2)
}

/**
 * Phase 6 Notion-Like View Interfaces (Constitution Law 21: Strictly derived from open file metadata)
 */

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty';

export interface PropertyFilter {
  readonly field: string; // e.g. "status", "priority", "tags", "title", "path"
  readonly operator: FilterOperator;
  readonly value?: any;
}

export interface PropertySort {
  readonly field: string; // e.g. "title", "modifiedAt", "priority", "status"
  readonly direction: 'asc' | 'desc';
}

export type ViewType = 'table' | 'board' | 'list';

export interface ViewConfig {
  readonly id: string;
  readonly name: string;
  readonly type: ViewType;
  readonly filters?: PropertyFilter[];
  readonly sorts?: PropertySort[];
  readonly groupBy?: string; // Group field for Kanban boards (e.g. "status", "priority")
  readonly visibleProperties?: string[]; // Display columns in table / properties on cards
  readonly folderScope?: string; // Scope to specific folder
}

export interface SavedView extends ViewConfig {
  readonly createdAt: number;
  readonly updatedAt: number;
}
