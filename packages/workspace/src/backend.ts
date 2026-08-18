import { VaultEntry } from '@okw/core';
import { OpenObGatewayClient } from './client.js';
import {
  BacklinkDTO,
  CreateNoteRequest,
  CreateSavedViewRequest,
  DeleteNoteRequest,
  DeleteResultDTO,
  DeleteSavedViewRequest,
  DeleteSavedViewResultDTO,
  DiscoverPropertiesResultDTO,
  GraphNeighborDTO,
  NoteReadResult,
  OutgoingLinkDTO,
  PropertyMapDTO,
  PropertyQueryDTO,
  PropertyQueryResultDTO,
  RenameNoteRequest,
  RenameResultDTO,
  RunSavedViewOptions,
  SavedViewDTO,
  SearchRequestDTO,
  SearchResultDTO,
  SetPropertyRequest,
  SingleNoteMutationResultDTO,
  UpdateNoteRequest,
  UpdateSavedViewRequest,
  WorkspaceInfo,
} from './types.js';
import { OpenObWorkspace } from './workspace.js';

/**
 * Unified application-facing workspace backend abstraction.
 * Allows UI clients and harnesses to interact with either a local in-browser workspace
 * or an external authoritative gateway workspace using identical semantics.
 */
export interface WorkspaceBackend {
  readonly mode: 'local' | 'gateway';
  readonly isReadOnly: boolean;
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
  listEntries(subpath?: string): Promise<VaultEntry[]>;
  readNote(path: string): Promise<NoteReadResult>;
  search(req: SearchRequestDTO): Promise<SearchResultDTO>;
  queryNotes(req: PropertyQueryDTO): Promise<PropertyQueryResultDTO>;
  discoverProperties(): Promise<DiscoverPropertiesResultDTO>;
  getBacklinks(path: string): Promise<BacklinkDTO[]>;
  getOutgoingLinks(path: string): Promise<OutgoingLinkDTO[]>;
  getGraphNeighbors(path: string): Promise<GraphNeighborDTO>;
  getProperties(path: string): Promise<PropertyMapDTO>;
  createNote(req: CreateNoteRequest): Promise<SingleNoteMutationResultDTO>;
  updateNote(req: UpdateNoteRequest): Promise<SingleNoteMutationResultDTO>;
  setProperty(req: SetPropertyRequest): Promise<SingleNoteMutationResultDTO>;
  renameNote(req: RenameNoteRequest): Promise<RenameResultDTO>;
  deleteNote(req: DeleteNoteRequest): Promise<DeleteResultDTO>;
  listSavedViews(): Promise<SavedViewDTO[]>;
  getSavedView(id: string): Promise<SavedViewDTO>;
  createSavedView(req: CreateSavedViewRequest): Promise<SavedViewDTO>;
  updateSavedView(id: string, req: UpdateSavedViewRequest): Promise<SavedViewDTO>;
  deleteSavedView(id: string, req: DeleteSavedViewRequest): Promise<DeleteSavedViewResultDTO>;
  runSavedView(id: string, options?: RunSavedViewOptions): Promise<PropertyQueryResultDTO>;
}

/**
 * Local in-process workspace backend wrapping an OpenObWorkspace instance.
 */
export class LocalWorkspaceBackend implements WorkspaceBackend {
  readonly mode = 'local' as const;

  constructor(private readonly workspace: OpenObWorkspace) {}

  get isReadOnly(): boolean {
    return this.workspace.readOnly;
  }

  getWorkspace(): OpenObWorkspace {
    return this.workspace;
  }

  getWorkspaceInfo(): Promise<WorkspaceInfo> {
    return this.workspace.getWorkspaceInfo();
  }

  listEntries(subpath?: string): Promise<VaultEntry[]> {
    return this.workspace.listEntries(subpath);
  }

  readNote(path: string): Promise<NoteReadResult> {
    return this.workspace.readNote(path);
  }

  search(req: SearchRequestDTO): Promise<SearchResultDTO> {
    return this.workspace.search(req);
  }

  queryNotes(req: PropertyQueryDTO): Promise<PropertyQueryResultDTO> {
    return this.workspace.queryNotes(req);
  }

  discoverProperties(): Promise<DiscoverPropertiesResultDTO> {
    return this.workspace.discoverProperties();
  }

  getBacklinks(path: string): Promise<BacklinkDTO[]> {
    return this.workspace.getBacklinks(path);
  }

  getOutgoingLinks(path: string): Promise<OutgoingLinkDTO[]> {
    return this.workspace.getOutgoingLinks(path);
  }

  getGraphNeighbors(path: string): Promise<GraphNeighborDTO> {
    return this.workspace.getGraphNeighbors(path);
  }

  getProperties(path: string): Promise<PropertyMapDTO> {
    return this.workspace.getProperties(path);
  }

  createNote(req: CreateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.workspace.createNote(req);
  }

  updateNote(req: UpdateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.workspace.updateNote(req);
  }

  setProperty(req: SetPropertyRequest): Promise<SingleNoteMutationResultDTO> {
    return this.workspace.setProperty(req);
  }

  renameNote(req: RenameNoteRequest): Promise<RenameResultDTO> {
    return this.workspace.renameNote(req);
  }

  deleteNote(req: DeleteNoteRequest): Promise<DeleteResultDTO> {
    return this.workspace.deleteNote(req);
  }

  listSavedViews(): Promise<SavedViewDTO[]> {
    return this.workspace.listSavedViews();
  }

  getSavedView(id: string): Promise<SavedViewDTO> {
    return this.workspace.getSavedView(id);
  }

  createSavedView(req: CreateSavedViewRequest): Promise<SavedViewDTO> {
    return this.workspace.createSavedView(req);
  }

  updateSavedView(id: string, req: UpdateSavedViewRequest): Promise<SavedViewDTO> {
    return this.workspace.updateSavedView(id, req);
  }

  deleteSavedView(id: string, req: DeleteSavedViewRequest): Promise<DeleteSavedViewResultDTO> {
    return this.workspace.deleteSavedView(id, req);
  }

  runSavedView(id: string, options?: RunSavedViewOptions): Promise<PropertyQueryResultDTO> {
    return this.workspace.runSavedView(id, options);
  }
}

/**
 * Remote gateway workspace backend wrapping an OpenObGatewayClient instance.
 * Strictly communicates via REST API over HTTP loopback. Zero local canonical storage access.
 */
export class GatewayWorkspaceBackend implements WorkspaceBackend {
  readonly mode = 'gateway' as const;
  private _isReadOnly = false;

  constructor(
    private readonly client: OpenObGatewayClient,
    isReadOnly?: boolean
  ) {
    if (isReadOnly !== undefined) {
      this._isReadOnly = isReadOnly;
    }
  }

  get isReadOnly(): boolean {
    return this._isReadOnly;
  }

  getClient(): OpenObGatewayClient {
    return this.client;
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    const info = await this.client.getWorkspaceInfo();
    this._isReadOnly = info.readOnly;
    return info;
  }

  listEntries(subpath?: string): Promise<VaultEntry[]> {
    return this.client.listEntries(subpath);
  }

  readNote(path: string): Promise<NoteReadResult> {
    return this.client.readNote(path);
  }

  search(req: SearchRequestDTO): Promise<SearchResultDTO> {
    return this.client.search(req);
  }

  queryNotes(req: PropertyQueryDTO): Promise<PropertyQueryResultDTO> {
    return this.client.queryNotes(req);
  }

  discoverProperties(): Promise<DiscoverPropertiesResultDTO> {
    return this.client.discoverProperties();
  }

  getBacklinks(path: string): Promise<BacklinkDTO[]> {
    return this.client.getBacklinks(path);
  }

  getOutgoingLinks(path: string): Promise<OutgoingLinkDTO[]> {
    return this.client.getOutgoingLinks(path);
  }

  getGraphNeighbors(path: string): Promise<GraphNeighborDTO> {
    return this.client.getGraphNeighbors(path);
  }

  getProperties(path: string): Promise<PropertyMapDTO> {
    return this.client.getProperties(path);
  }

  createNote(req: CreateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.client.createNote(req);
  }

  updateNote(req: UpdateNoteRequest): Promise<SingleNoteMutationResultDTO> {
    return this.client.updateNote(req);
  }

  setProperty(req: SetPropertyRequest): Promise<SingleNoteMutationResultDTO> {
    return this.client.setProperty(req);
  }

  renameNote(req: RenameNoteRequest): Promise<RenameResultDTO> {
    return this.client.renameNote(req);
  }

  deleteNote(req: DeleteNoteRequest): Promise<DeleteResultDTO> {
    return this.client.deleteNote(req);
  }

  listSavedViews(): Promise<SavedViewDTO[]> {
    return this.client.listSavedViews();
  }

  getSavedView(id: string): Promise<SavedViewDTO> {
    return this.client.getSavedView(id);
  }

  createSavedView(req: CreateSavedViewRequest): Promise<SavedViewDTO> {
    return this.client.createSavedView(req);
  }

  updateSavedView(id: string, req: UpdateSavedViewRequest): Promise<SavedViewDTO> {
    return this.client.updateSavedView(id, req);
  }

  deleteSavedView(id: string, req: DeleteSavedViewRequest): Promise<DeleteSavedViewResultDTO> {
    return this.client.deleteSavedView(id, req);
  }

  runSavedView(id: string, options?: RunSavedViewOptions): Promise<PropertyQueryResultDTO> {
    return this.client.runSavedView(id, options);
  }
}
