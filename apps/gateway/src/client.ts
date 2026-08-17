import { randomUUID } from 'node:crypto';
import { VaultEntry } from '@okw/core';
import {
  BacklinkDTO,
  CreateNoteRequest,
  DeleteNoteRequest,
  DeleteResultDTO,
  GraphNeighborDTO,
  NoteReadResult,
  OutgoingLinkDTO,
  PropertyMapDTO,
  RenameNoteRequest,
  RenameResultDTO,
  SearchRequestDTO,
  SearchResultDTO,
  SetPropertyRequest,
  SingleNoteMutationResultDTO,
  UpdateNoteRequest,
  WorkspaceInfo,
} from '@okw/workspace';

export interface GatewayClientOptions {
  readonly url: string;
  readonly token?: string;
  readonly clientId?: string;
  readonly fetchFn?: typeof fetch;
}

export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, any>;

  constructor(status: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class GatewayUnavailableError extends GatewayError {
  constructor(url: string, cause?: unknown) {
    super(
      503,
      'GATEWAY_UNAVAILABLE',
      `Unable to connect to OpenOb Gateway at "${url}". Is the gateway running?\n(Start it with: npx openob-gateway <vault-path>)`,
      { url, cause: cause instanceof Error ? cause.message : String(cause) }
    );
    this.name = 'GatewayUnavailableError';
  }
}

/**
 * Typed client for interacting with the OpenOb Gateway REST API (/api/v1).
 * Used by the CLI and live MCP server to route all operations through the authoritative gateway.
 */
export class OpenObGatewayClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly clientId: string;
  private readonly customFetch: typeof fetch;

  constructor(options: GatewayClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.clientId = options.clientId || 'openob-client';
    this.customFetch = options.fetchFn || fetch;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getClientId(): string {
    return this.clientId;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: any;
      headers?: Record<string, string>;
      requestId?: string;
    } = {}
  ): Promise<T> {
    const targetUrl = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const requestId = options.requestId || randomUUID();

    const headers: Record<string, string> = {
      'User-Agent': `${this.clientId}/0.1.0`,
      'X-OpenOb-Client-Id': this.clientId,
      'X-OpenOb-Request-Id': requestId,
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
      headers['X-OpenOb-Token'] = this.token;
    }

    let bodyStr: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.customFetch(targetUrl, {
        method,
        headers,
        body: bodyStr,
      });
    } catch (err) {
      throw new GatewayUnavailableError(this.baseUrl, err);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const code = data?.code || data?.error?.code || `HTTP_${response.status}`;
      const message =
        data?.message ||
        data?.error?.message ||
        `Gateway request failed with HTTP ${response.status} ${response.statusText}`;
      const details = data?.details || data?.error?.details || data;
      throw new GatewayError(response.status, code, message, details);
    }

    return data as T;
  }

  // --- Read & Search Operations ---

  async getWorkspaceInfo(requestId?: string): Promise<WorkspaceInfo> {
    return this.request<WorkspaceInfo>('/api/v1/workspace', { method: 'GET', requestId });
  }

  async listEntries(subpath?: string, requestId?: string): Promise<VaultEntry[]> {
    const query = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
    return this.request<VaultEntry[]>(`/api/v1/entries${query}`, { method: 'GET', requestId });
  }

  async readNote(path: string, requestId?: string): Promise<NoteReadResult> {
    return this.request<NoteReadResult>(`/api/v1/notes/${encodeURIComponent(path)}`, {
      method: 'GET',
      requestId,
    });
  }

  async search(request: SearchRequestDTO, requestId?: string): Promise<SearchResultDTO> {
    const params = new URLSearchParams();
    params.set('q', request.query);
    if (request.tags && request.tags.length > 0) {
      params.set('tags', request.tags.join(','));
    }
    if (request.pathPrefix) {
      params.set('path', request.pathPrefix);
    }
    if (request.limit !== undefined) {
      params.set('limit', String(request.limit));
    }
    return this.request<SearchResultDTO>(`/api/v1/search?${params.toString()}`, {
      method: 'GET',
      requestId,
    });
  }

  async getBacklinks(path: string, requestId?: string): Promise<BacklinkDTO[]> {
    return this.request<BacklinkDTO[]>(`/api/v1/notes/${encodeURIComponent(path)}/backlinks`, {
      method: 'GET',
      requestId,
    });
  }

  async getOutgoingLinks(path: string, requestId?: string): Promise<OutgoingLinkDTO[]> {
    return this.request<OutgoingLinkDTO[]>(`/api/v1/notes/${encodeURIComponent(path)}/links`, {
      method: 'GET',
      requestId,
    });
  }

  async getProperties(path: string, requestId?: string): Promise<PropertyMapDTO> {
    return this.request<PropertyMapDTO>(`/api/v1/notes/${encodeURIComponent(path)}/properties`, {
      method: 'GET',
      requestId,
    });
  }

  async getGraphNeighbors(path: string, requestId?: string): Promise<GraphNeighborDTO[]> {
    return this.request<GraphNeighborDTO[]>(
      `/api/v1/notes/${encodeURIComponent(path)}/graph-neighbors`,
      {
        method: 'GET',
        requestId,
      }
    );
  }

  // --- Mutation Operations ---

  async createNote(
    request: CreateNoteRequest,
    requestId?: string
  ): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>('/api/v1/notes', {
      method: 'POST',
      body: request,
      requestId,
    });
  }

  async updateNote(
    request: UpdateNoteRequest,
    requestId?: string
  ): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>(
      `/api/v1/notes/${encodeURIComponent(request.path)}`,
      {
        method: 'PUT',
        body: {
          content: request.content,
          expectedVersion: request.expectedVersion,
        },
        requestId,
      }
    );
  }

  async setProperty(
    request: SetPropertyRequest,
    requestId?: string
  ): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>(
      `/api/v1/notes/${encodeURIComponent(request.path)}/properties`,
      {
        method: 'PATCH',
        body: {
          key: request.key,
          value: request.value,
          expectedVersion: request.expectedVersion,
        },
        requestId,
      }
    );
  }

  async renameNote(request: RenameNoteRequest, requestId?: string): Promise<RenameResultDTO> {
    return this.request<RenameResultDTO>(
      `/api/v1/notes/${encodeURIComponent(request.oldPath)}/rename`,
      {
        method: 'POST',
        body: {
          newPath: request.newPath,
          expectedVersion: request.expectedVersion,
          updateLinks: request.updateLinks,
        },
        requestId,
      }
    );
  }

  async deleteNote(request: DeleteNoteRequest, requestId?: string): Promise<DeleteResultDTO> {
    const headers: Record<string, string> = {};
    if (request.expectedVersion?.token) {
      headers['If-Match'] = `"${request.expectedVersion.token}"`;
    }
    return this.request<DeleteResultDTO>(`/api/v1/notes/${encodeURIComponent(request.path)}`, {
      method: 'DELETE',
      headers,
      body: {
        expectedVersion: request.expectedVersion,
      },
      requestId,
    });
  }
}
