import React, { useMemo, useState } from 'react';
import { VaultPath } from '@okw/core';
import { ExpectedVersionDTO, QueryRowDTO } from '@okw/workspace';
import {
  FileText,
  Tag,
  Layers,
  AlertCircle,
  MoreVertical,
  ArrowRight,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';

export interface BoardViewProps {
  rows: QueryRowDTO[];
  groupBy?: string;
  visibleProperties?: string[];
  total: number;
  canEdit?: boolean;
  onNavigate: (path: VaultPath) => void;
  onSetProperty?: (
    path: string,
    key: string,
    value: any,
    expectedVersion: ExpectedVersionDTO
  ) => Promise<void>;
}

export interface ColumnGroup {
  name: string;
  value: string | number | boolean | null;
  isUngrouped: boolean;
  isUnsupported: boolean;
  rows: QueryRowDTO[];
}

interface DraggedCardState {
  path: string;
  version: ExpectedVersionDTO;
  sourceColName: string;
}

export const BoardView: React.FC<BoardViewProps> = ({
  rows,
  groupBy = 'status',
  visibleProperties = [],
  total,
  canEdit = true,
  onNavigate,
  onSetProperty,
}) => {
  const effectiveGroupBy = groupBy.trim() || 'status';
  const [draggedCard, setDraggedCard] = useState<DraggedCardState | null>(null);
  const [dragOverColName, setDragOverColName] = useState<string | null>(null);
  const [activeMenuCardPath, setActiveMenuCardPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Group rows into columns deterministically while preserving canonical scalar types
  const columns = useMemo(() => {
    const groupMap = new Map<
      string,
      { value: string | number | boolean | null; rows: QueryRowDTO[] }
    >();
    const ungroupedKey = `No ${effectiveGroupBy}`;
    const unsupportedKey = 'Other / Unsupported';

    for (const row of rows) {
      const rawVal = row.properties ? row.properties[effectiveGroupBy] : undefined;
      let targetGroup: string;
      let canonicalVal: string | number | boolean | null = null;

      if (rawVal === undefined || rawVal === null || rawVal === '') {
        targetGroup = ungroupedKey;
        canonicalVal = null;
      } else if (typeof rawVal === 'boolean') {
        targetGroup = String(rawVal);
        canonicalVal = Boolean(rawVal);
      } else if (typeof rawVal === 'number') {
        targetGroup = String(rawVal);
        canonicalVal = Number(rawVal);
      } else if (typeof rawVal === 'string') {
        targetGroup = rawVal;
        canonicalVal = rawVal;
      } else if (Array.isArray(rawVal)) {
        if (rawVal.length === 0) {
          targetGroup = ungroupedKey;
          canonicalVal = null;
        } else if (
          rawVal.length === 1 &&
          (typeof rawVal[0] === 'string' ||
            typeof rawVal[0] === 'number' ||
            typeof rawVal[0] === 'boolean')
        ) {
          targetGroup = String(rawVal[0]);
          canonicalVal = rawVal[0];
        } else {
          targetGroup = unsupportedKey;
          canonicalVal = null;
        }
      } else {
        // Complex map/object
        targetGroup = unsupportedKey;
        canonicalVal = null;
      }

      if (!groupMap.has(targetGroup)) {
        groupMap.set(targetGroup, { value: canonicalVal, rows: [] });
      }
      groupMap.get(targetGroup)!.rows.push(row);
    }

    // Always ensure at least the ungrouped column exists if no rows
    if (groupMap.size === 0) {
      groupMap.set(ungroupedKey, { value: null, rows: [] });
    }

    const regularCols: ColumnGroup[] = [];
    let unsupportedCol: ColumnGroup | null = null;
    let ungroupedCol: ColumnGroup | null = null;

    for (const [name, data] of groupMap.entries()) {
      if (name === ungroupedKey) {
        ungroupedCol = {
          name,
          value: null,
          isUngrouped: true,
          isUnsupported: false,
          rows: data.rows,
        };
      } else if (name === unsupportedKey) {
        unsupportedCol = {
          name,
          value: null,
          isUngrouped: false,
          isUnsupported: true,
          rows: data.rows,
        };
      } else {
        regularCols.push({
          name,
          value: data.value,
          isUngrouped: false,
          isUnsupported: false,
          rows: data.rows,
        });
      }
    }

    // Sort regular columns alphabetically / numerically
    regularCols.sort((a, b) => {
      const numA = Number(a.name);
      const numB = Number(b.name);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.name.localeCompare(b.name);
    });

    if (!ungroupedCol) {
      ungroupedCol = {
        name: ungroupedKey,
        value: null,
        isUngrouped: true,
        isUnsupported: false,
        rows: [],
      };
    }

    const result: ColumnGroup[] = [...regularCols];
    if (unsupportedCol) result.push(unsupportedCol);
    if (ungroupedCol) result.push(ungroupedCol);

    return result;
  }, [rows, effectiveGroupBy]);

  const isTruncated = total > rows.length;

  const handleDragStart = (e: React.DragEvent, row: QueryRowDTO, sourceColName: string) => {
    if (!canEdit || !row.version || !onSetProperty) {
      e.preventDefault();
      return;
    }
    setDraggedCard({
      path: row.path,
      version: row.version,
      sourceColName,
    });
    e.dataTransfer.setData('text/plain', row.path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, col: ColumnGroup) => {
    if (col.isUnsupported || !canEdit) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColName !== col.name) {
      setDragOverColName(col.name);
    }
  };

  const handleDragLeave = () => {
    setDragOverColName(null);
  };

  const handleDrop = async (e: React.DragEvent, targetCol: ColumnGroup) => {
    e.preventDefault();
    setDragOverColName(null);

    if (!draggedCard || !onSetProperty || targetCol.isUnsupported) {
      setDraggedCard(null);
      return;
    }

    if (draggedCard.sourceColName === targetCol.name) {
      // Dropping in same column is a no-op
      setDraggedCard(null);
      return;
    }

    const { path, version } = draggedCard;
    setDraggedCard(null);
    setErrorMessage(null);

    try {
      await onSetProperty(path, effectiveGroupBy, targetCol.value, version);
    } catch (err: any) {
      const isConflict =
        err?.code === 'CONFLICT' ||
        err?.status === 409 ||
        err?.message?.toLowerCase().includes('conflict');

      setErrorMessage(
        isConflict
          ? 'Card modified externally (409 Conflict). Authoritative position restored.'
          : err?.message || 'Failed to move card'
      );
    }
  };

  const handleMoveViaMenu = async (row: QueryRowDTO, targetCol: ColumnGroup) => {
    setActiveMenuCardPath(null);
    if (!canEdit || !row.version || !onSetProperty || targetCol.isUnsupported) {
      return;
    }

    setErrorMessage(null);
    try {
      await onSetProperty(row.path, effectiveGroupBy, targetCol.value, row.version);
    } catch (err: any) {
      const isConflict =
        err?.code === 'CONFLICT' ||
        err?.status === 409 ||
        err?.message?.toLowerCase().includes('conflict');

      setErrorMessage(
        isConflict
          ? 'Card modified externally (409 Conflict). Authoritative position restored.'
          : err?.message || 'Failed to move card'
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Error / Conflict Banner */}
      {errorMessage && (
        <div className="bg-amber-950/80 border-b border-amber-800/80 px-4 py-2 text-amber-200 text-xs flex items-center justify-between z-30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-amber-400 hover:text-amber-200 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Truncation warning banner */}
      {isTruncated && (
        <div className="bg-sky-950/70 border-b border-sky-800/60 px-4 py-1.5 text-sky-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Showing first {rows.length} of {total} cards. Refine filters to display the complete
              board.
            </span>
          </div>
        </div>
      )}

      {/* Kanban Column Container */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 flex gap-4 items-start select-none">
        {columns.map((col) => {
          const isDragOver = dragOverColName === col.name;

          return (
            <div
              key={col.name}
              onDragOver={(e) => handleDragOver(e, col)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col)}
              className={`flex flex-col w-72 max-w-xs shrink-0 max-h-full rounded-xl transition-all ${
                isDragOver
                  ? 'bg-sky-950/40 border-2 border-sky-500 shadow-lg ring-2 ring-sky-500/20'
                  : 'bg-slate-900/60 border border-slate-800/80 shadow-sm'
              } backdrop-blur-sm`}
            >
              {/* Column Header */}
              <div className="px-3.5 py-3 border-b border-slate-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span
                    className="font-medium text-xs text-slate-200 truncate capitalize"
                    title={col.name}
                  >
                    {col.name}
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/50">
                  {col.rows.length}
                </span>
              </div>

              {/* Column Cards Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[120px]">
                {col.rows.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-600 italic">No notes</div>
                ) : (
                  col.rows.map((row) => {
                    const extraProps = Object.entries(row.properties || {}).filter(
                      ([k]) =>
                        k !== effectiveGroupBy &&
                        k !== 'title' &&
                        k !== 'tags' &&
                        k !== 'tag' &&
                        (visibleProperties.length === 0 || visibleProperties.includes(k))
                    );
                    const isMenuOpen = activeMenuCardPath === row.path;

                    return (
                      <div
                        key={row.path}
                        draggable={canEdit && Boolean(row.version)}
                        onDragStart={(e) => handleDragStart(e, row, col.name)}
                        onClick={() => onNavigate(row.path)}
                        className={`group p-3 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800/70 hover:border-sky-500/50 transition-all cursor-pointer shadow-sm hover:shadow-md relative ${
                          canEdit && Boolean(row.version)
                            ? 'cursor-grab active:cursor-grabbing'
                            : ''
                        }`}
                      >
                        {/* Card Header & Title */}
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <div className="flex items-start gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 mt-0.5 shrink-0 transition-colors" />
                            <span className="text-xs font-medium text-slate-200 group-hover:text-sky-300 transition-colors break-words leading-tight">
                              {row.title || row.path}
                            </span>
                          </div>

                          {/* Accessible Move Menu Button */}
                          {canEdit && onSetProperty && (
                            <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveMenuCardPath((prev) =>
                                    prev === row.path ? null : row.path
                                  )
                                }
                                className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Move card..."
                              >
                                <MoreVertical className="w-3.5 h-3.5" />
                              </button>

                              {isMenuOpen && (
                                <div className="absolute right-0 top-6 w-44 bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-30 p-1 text-xs">
                                  <div className="px-2 py-1 text-[10px] font-semibold text-slate-500 uppercase border-b border-slate-800/60 mb-1">
                                    Move to
                                  </div>
                                  {columns
                                    .filter((c) => !c.isUnsupported && c.name !== col.name)
                                    .map((targetC) => (
                                      <button
                                        key={targetC.name}
                                        type="button"
                                        data-testid={`move-to-${targetC.name}`}
                                        onClick={() => handleMoveViaMenu(row, targetC)}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-sky-300 flex items-center justify-between"
                                      >
                                        <span className="truncate">{targetC.name}</span>
                                        {targetC.isUngrouped ? (
                                          <Trash2 className="w-3 h-3 text-red-400" />
                                        ) : (
                                          <ArrowRight className="w-3 h-3 opacity-50" />
                                        )}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Card Path */}
                        <div className="text-[10px] font-mono text-slate-500 truncate mb-2 pl-5">
                          {row.path}
                        </div>

                        {/* Visible Properties Pills */}
                        {extraProps.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pl-5 mb-2">
                            {extraProps.map(([key, val]) => (
                              <span
                                key={key}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                                title={`${key}: ${String(val)}`}
                              >
                                <span className="text-slate-500 mr-1">{key}:</span>
                                <span className="font-mono text-sky-300">
                                  {typeof val === 'object' && val !== null
                                    ? JSON.stringify(val)
                                    : String(val)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Tags */}
                        {row.tags && row.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pl-5">
                            {row.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/90 text-slate-400 border border-slate-800"
                              >
                                <Tag className="w-2.5 h-2.5 text-slate-500" />
                                <span>{tag}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
