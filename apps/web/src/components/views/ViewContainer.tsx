import React, { useState, useEffect } from 'react';
import {
  DocumentIndex,
  ParsedDocument,
  PropertyFilter,
  SavedView,
  VaultPath,
  ViewConfig,
  ViewType,
} from '@okw/core';
import { executePropertyQuery, discoverVaultProperties } from '@okw/index';
import { TableView } from './TableView.js';
import { BoardView } from './BoardView.js';
import { ListView } from './ListView.js';
import {
  Table as TableIcon,
  LayoutGrid,
  List as ListIcon,
  Filter,
  Plus,
  Search,
  Bookmark,
  X,
  Save,
} from 'lucide-react';

interface ViewContainerProps {
  index: DocumentIndex;
  refreshKey?: any;
  onNavigate: (path: VaultPath) => void;
  onUpdateNoteProperty?: (path: VaultPath, key: string, value: any) => void;
  onCreateNoteWithProperties?: (initialProps: Record<string, any>) => void;
}

const DEFAULT_SAVED_VIEWS: SavedView[] = [
  {
    id: 'all-notes',
    name: 'All Notes (Table)',
    type: 'table',
    filters: [],
    sorts: [{ field: 'title', direction: 'asc' }],
    visibleProperties: ['status', 'priority'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'kanban-status',
    name: 'Task Board (by Status)',
    type: 'board',
    groupBy: 'status',
    filters: [],
    sorts: [{ field: 'title', direction: 'asc' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'recent-list',
    name: 'Notes List',
    type: 'list',
    filters: [],
    sorts: [{ field: 'title', direction: 'asc' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export const ViewContainer: React.FC<ViewContainerProps> = ({
  index,
  refreshKey,
  onNavigate,
  onUpdateNoteProperty,
  onCreateNoteWithProperties,
}) => {
  // Current view configuration
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const stored = localStorage.getItem('okw_saved_views');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_SAVED_VIEWS;
  });
  const [currentView, setCurrentView] = useState<ViewConfig>(
    () => savedViews[0] || DEFAULT_SAVED_VIEWS[0]
  );
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [availableProps, setAvailableProps] = useState<string[]>([]);

  // Search & Filter UI states
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [newFilterField, setNewFilterField] = useState('status');
  const [newFilterOp, setNewFilterOp] = useState<PropertyFilter['operator']>('equals');
  const [newFilterVal, setNewFilterVal] = useState('');

  // Discover vault properties on mount/refresh
  useEffect(() => {
    let isMounted = true;
    const fetchProps = async () => {
      const props = await discoverVaultProperties(index);
      if (isMounted) {
        setAvailableProps(props);
      }
    };
    fetchProps();
    return () => {
      isMounted = false;
    };
  }, [index, refreshKey]);

  // Execute query whenever view config, search, or refreshKey changes
  useEffect(() => {
    let isMounted = true;
    const runQuery = async () => {
      const filters = [...(currentView.filters || [])];
      if (searchQuery.trim()) {
        filters.push({
          field: 'title',
          operator: 'contains',
          value: searchQuery.trim(),
        });
      }

      const results = await executePropertyQuery(index, {
        ...currentView,
        filters,
      });

      if (isMounted) {
        setDocuments(results);
      }
    };

    runQuery();
    return () => {
      isMounted = false;
    };
  }, [index, currentView, searchQuery, refreshKey]);

  const handleTypeChange = (type: ViewType) => {
    setCurrentView((prev) => ({
      ...prev,
      type,
      groupBy: type === 'board' ? prev.groupBy || 'status' : prev.groupBy,
    }));
  };

  const handleAddFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilterField) return;

    const newFilter: PropertyFilter = {
      field: newFilterField,
      operator: newFilterOp,
      value: newFilterVal.trim(),
    };

    setCurrentView((prev) => ({
      ...prev,
      filters: [...(prev.filters || []), newFilter],
    }));

    setNewFilterVal('');
    setShowFilterModal(false);
  };

  const handleRemoveFilter = (indexToRemove: number) => {
    setCurrentView((prev) => ({
      ...prev,
      filters: (prev.filters || []).filter((_, idx) => idx !== indexToRemove),
    }));
  };

  const handleAddColumn = (propName: string) => {
    const clean = propName.trim();
    if (clean && !availableProps.includes(clean)) {
      setAvailableProps((prev) => [...prev, clean]);
    }
  };

  const handleSaveCurrentView = () => {
    const viewName = prompt('Enter a name for this saved view:', currentView.name);
    if (!viewName) return;

    const newSaved: SavedView = {
      ...currentView,
      id: `view-${Date.now()}`,
      name: viewName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updatedViews = [...savedViews, newSaved];
    setSavedViews(updatedViews);
    try {
      localStorage.setItem('okw_saved_views', JSON.stringify(updatedViews));
    } catch {}
    setCurrentView(newSaved);
  };

  const handleCreateNoteInView = (extraProps?: Record<string, any>) => {
    if (!onCreateNoteWithProperties) return;
    const initial: Record<string, any> = { ...extraProps };
    for (const f of currentView.filters || []) {
      if (f.operator === 'equals' && f.field && f.value !== undefined) {
        initial[f.field] = f.value;
      }
    }
    onCreateNoteWithProperties(initial);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 gap-3">
        {/* Left: Saved Views Dropdown & View Mode Switcher */}
        <div className="flex items-center gap-3">
          {/* Saved Views Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
            <Bookmark className="w-3.5 h-3.5 text-sky-400" />
            <select
              value={currentView.id}
              onChange={(e) => {
                const selected = savedViews.find((v) => v.id === e.target.value);
                if (selected) setCurrentView(selected);
              }}
              className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer"
            >
              {savedViews.map((view) => (
                <option key={view.id} value={view.id} className="bg-slate-900 text-slate-200">
                  {view.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSaveCurrentView}
            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-sky-400"
            title="Save Current View"
          >
            <Save className="w-3.5 h-3.5" />
          </button>

          {/* View Type Toggle Group */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => handleTypeChange('table')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                currentView.type === 'table'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
            <button
              onClick={() => handleTypeChange('board')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                currentView.type === 'board'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>
            <button
              onClick={() => handleTypeChange('list')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                currentView.type === 'list'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>
        </div>

        {/* Right: Search, Filter, Sort & New Note Button */}
        <div className="flex items-center gap-2">
          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Search view..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 w-36 focus:w-48 transition-all"
            />
          </div>

          {/* Filter Popover Trigger */}
          <button
            onClick={() => setShowFilterModal(!showFilterModal)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${
              (currentView.filters?.length || 0) > 0
                ? 'bg-sky-950/70 border-sky-600/70 text-sky-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>
              Filter {(currentView.filters?.length || 0) > 0 && `(${currentView.filters?.length})`}
            </span>
          </button>

          {/* Board Group By Selector */}
          {currentView.type === 'board' && (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-400">
              <span className="text-[11px]">Group:</span>
              <select
                value={currentView.groupBy || 'status'}
                onChange={(e) => setCurrentView((prev) => ({ ...prev, groupBy: e.target.value }))}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                {availableProps
                  .filter((p) => p !== 'lineCount' && p !== 'wordCount')
                  .map((p) => (
                    <option key={p} value={p} className="bg-slate-900 text-slate-200">
                      {p}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* New Note in View */}
          <button
            onClick={() => handleCreateNoteInView()}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Note</span>
          </button>
        </div>
      </div>

      {/* Active Filter Pills Bar */}
      {(currentView.filters?.length || 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 bg-slate-900/50 border-b border-slate-800 text-xs">
          <span className="text-slate-500 text-[11px]">Filters:</span>
          {currentView.filters!.map((filter, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-300"
            >
              <span className="text-slate-400 font-medium">{filter.field}</span>
              <span className="text-sky-400">{filter.operator}</span>
              {filter.value && (
                <span className="font-semibold text-slate-200">"{filter.value}"</span>
              )}
              <button
                onClick={() => handleRemoveFilter(idx)}
                className="hover:text-rose-400 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filter Builder Modal */}
      {showFilterModal && (
        <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-xs animate-in slide-in-from-top-1 duration-150">
          <span className="text-slate-400 font-medium">Add Filter:</span>
          <select
            value={newFilterField}
            onChange={(e) => setNewFilterField(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none"
          >
            {availableProps.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={newFilterOp}
            onChange={(e) => setNewFilterOp(e.target.value as any)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none"
          >
            <option value="equals">equals</option>
            <option value="not_equals">does not equal</option>
            <option value="contains">contains</option>
            <option value="not_contains">does not contain</option>
            <option value="greater_than">greater than</option>
            <option value="less_than">less than</option>
            <option value="is_empty">is empty</option>
            <option value="is_not_empty">is not empty</option>
          </select>
          {newFilterOp !== 'is_empty' && newFilterOp !== 'is_not_empty' && (
            <input
              type="text"
              placeholder="Value..."
              value={newFilterVal}
              onChange={(e) => setNewFilterVal(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none w-36"
            />
          )}
          <button
            onClick={handleAddFilter}
            className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white font-medium"
          >
            Apply
          </button>
          <button
            onClick={() => setShowFilterModal(false)}
            className="p-1 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main View Area */}
      <div className="flex-1 w-full h-full overflow-hidden">
        {currentView.type === 'table' && (
          <TableView
            documents={documents}
            properties={availableProps.filter((p) => p !== 'title' && p !== 'path' && p !== 'tags')}
            onNavigate={onNavigate}
            onUpdateProperty={onUpdateNoteProperty}
            onAddProperty={handleAddColumn}
          />
        )}
        {currentView.type === 'board' && (
          <BoardView
            documents={documents}
            groupBy={currentView.groupBy || 'status'}
            onNavigate={onNavigate}
            onUpdateProperty={onUpdateNoteProperty}
            onCreateNoteInGroup={(val) =>
              handleCreateNoteInView(val ? { [currentView.groupBy || 'status']: val } : undefined)
            }
          />
        )}
        {currentView.type === 'list' && <ListView documents={documents} onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
