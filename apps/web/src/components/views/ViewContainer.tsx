import React, { useState, useEffect, useCallback } from 'react';
import { PropertyFilter, PropertySort, VaultPath } from '@okw/core';
import { PropertyQueryDTO, PropertyQueryResultDTO, WorkspaceBackend } from '@okw/workspace';
import { TableView } from './TableView.js';
import { ListView } from './ListView.js';
import {
  Table as TableIcon,
  List as ListIcon,
  Filter,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Folder,
  Columns,
} from 'lucide-react';

interface ViewContainerProps {
  backend: WorkspaceBackend;
  refreshKey?: any;
  onNavigate: (path: VaultPath) => void;
}

const PAGE_SIZE = 50;

export const ViewContainer: React.FC<ViewContainerProps> = ({
  backend,
  refreshKey,
  onNavigate,
}) => {
  const [viewType, setViewType] = useState<'table' | 'list'>('table');
  const [folderScope, setFolderScope] = useState<string>('');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [sorts, setSorts] = useState<PropertySort[]>([{ field: 'title', direction: 'asc' }]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [availableProps, setAvailableProps] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // Filter creation modal state
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showColumnModal, setShowColumnModal] = useState(false);
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

  // Discover properties on mount / refreshKey
  useEffect(() => {
    let isMounted = true;
    const fetchProps = async () => {
      try {
        const res = await backend.discoverProperties();
        if (isMounted) {
          setAvailableProps(res.properties);
          // Default columns if not yet set
          if (selectedColumns.length === 0 && res.properties.length > 0) {
            setSelectedColumns(res.properties.slice(0, 4));
          }
        }
      } catch (err: any) {
        console.error('Failed to discover properties:', err);
      }
    };
    void fetchProps();
    return () => {
      isMounted = false;
    };
  }, [backend, refreshKey]);

  // Execute query
  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryDto: PropertyQueryDTO = {
        folderScope: folderScope.trim() || undefined,
        filters: filters.length > 0 ? filters : undefined,
        sorts: sorts.length > 0 ? sorts : undefined,
        columns: selectedColumns.length > 0 ? selectedColumns : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      const res = await backend.queryNotes(queryDto);
      setQueryResult(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [backend, folderScope, filters, sorts, selectedColumns, page]);

  useEffect(() => {
    void runQuery();
  }, [runQuery, refreshKey]);

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

      {/* Top Controls Bar */}
      <div className="border-b border-slate-800/80 p-3 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
        {/* Left: View Type Switcher & Folder Scope */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewType('table')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewType === 'table'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewType === 'list'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>

          {/* Folder Scope Input */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300">
            <Folder className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Scope folder (e.g. Notes/)..."
              value={folderScope}
              onChange={(e) => {
                setFolderScope(e.target.value);
                setPage(0);
              }}
              className="bg-transparent text-xs text-slate-200 placeholder-slate-500 focus:outline-none w-36 sm:w-44"
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

        {/* Right: Filter & Columns buttons */}
        <div className="flex items-center gap-2">
          {viewType === 'table' && (
            <button
              onClick={() => setShowColumnModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <Columns className="w-3.5 h-3.5 text-sky-400" />
              <span>Columns ({selectedColumns.length})</span>
            </button>
          )}

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
          <span>Error querying notes: {error}</span>
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
            onSortChange={handleSortChange}
            onNavigate={onNavigate}
          />
        ) : (
          <ListView rows={queryResult.rows} onNavigate={onNavigate} />
        )}
      </div>

      {/* Bottom Pagination Bar */}
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
    </div>
  );
};
