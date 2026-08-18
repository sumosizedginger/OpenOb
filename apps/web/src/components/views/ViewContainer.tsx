import React, { useState, useEffect, useCallback } from 'react';
import { PropertyFilter, PropertySort, VaultPath, ViewType } from '@okw/core';
import {
  ExpectedVersionDTO,
  PropertyQueryDTO,
  PropertyQueryResultDTO,
  SavedViewDTO,
  WorkspaceBackend,
} from '@okw/workspace';
import { TableView } from './TableView.js';
import { ListView } from './ListView.js';
import { BoardView } from './BoardView.js';
import {
  Table as TableIcon,
  List as ListIcon,
  Kanban as BoardIcon,
  Filter,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Folder,
  Columns,
  Bookmark,
  Save,
  Trash2,
  Edit2,
  Layers,
} from 'lucide-react';

interface ViewContainerProps {
  backend: WorkspaceBackend;
  refreshKey?: any;
  onNavigate: (path: VaultPath) => void;
}

const PAGE_SIZE = 50;
const BOARD_PAGE_SIZE = 500;

export const ViewContainer: React.FC<ViewContainerProps> = ({
  backend,
  refreshKey,
  onNavigate,
}) => {
  const [viewType, setViewType] = useState<ViewType>('table');
  const [folderScope, setFolderScope] = useState<string>('');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [sorts, setSorts] = useState<PropertySort[]>([{ field: 'title', direction: 'asc' }]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<string>('status');
  const [availableProps, setAvailableProps] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // Saved views state
  const [savedViews, setSavedViews] = useState<SavedViewDTO[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);
  const [activeSavedViewVersion, setActiveSavedViewVersion] = useState<ExpectedVersionDTO | null>(
    null
  );
  const [activeSavedViewName, setActiveSavedViewName] = useState<string>('');
  const [isDeletedRemotely, setIsDeletedRemotely] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Modals state
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [modalViewName, setModalViewName] = useState('');
  const [saveAsNewMode, setSaveAsNewMode] = useState(false);

  // Filter creation form state
  const [newFilterField, setNewFilterField] = useState('status');
  const [newFilterOp, setNewFilterOp] = useState<PropertyFilter['operator']>('equals');
  const [newFilterVal, setNewFilterVal] = useState('');

  // Query results
  const [queryResult, setQueryResult] = useState<PropertyQueryResultDTO>({
    total: 0,
    rows: [],
    limit: PAGE_SIZE,
    offset: 0,
    indexStatus: 'verified',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch saved views from backend
  const fetchSavedViews = useCallback(async () => {
    try {
      const views = await backend.listSavedViews();
      setSavedViews(views);

      // Check if current active view was remotely updated or deleted
      if (activeSavedViewId) {
        const found = views.find((v) => v.view.id === activeSavedViewId);
        if (!found) {
          setIsDeletedRemotely(true);
        } else if (activeSavedViewVersion && found.version.token !== activeSavedViewVersion.token) {
          // View updated remotely
          setActiveSavedViewVersion(found.version);
        }
      }
    } catch (err: any) {
      console.error('Failed to list saved views:', err);
    }
  }, [backend, activeSavedViewId, activeSavedViewVersion]);

  // Discover properties & load saved views on mount / refreshKey
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        const [propsRes, viewsRes] = await Promise.all([
          backend.discoverProperties().catch(() => ({ properties: [] })),
          backend.listSavedViews().catch(() => []),
        ]);
        if (isMounted) {
          setAvailableProps(propsRes.properties);
          setSavedViews(viewsRes);
          setSelectedColumns(propsRes.properties);
        }
      } catch (err: any) {
        console.error('ViewContainer init error:', err);
      }
    };
    void init();
    return () => {
      isMounted = false;
    };
  }, [backend, refreshKey]);

  // Execute query
  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const effectiveLimit = viewType === 'board' ? BOARD_PAGE_SIZE : PAGE_SIZE;
      const effectiveOffset = viewType === 'board' ? 0 : page * PAGE_SIZE;

      const queryDto: PropertyQueryDTO = {
        folderScope: folderScope.trim() || undefined,
        filters: filters.length > 0 ? filters : undefined,
        sorts: sorts.length > 0 ? sorts : undefined,
        columns: selectedColumns.length > 0 ? selectedColumns : undefined,
        limit: effectiveLimit,
        offset: effectiveOffset,
      };
      const res = await backend.queryNotes(queryDto);
      setQueryResult(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [backend, viewType, folderScope, filters, sorts, selectedColumns, page]);

  useEffect(() => {
    void runQuery();
  }, [runQuery, groupBy, refreshKey]);

  // Load a saved view into the builder
  const handleLoadSavedView = (savedViewDto: SavedViewDTO) => {
    const v = savedViewDto.view;
    setActiveSavedViewId(v.id);
    setActiveSavedViewVersion(savedViewDto.version);
    setActiveSavedViewName(v.name);
    setViewType(v.type);
    setFolderScope(v.folderScope || '');
    setFilters(v.filters ? [...v.filters] : []);
    setSorts(v.sorts && v.sorts.length > 0 ? [...v.sorts] : [{ field: 'title', direction: 'asc' }]);
    if (v.visibleProperties && v.visibleProperties.length > 0) {
      setSelectedColumns([...v.visibleProperties]);
    }
    if (v.groupBy) {
      setGroupBy(v.groupBy);
    }
    setIsDeletedRemotely(false);
    setConflictError(null);
    setPage(0);
  };

  // Reset to ephemeral view
  const handleResetToEphemeral = () => {
    setActiveSavedViewId(null);
    setActiveSavedViewVersion(null);
    setActiveSavedViewName('');
    setIsDeletedRemotely(false);
    setConflictError(null);
  };

  // Handle Save (create or update)
  const handleSaveViewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalViewName.trim()) return;

    setError(null);
    setConflictError(null);

    try {
      if (activeSavedViewId && !saveAsNewMode) {
        if (!activeSavedViewVersion) {
          throw new Error('Missing expected version for saved view update');
        }
        const updated = await backend.updateSavedView(activeSavedViewId, {
          name: modalViewName.trim(),
          type: viewType,
          filters: filters.length > 0 ? filters : undefined,
          sorts: sorts.length > 0 ? sorts : undefined,
          groupBy: viewType === 'board' ? groupBy : undefined,
          visibleProperties: selectedColumns.length > 0 ? selectedColumns : undefined,
          folderScope: folderScope.trim() || undefined,
          expectedVersion: activeSavedViewVersion,
        });
        setActiveSavedViewVersion(updated.version);
        setActiveSavedViewName(updated.view.name);
        await fetchSavedViews();
        setShowSaveModal(false);
        setShowRenameModal(false);
      } else {
        const created = await backend.createSavedView({
          name: modalViewName.trim(),
          type: viewType,
          filters: filters.length > 0 ? filters : undefined,
          sorts: sorts.length > 0 ? sorts : undefined,
          groupBy: viewType === 'board' ? groupBy : undefined,
          visibleProperties: selectedColumns.length > 0 ? selectedColumns : undefined,
          folderScope: folderScope.trim() || undefined,
        });
        setActiveSavedViewId(created.view.id);
        setActiveSavedViewVersion(created.version);
        setActiveSavedViewName(created.view.name);
        setIsDeletedRemotely(false);
        await fetchSavedViews();
        setShowSaveModal(false);
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'CONFLICT' || String(err).includes('Conflict')) {
        setConflictError(
          'Conflict: This saved view was modified or deleted remotely. Your current configuration is preserved. Choose "Save As New" or reload remote view.'
        );
        setShowSaveModal(false);
        setShowRenameModal(false);
      } else {
        setError(err?.message || String(err));
      }
    }
  };

  // Handle direct Quick Update
  const handleQuickUpdate = async () => {
    if (!activeSavedViewId || !activeSavedViewVersion) return;
    setError(null);
    setConflictError(null);
    try {
      const updated = await backend.updateSavedView(activeSavedViewId, {
        name: activeSavedViewName,
        type: viewType,
        filters: filters.length > 0 ? filters : undefined,
        sorts: sorts.length > 0 ? sorts : undefined,
        groupBy: viewType === 'board' ? groupBy : undefined,
        visibleProperties: selectedColumns.length > 0 ? selectedColumns : undefined,
        folderScope: folderScope.trim() || undefined,
        expectedVersion: activeSavedViewVersion,
      });
      setActiveSavedViewVersion(updated.version);
      await fetchSavedViews();
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'CONFLICT' || String(err).includes('Conflict')) {
        setConflictError(
          'Conflict: This saved view was modified or deleted remotely. Your working configuration is preserved. Choose "Save As New" or reload remote view.'
        );
      } else {
        setError(err?.message || String(err));
      }
    }
  };

  // Handle Delete View
  const handleDeleteView = async () => {
    if (!activeSavedViewId || !activeSavedViewVersion) return;
    setError(null);
    setConflictError(null);
    try {
      await backend.deleteSavedView(activeSavedViewId, {
        expectedVersion: activeSavedViewVersion,
      });
      setShowDeleteModal(false);
      handleResetToEphemeral();
      await fetchSavedViews();
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'CONFLICT' || String(err).includes('Conflict')) {
        setConflictError(
          'Conflict: Unable to delete because the saved view was modified remotely.'
        );
        setShowDeleteModal(false);
      } else {
        setError(err?.message || String(err));
      }
    }
  };

  // Handle adding a filter
  const handleAddFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilterField.trim()) return;

    let parsedVal: any = newFilterVal;
    if (newFilterOp === 'is_empty' || newFilterOp === 'is_not_empty') {
      parsedVal = undefined;
    } else if (newFilterVal === 'true') {
      parsedVal = true;
    } else if (newFilterVal === 'false') {
      parsedVal = false;
    } else if (newFilterVal !== '' && !isNaN(Number(newFilterVal))) {
      parsedVal = Number(newFilterVal);
    }

    setFilters((prev) => [
      ...prev,
      {
        field: newFilterField.trim(),
        operator: newFilterOp,
        value: parsedVal,
      },
    ]);
    setPage(0);
    setNewFilterVal('');
    setShowFilterModal(false);
  };

  const handleRemoveFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setPage(0);
  };

  // Handle sort toggling
  const handleSortChange = (field: string) => {
    setSorts((prev) => {
      const existing = prev.find((s) => s.field === field);
      if (existing) {
        const nextDir = existing.direction === 'asc' ? 'desc' : 'asc';
        return [{ field, direction: nextDir }];
      }
      return [{ field, direction: 'asc' }];
    });
    setPage(0);
  };

  const canEdit = !backend.isReadOnly;

  const handleSetProperty = useCallback(
    async (path: string, key: string, value: any, expectedVersion: ExpectedVersionDTO) => {
      if (backend.isReadOnly) {
        throw new Error('Workspace is read-only');
      }
      const res = await backend.setProperty({
        path,
        key,
        value,
        expectedVersion,
      });

      if (res.indexStatus === 'degraded') {
        console.warn(`Saved property "${key}" to "${path}", but index status is degraded.`);
      }

      await runQuery();
    },
    [backend, runQuery]
  );

  const primarySort = sorts[0];
  const totalPages = Math.ceil(queryResult.total / PAGE_SIZE) || 1;
  const startRow = queryResult.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endRow = Math.min((page + 1) * PAGE_SIZE, queryResult.total);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Degraded Index Warning Banner */}
      {queryResult.indexStatus === 'degraded' && (
        <div className="bg-amber-950/80 border-b border-amber-800/80 px-4 py-2 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Derived index is currently degraded. Query results may be partial or stale.</span>
        </div>
      )}

      {/* External Deletion Notification Banner */}
      {isDeletedRemotely && (
        <div className="bg-red-950/80 border-b border-red-800/80 px-4 py-2 text-red-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              This saved view ("{activeSavedViewName}") was deleted externally. Your current query
              is preserved.
            </span>
          </div>
          <button
            onClick={() => {
              setModalViewName(`${activeSavedViewName} (Copy)`);
              setSaveAsNewMode(true);
              setShowSaveModal(true);
            }}
            className="px-2.5 py-1 bg-red-900/80 hover:bg-red-800 border border-red-700 text-white rounded text-xs"
          >
            Save As New
          </button>
        </div>
      )}

      {/* Conflict Warning Banner */}
      {conflictError && (
        <div className="bg-amber-950/80 border-b border-amber-800/80 px-4 py-2 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{conflictError}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await fetchSavedViews();
                if (activeSavedViewId) {
                  const remote = savedViews.find((v) => v.view.id === activeSavedViewId);
                  if (remote) handleLoadSavedView(remote);
                }
              }}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
            >
              Reload Remote
            </button>
            <button
              onClick={() => {
                setModalViewName(`${activeSavedViewName} (Copy)`);
                setSaveAsNewMode(true);
                setShowSaveModal(true);
              }}
              className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium"
            >
              Save As New
            </button>
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="border-b border-slate-800/80 p-3 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Saved Views Picker & View Type Switcher */}
        <div className="flex items-center gap-2">
          {/* Saved Views Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
            <Bookmark className="w-3.5 h-3.5 text-sky-400" />
            <select
              value={activeSavedViewId || ''}
              onChange={(e) => {
                const selId = e.target.value;
                if (!selId) {
                  handleResetToEphemeral();
                } else {
                  const found = savedViews.find((v) => v.view.id === selId);
                  if (found) handleLoadSavedView(found);
                }
              }}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="" className="bg-slate-900 text-slate-400">
                {activeSavedViewId ? 'Ephemeral View' : 'Select Saved View...'}
              </option>
              {savedViews.map((sv) => (
                <option key={sv.view.id} value={sv.view.id} className="bg-slate-900 text-slate-200">
                  {sv.view.name} ({sv.view.type})
                </option>
              ))}
            </select>
          </div>

          {/* View Type Switcher (Table / List / Board) */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewType('table')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewType === 'table'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Table View"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewType === 'list'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="List View"
            >
              <ListIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button
              onClick={() => setViewType('board')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewType === 'board'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Board View"
            >
              <BoardIcon className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>
          </div>

          {/* Group By selector (only in Board mode) */}
          {viewType === 'board' && (
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-500 text-[11px]">Group by:</span>
              <input
                type="text"
                list="board-groupby-props"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                placeholder="status..."
                className="bg-transparent text-xs text-slate-200 placeholder-slate-500 focus:outline-none w-20"
              />
              <datalist id="board-groupby-props">
                <option value="status" />
                <option value="priority" />
                <option value="type" />
                <option value="category" />
                {availableProps.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          )}

          {/* Folder Scope Input */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300">
            <Folder className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Scope folder..."
              value={folderScope}
              onChange={(e) => {
                setFolderScope(e.target.value);
                setPage(0);
              }}
              className="bg-transparent text-xs text-slate-200 placeholder-slate-500 focus:outline-none w-28 sm:w-36"
            />
            {folderScope && (
              <button
                onClick={() => {
                  setFolderScope('');
                  setPage(0);
                }}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Actions, Filters, Columns, and Save buttons */}
        <div className="flex items-center gap-2">
          {/* Columns Selector (Table & Board) */}
          {viewType !== 'list' && (
            <button
              onClick={() => setShowColumnModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <Columns className="w-3.5 h-3.5 text-sky-400" />
              <span>Columns ({selectedColumns.length})</span>
            </button>
          )}

          {/* Filter Button */}
          <button
            onClick={() => setShowFilterModal(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              filters.length > 0
                ? 'bg-sky-950/60 border-sky-600/80 text-sky-300'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
            }`}
          >
            <Filter className="w-3.5 h-3.5 text-sky-400" />
            <span>Filter {filters.length > 0 && `(${filters.length})`}</span>
          </button>

          {/* Saved View Operations Buttons */}
          {activeSavedViewId && !isDeletedRemotely ? (
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <button
                onClick={handleQuickUpdate}
                title="Update Saved View"
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-sky-400 hover:text-sky-300 hover:bg-slate-800 rounded"
              >
                <Save className="w-3 h-3" />
                <span>Save</span>
              </button>
              <button
                onClick={() => {
                  setModalViewName(activeSavedViewName);
                  setShowRenameModal(true);
                }}
                title="Rename Saved View"
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                title="Delete Saved View"
                className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setModalViewName(`${activeSavedViewName} (Copy)`);
                  setSaveAsNewMode(true);
                  setShowSaveModal(true);
                }}
                title="Save As New View"
                className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded border-l border-slate-800"
              >
                Save As New
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setModalViewName('');
                setSaveAsNewMode(false);
                setShowSaveModal(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg shadow-sm transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Save View</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Filters Pill Bar */}
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-slate-900/20 border-b border-slate-800/60 text-xs">
          <span className="text-slate-500 text-[11px]">Filters:</span>
          {filters.map((f, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 text-xs"
            >
              <span className="font-semibold text-slate-200">{f.field}</span>
              <span className="text-slate-400 text-[11px]">{f.operator}</span>
              {f.value !== undefined && (
                <span className="text-sky-300 font-mono text-[11px]">{String(f.value)}</span>
              )}
              <button
                onClick={() => handleRemoveFilter(idx)}
                className="hover:text-red-400 transition-colors ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => {
              setFilters([]);
              setPage(0);
            }}
            className="text-[11px] text-slate-500 hover:text-slate-300 underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-950/80 border-b border-red-800/80 px-4 py-2 text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>Error: {error}</span>
        </div>
      )}

      {/* Main View Area */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center z-20">
            <span className="text-xs text-sky-400 font-medium animate-pulse">Running query...</span>
          </div>
        )}

        {viewType === 'table' ? (
          <TableView
            rows={queryResult.rows}
            columns={
              selectedColumns.length > 0
                ? selectedColumns
                : availableProps.length > 0
                  ? availableProps
                  : Array.from(
                      new Set(
                        queryResult.rows.flatMap((r) =>
                          Object.keys(r.properties || {}).filter(
                            (k) => k !== 'tags' && k !== 'tag' && k !== 'title'
                          )
                        )
                      )
                    )
            }
            sortField={primarySort?.field}
            sortDirection={primarySort?.direction}
            canEdit={canEdit}
            onSortChange={handleSortChange}
            onNavigate={onNavigate}
            onSetProperty={handleSetProperty}
          />
        ) : viewType === 'list' ? (
          <ListView rows={queryResult.rows} onNavigate={onNavigate} />
        ) : (
          <BoardView
            rows={queryResult.rows}
            groupBy={groupBy}
            visibleProperties={selectedColumns}
            total={queryResult.total}
            canEdit={canEdit}
            onNavigate={onNavigate}
            onSetProperty={handleSetProperty}
          />
        )}
      </div>

      {/* Bottom Pagination Bar (Only for Table and List) */}
      {viewType !== 'board' && (
        <div className="border-t border-slate-800/80 px-4 py-2 bg-slate-900/40 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing {startRow}-{endRow} of {queryResult.total} notes
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Filter className="w-4 h-4 text-sky-400" />
                Add Filter
              </h3>
              <button
                onClick={() => setShowFilterModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddFilter} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Property Field</label>
                <input
                  type="text"
                  list="available-properties"
                  value={newFilterField}
                  onChange={(e) => setNewFilterField(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                  placeholder="e.g. status, priority, title..."
                  required
                />
                <datalist id="available-properties">
                  <option value="title" />
                  <option value="path" />
                  <option value="tags" />
                  {availableProps.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Operator</label>
                <select
                  value={newFilterOp}
                  onChange={(e) => setNewFilterOp(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="equals">equals</option>
                  <option value="not_equals">not equals</option>
                  <option value="contains">contains</option>
                  <option value="not_contains">not contains</option>
                  <option value="greater_than">greater than (&gt;)</option>
                  <option value="less_than">less than (&lt;)</option>
                  <option value="is_empty">is empty</option>
                  <option value="is_not_empty">is not empty</option>
                </select>
              </div>

              {newFilterOp !== 'is_empty' && newFilterOp !== 'is_not_empty' && (
                <div>
                  <label className="block text-slate-400 mb-1">Target Value</label>
                  <input
                    type="text"
                    value={newFilterVal}
                    onChange={(e) => setNewFilterVal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                    placeholder="Value to match..."
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm"
                >
                  Add Filter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Columns Modal */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Columns className="w-4 h-4 text-sky-400" />
                Select Visible Columns
              </h3>
              <button
                onClick={() => setShowColumnModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto mb-4 text-xs">
              {availableProps.map((prop) => {
                const isSelected = selectedColumns.includes(prop);
                return (
                  <label
                    key={prop}
                    className="flex items-center gap-2 p-1.5 hover:bg-slate-800 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedColumns((prev) => [...prev, prop]);
                        } else {
                          setSelectedColumns((prev) => prev.filter((p) => p !== prop));
                        }
                      }}
                      className="rounded border-slate-700 bg-slate-950 text-sky-500"
                    />
                    <span className="capitalize text-slate-200">{prop}</span>
                  </label>
                );
              })}
              {availableProps.length === 0 && (
                <div className="text-slate-500 py-4 text-center italic">
                  No frontmatter properties discovered yet in vault
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowColumnModal(false)}
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save View Modal (Create / Save As New) */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-sky-400" />
                {saveAsNewMode ? 'Save As New View' : 'Save View'}
              </h3>
              <button
                onClick={() => setShowSaveModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveViewSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">View Name</label>
                <input
                  type="text"
                  value={modalViewName}
                  onChange={(e) => setModalViewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                  placeholder="e.g. Active Tasks, High Priority..."
                  required
                  autoFocus
                />
              </div>

              <div className="text-slate-400 text-[11px] bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 space-y-1">
                <div>
                  Type: <span className="font-semibold text-slate-200 capitalize">{viewType}</span>
                </div>
                {viewType === 'board' && (
                  <div>
                    Group by: <span className="font-mono text-sky-300">{groupBy}</span>
                  </div>
                )}
                <div>
                  Filters: <span className="font-mono text-slate-200">{filters.length} active</span>
                </div>
                <div>
                  Sorts:{' '}
                  <span className="font-mono text-slate-200">
                    {sorts.map((s) => `${s.field}:${s.direction}`).join(', ')}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm"
                >
                  Save View
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-sky-400" />
                Rename Saved View
              </h3>
              <button
                onClick={() => setShowRenameModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveViewSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">New View Name</label>
                <input
                  type="text"
                  value={modalViewName}
                  onChange={(e) => setModalViewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                  required
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm"
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm shadow-2xl text-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Delete Saved View
              </h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Are you sure you want to delete the saved view{' '}
              <strong className="text-white">"{activeSavedViewName}"</strong>? This removes the view
              configuration from <code className="font-mono text-slate-400">.openob/views/</code>{' '}
              without affecting your Markdown notes.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteView}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs shadow-sm"
              >
                Delete View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
