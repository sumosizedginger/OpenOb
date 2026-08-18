import {
  ConflictError,
  FilterOperator,
  FileVersion,
  NotFoundError,
  SavedViewEnvelope,
  VaultStorage,
  ViewConfig,
  ViewType,
} from '@okw/core';
import { SafeWriter } from '@okw/vault';
import { InvalidRequestError } from './errors.js';
import {
  CreateSavedViewRequest,
  DeleteSavedViewResultDTO,
  ExpectedVersionDTO,
  SavedViewDTO,
  UpdateSavedViewRequest,
} from './types.js';

const ALLOWED_VIEW_TYPES = new Set<ViewType>(['table', 'board', 'list']);
const ALLOWED_OPERATORS = new Set<FilterOperator>([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
]);

const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Generates a unique, URL-safe and filesystem-safe view ID.
 */
export function generateSavedViewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `view_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `view_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validates a view ID to prevent path traversal and malformed strings.
 */
export function validateViewId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new InvalidRequestError('View ID must be a non-empty string');
  }
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(trimmed)) {
    throw new InvalidRequestError(
      `Invalid view ID format: "${trimmed}". Must be 4-64 alphanumeric, dash, or underscore characters.`
    );
  }
  return trimmed;
}

/**
 * Validates user-supplied view configuration parameters.
 */
export function validateViewConfig(input: Partial<ViewConfig>): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidRequestError('View configuration must be a valid JSON object');
  }

  // Name validation
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      throw new InvalidRequestError('View "name" must be a string');
    }
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 120) {
      throw new InvalidRequestError('View "name" must be between 1 and 120 characters');
    }
  }

  // Type validation
  if (input.type !== undefined) {
    if (!ALLOWED_VIEW_TYPES.has(input.type)) {
      throw new InvalidRequestError(
        `Invalid view "type": "${input.type}". Allowed types: table, board, list`
      );
    }
  }

  // Folder scope validation
  if (input.folderScope !== undefined && input.folderScope !== null && input.folderScope !== '') {
    if (typeof input.folderScope !== 'string') {
      throw new InvalidRequestError('View "folderScope" must be a string');
    }
    if (input.folderScope.length > 256) {
      throw new InvalidRequestError('View "folderScope" cannot exceed 256 characters');
    }
    if (input.folderScope.includes('..') || input.folderScope.includes('\0')) {
      throw new InvalidRequestError('View "folderScope" contains invalid path characters');
    }
  }

  // GroupBy validation
  if (input.groupBy !== undefined && input.groupBy !== null && input.groupBy !== '') {
    if (typeof input.groupBy !== 'string') {
      throw new InvalidRequestError('View "groupBy" must be a string');
    }
    if (input.groupBy.length > 100) {
      throw new InvalidRequestError('View "groupBy" field name cannot exceed 100 characters');
    }
    if (FORBIDDEN_PROPERTY_NAMES.has(input.groupBy)) {
      throw new InvalidRequestError(`Forbidden "groupBy" property name: "${input.groupBy}"`);
    }
  }

  // Visible properties validation
  if (input.visibleProperties !== undefined && input.visibleProperties !== null) {
    if (!Array.isArray(input.visibleProperties)) {
      throw new InvalidRequestError('View "visibleProperties" must be an array of strings');
    }
    if (input.visibleProperties.length > 64) {
      throw new InvalidRequestError('View "visibleProperties" cannot exceed 64 columns');
    }
    for (const prop of input.visibleProperties) {
      if (typeof prop !== 'string' || prop.trim().length === 0 || prop.length > 100) {
        throw new InvalidRequestError(
          'Each visible property column must be a non-empty string under 100 characters'
        );
      }
      if (FORBIDDEN_PROPERTY_NAMES.has(prop)) {
        throw new InvalidRequestError(`Forbidden property name in visibleProperties: "${prop}"`);
      }
    }
  }

  // Filters validation
  if (input.filters !== undefined && input.filters !== null) {
    if (!Array.isArray(input.filters)) {
      throw new InvalidRequestError('View "filters" must be an array');
    }
    if (input.filters.length > 32) {
      throw new InvalidRequestError('View "filters" cannot exceed 32 filter conditions');
    }
    for (let i = 0; i < input.filters.length; i++) {
      const filter = input.filters[i];
      if (!filter || typeof filter !== 'object') {
        throw new InvalidRequestError(`Filter at index ${i} must be a valid object`);
      }
      if (typeof filter.field !== 'string' || filter.field.trim().length === 0) {
        throw new InvalidRequestError(`Filter at index ${i} has an invalid "field"`);
      }
      if (filter.field.length > 100 || FORBIDDEN_PROPERTY_NAMES.has(filter.field)) {
        throw new InvalidRequestError(`Filter at index ${i} has a forbidden or oversized field`);
      }
      if (!ALLOWED_OPERATORS.has(filter.operator)) {
        throw new InvalidRequestError(
          `Filter at index ${i} has an unsupported operator "${filter.operator}"`
        );
      }
      if (typeof filter.value === 'number' && (isNaN(filter.value) || !isFinite(filter.value))) {
        throw new InvalidRequestError(
          `Filter at index ${i} contains NaN or Infinity numeric value`
        );
      }
    }
  }

  // Sorts validation
  if (input.sorts !== undefined && input.sorts !== null) {
    if (!Array.isArray(input.sorts)) {
      throw new InvalidRequestError('View "sorts" must be an array');
    }
    if (input.sorts.length > 8) {
      throw new InvalidRequestError('View "sorts" cannot exceed 8 sort conditions');
    }
    for (let i = 0; i < input.sorts.length; i++) {
      const sort = input.sorts[i];
      if (!sort || typeof sort !== 'object') {
        throw new InvalidRequestError(`Sort at index ${i} must be a valid object`);
      }
      if (typeof sort.field !== 'string' || sort.field.trim().length === 0) {
        throw new InvalidRequestError(`Sort at index ${i} has an invalid "field"`);
      }
      if (sort.field.length > 100 || FORBIDDEN_PROPERTY_NAMES.has(sort.field)) {
        throw new InvalidRequestError(`Sort at index ${i} has a forbidden or oversized field`);
      }
      if (sort.direction !== 'asc' && sort.direction !== 'desc') {
        throw new InvalidRequestError(
          `Sort at index ${i} direction must be either "asc" or "desc"`
        );
      }
    }
  }
}

/**
 * Parses and validates raw JSON content into a SavedViewEnvelope.
 * Returns null if the JSON is malformed or invalid schema.
 */
export function parseSavedViewEnvelope(jsonString: string): SavedViewEnvelope | null {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    if (parsed.schemaVersion !== 1) {
      return null;
    }
    if (typeof parsed.id !== 'string' || !parsed.id) {
      return null;
    }
    if (typeof parsed.name !== 'string' || !parsed.name) {
      return null;
    }
    if (!ALLOWED_VIEW_TYPES.has(parsed.type)) {
      return null;
    }
    if (typeof parsed.createdAt !== 'number' || typeof parsed.updatedAt !== 'number') {
      return null;
    }
    validateViewConfig(parsed);
    return parsed as SavedViewEnvelope;
  } catch {
    return null;
  }
}

/**
 * Builds the canonical vault path for a saved view JSON file.
 */
export function getSavedViewVaultPath(viewId: string): string {
  const safeId = validateViewId(viewId);
  return `.openob/views/${safeId}.json`;
}

/**
 * Dedicated SavedViewStore managing JSON persistence in `.openob/views/<id>.json`.
 */
export class SavedViewStore {
  private viewLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: VaultStorage,
    private readonly safeWriter: SafeWriter
  ) {}

  private async withViewLock<T>(viewId: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.viewLocks.get(viewId) || Promise.resolve();
    let release: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.viewLocks.set(viewId, nextLock);

    await currentLock;
    try {
      return await fn();
    } finally {
      release();
      if (this.viewLocks.get(viewId) === nextLock) {
        this.viewLocks.delete(viewId);
      }
    }
  }

  /**
   * Lists all valid saved views in the vault.
   * Silently skips corrupted files without failing the entire list.
   */
  async listSavedViews(): Promise<SavedViewDTO[]> {
    const entries = await this.storage.list('.openob/views', false).catch(() => []);
    const results: SavedViewDTO[] = [];

    for (const entry of entries) {
      if (entry.isDirectory || !entry.path.endsWith('.json')) {
        continue;
      }
      try {
        const snapshot = await this.storage.read(entry.path);
        const text =
          snapshot.textContent ??
          (typeof snapshot.content === 'string'
            ? snapshot.content
            : new TextDecoder().decode(snapshot.content));
        const envelope = parseSavedViewEnvelope(text);
        if (envelope) {
          results.push({
            view: {
              id: envelope.id,
              name: envelope.name,
              type: envelope.type,
              filters: envelope.filters,
              sorts: envelope.sorts,
              groupBy: envelope.groupBy,
              visibleProperties: envelope.visibleProperties,
              folderScope: envelope.folderScope,
              createdAt: envelope.createdAt,
              updatedAt: envelope.updatedAt,
            },
            version: {
              token: snapshot.version.token,
              hash: snapshot.version.hash,
              modifiedAt: snapshot.modifiedAt,
              size: snapshot.size,
            },
          });
        }
      } catch {
        // Corrupted file ignored in listings
      }
    }

    // Deterministic sort by name ASC, then id ASC
    return results.sort((a, b) => {
      const nameCmp = a.view.name.localeCompare(b.view.name);
      if (nameCmp !== 0) return nameCmp;
      return a.view.id.localeCompare(b.view.id);
    });
  }

  /**
   * Retrieves a single saved view by its ID.
   */
  async getSavedView(id: string): Promise<SavedViewDTO> {
    const path = getSavedViewVaultPath(id);
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

    const envelope = parseSavedViewEnvelope(text);
    if (!envelope) {
      throw new InvalidRequestError(
        `Saved view at "${path}" is corrupted or contains an invalid schema`
      );
    }

    return {
      view: {
        id: envelope.id,
        name: envelope.name,
        type: envelope.type,
        filters: envelope.filters,
        sorts: envelope.sorts,
        groupBy: envelope.groupBy,
        visibleProperties: envelope.visibleProperties,
        folderScope: envelope.folderScope,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      },
      version: {
        token: snapshot.version.token,
        hash: snapshot.version.hash,
        modifiedAt: snapshot.modifiedAt,
        size: snapshot.size,
      },
    };
  }

  /**
   * Creates a new saved view under `.openob/views/<generated-id>.json`.
   */
  async createSavedView(request: CreateSavedViewRequest): Promise<SavedViewDTO> {
    if (!request.name || typeof request.name !== 'string' || !request.name.trim()) {
      throw new InvalidRequestError('Saved view "name" is required');
    }
    if (!request.type || !ALLOWED_VIEW_TYPES.has(request.type)) {
      throw new InvalidRequestError('Saved view "type" must be one of: table, board, list');
    }
    validateViewConfig(request);

    const id = generateSavedViewId();
    const path = getSavedViewVaultPath(id);
    const now = Date.now();

    const envelope: SavedViewEnvelope = {
      schemaVersion: 1,
      id,
      name: request.name.trim(),
      type: request.type,
      filters: request.filters && request.filters.length > 0 ? request.filters : undefined,
      sorts: request.sorts && request.sorts.length > 0 ? request.sorts : undefined,
      groupBy: request.groupBy?.trim() || undefined,
      visibleProperties:
        request.visibleProperties && request.visibleProperties.length > 0
          ? request.visibleProperties
          : undefined,
      folderScope: request.folderScope?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const json = JSON.stringify(envelope, null, 2);
    // Creation safety is guaranteed by high-entropy UUID-based view ID uniqueness and path validation.
    // expectedVersion: null indicates no version precondition is required on initial file creation.
    const writeResult = await this.safeWriter.safeSave(path, json, {
      expectedVersion: null,
    });

    return {
      view: {
        id: envelope.id,
        name: envelope.name,
        type: envelope.type,
        filters: envelope.filters,
        sorts: envelope.sorts,
        groupBy: envelope.groupBy,
        visibleProperties: envelope.visibleProperties,
        folderScope: envelope.folderScope,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      },
      version: {
        token: writeResult.snapshot.version.token,
        hash: writeResult.snapshot.version.hash,
        modifiedAt: writeResult.snapshot.modifiedAt,
        size: writeResult.snapshot.size,
      },
    };
  }

  /**
   * Updates an existing saved view with OCC protection.
   */
  async updateSavedView(id: string, request: UpdateSavedViewRequest): Promise<SavedViewDTO> {
    const safeId = validateViewId(id);
    return this.withViewLock(safeId, async () => {
      const path = getSavedViewVaultPath(safeId);
      if (!request.expectedVersion || !request.expectedVersion.token) {
        throw new InvalidRequestError(
          'UpdateSavedViewRequest requires a valid "expectedVersion" token'
        );
      }
      validateViewConfig(request);

      // Read current view to preserve createdAt and existing values
      const current = await this.getSavedView(safeId);

      // Pre-flight OCC Check
      if (
        current.version.token !== request.expectedVersion.token ||
        (request.expectedVersion.hash && current.version.hash !== request.expectedVersion.hash)
      ) {
        throw new ConflictError(
          path,
          {
            token: request.expectedVersion.token,
            hash: request.expectedVersion.hash || '',
            modifiedAt: request.expectedVersion.modifiedAt,
            size: request.expectedVersion.size,
          },
          {
            token: current.version.token,
            hash: current.version.hash || '',
            modifiedAt: current.version.modifiedAt,
            size: current.version.size,
          }
        );
      }

      const now = Date.now();
      const envelope: SavedViewEnvelope = {
        schemaVersion: 1,
        id: current.view.id,
        name: request.name !== undefined ? request.name.trim() : current.view.name,
        type: request.type !== undefined ? request.type : current.view.type,
        filters: request.filters !== undefined ? request.filters : current.view.filters,
        sorts: request.sorts !== undefined ? request.sorts : current.view.sorts,
        groupBy:
          request.groupBy !== undefined
            ? request.groupBy?.trim() || undefined
            : current.view.groupBy,
        visibleProperties:
          request.visibleProperties !== undefined
            ? request.visibleProperties
            : current.view.visibleProperties,
        folderScope:
          request.folderScope !== undefined
            ? request.folderScope?.trim() || undefined
            : current.view.folderScope,
        createdAt: current.view.createdAt,
        updatedAt: now,
      };

      const json = JSON.stringify(envelope, null, 2);
      const expectedVer: FileVersion = {
        token: request.expectedVersion.token,
        hash: request.expectedVersion.hash || current.version.hash || '',
        modifiedAt: request.expectedVersion.modifiedAt,
        size: request.expectedVersion.size,
      };

      const writeResult = await this.safeWriter.safeSave(path, json, {
        expectedVersion: expectedVer,
      });

      return {
        view: {
          id: envelope.id,
          name: envelope.name,
          type: envelope.type,
          filters: envelope.filters,
          sorts: envelope.sorts,
          groupBy: envelope.groupBy,
          visibleProperties: envelope.visibleProperties,
          folderScope: envelope.folderScope,
          createdAt: envelope.createdAt,
          updatedAt: envelope.updatedAt,
        },
        version: {
          token: writeResult.snapshot.version.token,
          hash: writeResult.snapshot.version.hash,
          modifiedAt: writeResult.snapshot.modifiedAt,
          size: writeResult.snapshot.size,
        },
      };
    });
  }

  /**
   * Deletes a saved view with OCC protection.
   */
  async deleteSavedView(
    id: string,
    expectedVersion: ExpectedVersionDTO
  ): Promise<DeleteSavedViewResultDTO> {
    const safeId = validateViewId(id);
    return this.withViewLock(safeId, async () => {
      const path = getSavedViewVaultPath(safeId);
      if (!expectedVersion || !expectedVersion.token) {
        throw new InvalidRequestError(
          'DeleteSavedViewRequest requires a valid "expectedVersion" token'
        );
      }

      const current = await this.getSavedView(safeId);

      // Verify token match
      if (
        current.version.token !== expectedVersion.token ||
        (expectedVersion.hash && current.version.hash !== expectedVersion.hash)
      ) {
        throw new ConflictError(
          path,
          {
            token: expectedVersion.token,
            hash: expectedVersion.hash || '',
            modifiedAt: expectedVersion.modifiedAt,
            size: expectedVersion.size,
          },
          {
            token: current.version.token,
            hash: current.version.hash || '',
            modifiedAt: current.version.modifiedAt,
            size: current.version.size,
          }
        );
      }

      await this.storage.remove(path);

      return {
        operation: 'delete_view',
        viewId: safeId,
        previousVersion: expectedVersion,
        durableSuccess: true,
      };
    });
  }
}
