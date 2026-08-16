import { ConflictError, NotFoundError, SecurityError, StorageError, VaultError } from '@okw/core';
import { ApiErrorCode, ApiErrorDTO } from './types.js';

/**
 * Base error class for workspace-level errors.
 */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode = 'INTERNAL_ERROR',
    public readonly status: number = 500,
    public readonly path?: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export class UnauthorizedError extends WorkspaceError {
  constructor(message = 'Unauthorized: Missing or invalid authentication credentials') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends WorkspaceError {
  constructor(message = 'Forbidden: Client lacks required capability scope') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class InvalidPathError extends WorkspaceError {
  constructor(path: string, message?: string) {
    super(message || `Invalid path or traversal attempt: "${path}"`, 'INVALID_PATH', 400, path);
    this.name = 'InvalidPathError';
  }
}

export class InvalidRequestError extends WorkspaceError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'INVALID_REQUEST', 400, undefined, details);
    this.name = 'InvalidRequestError';
  }
}

export class UnsupportedError extends WorkspaceError {
  constructor(message = 'Operation unsupported in current workspace mode') {
    super(message, 'UNSUPPORTED', 405);
    this.name = 'UnsupportedError';
  }
}

/**
 * Maps an internal exception to a structured API error status code and DTO.
 */
export function toApiError(
  err: unknown,
  fallbackPath?: string
): { status: number; body: ApiErrorDTO } {
  if (err instanceof WorkspaceError) {
    return {
      status: err.status,
      body: {
        code: err.code,
        message: err.message,
        path: err.path ?? fallbackPath,
        details: err.details,
      },
    };
  }

  if (err instanceof NotFoundError) {
    return {
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: err.message,
        path: err.path,
      },
    };
  }

  if (err instanceof SecurityError) {
    return {
      status: 400,
      body: {
        code: 'INVALID_PATH',
        message: err.message,
        path: fallbackPath,
      },
    };
  }

  if (err instanceof ConflictError) {
    return {
      status: 409,
      body: {
        code: 'CONFLICT',
        message: err.message,
        path: err.path,
        details: {
          expectedVersion: err.expectedVersion,
          actualVersion: err.actualVersion,
        },
      },
    };
  }

  if (err instanceof StorageError) {
    return {
      status: 500,
      body: {
        code: 'STORAGE_ERROR',
        message: fallbackPath
          ? `Storage error while accessing "${fallbackPath}"`
          : 'A storage error occurred during file operations',
        path: fallbackPath,
      },
    };
  }

  if (err instanceof VaultError) {
    return {
      status: 400,
      body: {
        code: 'INVALID_REQUEST',
        message: err.message,
        path: fallbackPath,
      },
    };
  }

  if (err instanceof TypeError || (err instanceof Error && err.name === 'SyntaxError')) {
    return {
      status: 400,
      body: {
        code: 'INVALID_REQUEST',
        message: err.message,
        path: fallbackPath,
      },
    };
  }

  return {
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      path: fallbackPath,
    },
  };
}
