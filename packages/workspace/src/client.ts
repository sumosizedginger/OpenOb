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
} from './types.js';

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

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Typed client for interacting with the OpenOb Gateway REST API (/api/v1).
 * Used by the Web UI, CLI, and live MCP server to route all operations through the authoritative gateway.
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
    const defaultFetch =
      typeof window !== 'undefined' ? window.fetch.bind(window) : globalThis.fetch;
    this.customFetch = options.fetchFn || defaultFetch;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getClientId(): string {
    return this.clientId;
  }

  public getToken(): string | undefined {
    return this.token;
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
    const requestId = options.requestId || generateRequestId();

    const isBrowser = typeof window !== 'undefined';
    const headers: Record<string, string> = {
      'X-OpenOb-Client-Id': this.clientId,
      'X-OpenOb-Request-Id': requestId,
      ...options.headers,
    };

    if (!isBrowser) {
      headers['User-Agent'] = `${this.clientId}/0.1.0`;
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await this.customFetch(targetUrl, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (fetchErr: any) {
      throw new GatewayUnavailableError(this.baseUrl, fetchErr);
    }

    const contentType = res.headers.get('content-type') || '';
    let responseData: any = null;

    if (contentType.includes('application/json')) {
      try {
        responseData = await res.json();
      } catch {
        responseData = null;
      }
    } else {
      const text = await res.text();
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = { message: text };
      }
    }

    if (!res.ok) {
      const status = res.status;
      const code = responseData?.code || responseData?.error?.code || 'GATEWAY_ERROR';
      const message =
        responseData?.message || responseData?.error?.message || `Gateway returned HTTP ${status}`;
      const details = responseData?.details || responseData?.error?.details || responseData;

      throw new GatewayError(status, code, message, details);
    }

    return responseData as T;
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    return this.request<WorkspaceInfo>('/api/v1/workspace');
  }

  async listEntries(subpath?: string): Promise<VaultEntry[]> {
    const query = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
    const res = await this.request<VaultEntry[] | { path: string; entries: VaultEntry[] }>(
      `/api/v1/entries${query}`
    );
    if (Array.isArray(res)) return res;
    if (res && Array.isArray((res as any).entries)) return (res as any).entries;
    return [];
  }

  async readNote(notePath: string): Promise<NoteReadResult> {
    return this.request<NoteReadResult>(`/api/v1/notes/${encodeURIComponent(notePath)}`);
  }

  async search(req: SearchRequestDTO): Promise<SearchResultDTO> {
    const params = new URLSearchParams();
    if (req.query) params.set('q', req.query);
    if (req.tags && req.tags.length > 0) params.set('tags', req.tags.join(','));
    if (req.pathPrefix) params.set('pathPrefix', req.pathPrefix);
    if (req.limit !== undefined) params.set('limit', String(req.limit));
    if (req.offset !== undefined) params.set('offset', String(req.offset));

    const qs = params.toString();
    return this.request<SearchResultDTO>(`/api/v1/search${qs ? `?${qs}` : ''}`);
  }

  async getBacklinks(notePath: string): Promise<BacklinkDTO[]> {
    return this.request<BacklinkDTO[]>(`/api/v1/notes/${encodeURIComponent(notePath)}/backlinks`);
  }

  async getOutgoingLinks(notePath: string): Promise<OutgoingLinkDTO[]> {
    return this.request<OutgoingLinkDTO[]>(`/api/v1/notes/${encodeURIComponent(notePath)}/links`);
  }

  async getGraphNeighbors(notePath: string): Promise<GraphNeighborDTO> {
    return this.request<GraphNeighborDTO>(
      `/api/v1/notes/${encodeURIComponent(notePath)}/graph-neighbors`
    );
  }

  async getProperties(notePath: string): Promise<PropertyMapDTO> {
    return this.request<PropertyMapDTO>(`/api/v1/notes/${encodeURIComponent(notePath)}/properties`);
  }

  async createNote(req: CreateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>('/api/v1/notes', {
      method: 'POST',
      body: req,
    });
  }

  async updateNote(req: UpdateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>(
      `/api/v1/notes/${encodeURIComponent(req.path)}`,
      {
        method: 'PUT',
        body: {
          content: req.content,
          expectedVersion: req.expectedVersion,
        },
      }
    );
  }

  async setProperty(req: SetPropertyRequest): Promise<SingleNoteMutationResultDTO> {
    return this.request<SingleNoteMutationResultDTO>(
      `/api/v1/notes/${encodeURIComponent(req.path)}/properties`,
      {
        method: 'PATCH',
        body: {
          key: req.key,
          value: req.value,
          expectedVersion: req.expectedVersion,
        },
      }
    );
  }

  async renameNote(req: RenameNoteRequest): Promise<RenameResultDTO> {
    return this.request<RenameResultDTO>(
      `/api/v1/notes/${encodeURIComponent(req.oldPath)}/rename`,
      {
        method: 'POST',
        body: {
          newPath: req.newPath,
          expectedVersion: req.expectedVersion,
          updateLinks: req.updateLinks ?? true,
        },
      }
    );
  }

  async deleteNote(req: DeleteNoteRequest): Promise<DeleteResultDTO> {
    return this.request<DeleteResultDTO>(`/api/v1/notes/${encodeURIComponent(req.path)}`, {
      method: 'DELETE',
      body: {
        expectedVersion: req.expectedVersion,
      },
    });
  }
}
