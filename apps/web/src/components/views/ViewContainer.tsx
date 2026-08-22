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

      if (activeSavedViewId) {
        const found = views.find((v) => v.view.id === activeSavedViewId);
        if (!found) {
          setIsDeletedRemotely(true);
        } else if (activeSavedViewVersion && found.version.token !== activeSavedViewVersion.token) {
          setActiveSavedViewVersion(found.version);
        }
      }
    } catch (err: any) {
      console.error('Failed to list saved views:', err);
    }
  }, [backend, activeSavedViewId, activeSavedViewVersion]);

  // Discover properties & load saved views
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--surface-canvas)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Degraded Index Warning Banner */}
      {queryResult.indexStatus === 'degraded' && (
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
            padding: '6px 16px',
            color: 'var(--status-warning)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>Derived index is currently degraded. Query results may be partial or stale.</span>
        </div>
      )}

      {/* External Deletion Notification Banner */}
      {isDeletedRemotely && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            padding: '6px 16px',
            color: 'var(--status-danger)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
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
            className="btn btn-primary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
          >
            Save As New
          </button>
        </div>
      )}

      {/* Conflict Warning Banner */}
      {conflictError && (
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
            padding: '6px 16px',
            color: 'var(--status-warning)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{conflictError}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={async () => {
                await fetchSavedViews();
                if (activeSavedViewId) {
                  const remote = savedViews.find((v) => v.view.id === activeSavedViewId);
                  if (remote) handleLoadSavedView(remote);
                }
              }}
              className="btn"
              style={{ padding: '2px 8px', fontSize: '11px' }}
            >
              Reload Remote
            </button>
            <button
              onClick={() => {
                setModalViewName(`${activeSavedViewName} (Copy)`);
                setSaveAsNewMode(true);
                setShowSaveModal(true);
              }}
              className="btn btn-primary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
            >
              Save As New
            </button>
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          padding: '8px 14px',
          backgroundColor: 'var(--surface-sidebar)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        {/* Left: Saved Views Picker & View Type Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Saved Views Dropdown */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--surface-canvas)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '3px 8px',
              fontSize: '12px',
            }}
          >
            <Bookmark size={13} style={{ color: 'var(--accent-primary)' }} />
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
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
                maxWidth: '140px',
              }}
            >
              <option value="" style={{ backgroundColor: 'var(--surface-elevated)' }}>
                {activeSavedViewId ? 'Ephemeral View' : 'Select Saved View...'}
              </option>
              {savedViews.map((sv) => (
                <option
                  key={sv.view.id}
                  value={sv.view.id}
                  style={{ backgroundColor: 'var(--surface-elevated)' }}
                >
                  {sv.view.name} ({sv.view.type})
                </option>
              ))}
            </select>
          </div>

          {/* View Type Switcher (Table / List / Board) */}
          <div className="view-mode-group">
            <button
              onClick={() => setViewType('table')}
              className={`view-mode-btn ${viewType === 'table' ? 'active' : ''}`}
              title="Table View"
            >
              <TableIcon size={13} />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`view-mode-btn ${viewType === 'list' ? 'active' : ''}`}
              title="List View"
            >
              <ListIcon size={13} />
              <span>List</span>
            </button>
            <button
              onClick={() => setViewType('board')}
              className={`view-mode-btn ${viewType === 'board' ? 'active' : ''}`}
              title="Board View"
            >
              <BoardIcon size={13} />
              <span>Board</span>
            </button>
          </div>

          {/* Group By selector (only in Board mode) */}
          {viewType === 'board' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '3px 8px',
                fontSize: '12px',
              }}
            >
              <Layers size={13} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Group by:</span>
              <input
                type="text"
                list="board-groupby-props"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                placeholder="status..."
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  width: '70px',
                  outline: 'none',
                }}
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: 'var(--surface-canvas)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '3px 8px',
              fontSize: '12px',
            }}
          >
            <Folder size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Scope folder..."
              value={folderScope}
              onChange={(e) => {
                setFolderScope(e.target.value);
                setPage(0);
              }}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '12px',
                width: '110px',
                outline: 'none',
              }}
            />
            {folderScope && (
              <button
                onClick={() => {
                  setFolderScope('');
                  setPage(0);
                }}
                className="btn-icon"
                style={{ width: '16px', height: '16px' }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Right: Actions, Filters, Columns, and Save buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Columns Selector */}
          {viewType !== 'list' && (
            <button
              onClick={() => setShowColumnModal(true)}
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              <Columns size={13} style={{ color: 'var(--accent-primary)' }} />
              <span>Columns ({selectedColumns.length})</span>
            </button>
          )}

          {/* Filter Button */}
          <button
            onClick={() => setShowFilterModal(true)}
            className={`btn ${filters.length > 0 ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '12px', padding: '4px 8px' }}
          >
            <Filter size={13} />
            <span>Filter {filters.length > 0 && `(${filters.length})`}</span>
          </button>

          {/* Saved View Operations Buttons */}
          {activeSavedViewId && !isDeletedRemotely ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                backgroundColor: 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '2px',
              }}
            >
              <button
                onClick={handleQuickUpdate}
                title="Update Saved View"
                className="btn btn-ghost"
                style={{ padding: '2px 6px', fontSize: '11px', color: 'var(--accent-primary)' }}
              >
                <Save size={11} />
                <span>Save</span>
              </button>
              <button
                onClick={() => {
                  setModalViewName(activeSavedViewName);
                  setShowRenameModal(true);
                }}
                title="Rename Saved View"
                className="btn-icon"
                style={{ width: '20px', height: '20px' }}
              >
                <Edit2 size={11} />
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                title="Delete Saved View"
                className="btn-icon"
                style={{ width: '20px', height: '20px', color: 'var(--status-danger)' }}
              >
                <Trash2 size={11} />
              </button>
              <button
                onClick={() => {
                  setModalViewName(`${activeSavedViewName} (Copy)`);
                  setSaveAsNewMode(true);
                  setShowSaveModal(true);
                }}
                className="btn btn-ghost"
                style={{ padding: '2px 6px', fontSize: '10px' }}
              >
                Copy
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setModalViewName('');
                setSaveAsNewMode(false);
                setShowSaveModal(true);
              }}
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '4px 10px' }}
            >
              <Bookmark size={12} />
              <span>Save View</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Filters Pill Bar */}
      {filters.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            backgroundColor: 'var(--surface-sidebar)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '11px',
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>Filters:</span>
          {filters.map((f, idx) => (
            <span
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{f.field}</span>
              <span style={{ color: 'var(--text-muted)' }}>{f.operator}</span>
              {f.value !== undefined && (
                <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                  {String(f.value)}
                </span>
              )}
              <button
                onClick={() => handleRemoveFilter(idx)}
                className="btn-icon"
                style={{ width: '14px', height: '14px' }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            onClick={() => {
              setFilters([]);
              setPage(0);
            }}
            className="btn-ghost"
            style={{ fontSize: '11px', textDecoration: 'underline', padding: '0 4px' }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            padding: '6px 16px',
            color: 'var(--status-danger)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>Error: {error}</span>
        </div>
      )}

      {/* Main View Area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(13, 15, 18, 0.5)',
              backdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--accent-primary)', fontWeight: 500 }}>
              Running query...
            </span>
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

      {/* Bottom Pagination Bar */}
      {viewType !== 'board' && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            padding: '6px 14px',
            backgroundColor: 'var(--surface-sidebar)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            Showing {startRow}-{endRow} of {queryResult.total} notes
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn"
              style={{ padding: '2px 4px', height: '22px' }}
              title="Previous page"
            >
              <ChevronLeft size={13} />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="btn"
              style={{ padding: '2px 4px', height: '22px' }}
              title="Next page"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilterModal && (
        <div className="modal-overlay" onClick={() => setShowFilterModal(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px' }}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Filter size={15} style={{ color: 'var(--accent-primary)' }} />
                <span>Add Property Filter</span>
              </div>
              <button className="btn-icon" onClick={() => setShowFilterModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleAddFilter}>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                    }}
                  >
                    Property Field
                  </label>
                  <input
                    type="text"
                    list="available-properties"
                    value={newFilterField}
                    onChange={(e) => setNewFilterField(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-canvas)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
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
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                    }}
                  >
                    Operator
                  </label>
                  <select
                    value={newFilterOp}
                    onChange={(e) => setNewFilterOp(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-canvas)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
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
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginBottom: '4px',
                      }}
                    >
                      Target Value
                    </label>
                    <input
                      type="text"
                      value={newFilterVal}
                      onChange={(e) => setNewFilterVal(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-canvas)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                      placeholder="Value to match..."
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Filter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Columns Modal */}
      {showColumnModal && (
        <div className="modal-overlay" onClick={() => setShowColumnModal(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px' }}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Columns size={15} style={{ color: 'var(--accent-primary)' }} />
                <span>Select Visible Columns</span>
              </div>
              <button className="btn-icon" onClick={() => setShowColumnModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div
              className="modal-body"
              style={{
                maxHeight: '240px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {availableProps.map((prop) => {
                const isSelected = selectedColumns.includes(prop);
                return (
                  <label
                    key={prop}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isSelected ? 'var(--surface-selected)' : 'transparent',
                      cursor: 'pointer',
                    }}
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
                      style={{ accentColor: 'var(--accent-primary)' }}
                    />
                    <span style={{ textTransform: 'capitalize', color: 'var(--text-primary)' }}>
                      {prop}
                    </span>
                  </label>
                );
              })}
              {availableProps.length === 0 && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '16px 0',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                  }}
                >
                  No frontmatter properties discovered yet in vault
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowColumnModal(false)} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save View Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px' }}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Bookmark size={15} style={{ color: 'var(--accent-primary)' }} />
                <span>{saveAsNewMode ? 'Save As New View' : 'Save View'}</span>
              </div>
              <button className="btn-icon" onClick={() => setShowSaveModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSaveViewSubmit}>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                    }}
                  >
                    View Name
                  </label>
                  <input
                    type="text"
                    value={modalViewName}
                    onChange={(e) => setModalViewName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-canvas)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                    placeholder="e.g. Active Tasks, High Priority..."
                    required
                    autoFocus
                  />
                </div>

                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--surface-canvas)',
                    padding: '8px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div>
                    Type:{' '}
                    <span
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {viewType}
                    </span>
                  </div>
                  {viewType === 'board' && (
                    <div>
                      Group by:{' '}
                      <span
                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}
                      >
                        {groupBy}
                      </span>
                    </div>
                  )}
                  <div>
                    Filters:{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {filters.length} active
                    </span>
                  </div>
                  <div>
                    Sorts:{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {sorts.map((s) => `${s.field}:${s.direction}`).join(', ')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save View
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="modal-overlay" onClick={() => setShowRenameModal(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px' }}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Edit2 size={15} style={{ color: 'var(--accent-primary)' }} />
                <span>Rename Saved View</span>
              </div>
              <button className="btn-icon" onClick={() => setShowRenameModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSaveViewSubmit}>
              <div className="modal-body">
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginBottom: '4px',
                  }}
                >
                  New View Name
                </label>
                <input
                  type="text"
                  value={modalViewName}
                  onChange={(e) => setModalViewName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--surface-canvas)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                  required
                  autoFocus
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px' }}
          >
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--status-danger)' }}>
                <Trash2 size={15} />
                <span>Delete Saved View</span>
              </div>
              <button className="btn-icon" onClick={() => setShowDeleteModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Are you sure you want to delete the saved view{' '}
                <strong style={{ color: 'var(--text-primary)' }}>"{activeSavedViewName}"</strong>?
                This removes the configuration from{' '}
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  .openob/views/
                </code>{' '}
                without affecting notes.
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="button" onClick={handleDeleteView} className="btn btn-danger">
                Delete View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
