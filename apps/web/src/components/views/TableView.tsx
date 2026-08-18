import React, { useState, useRef, useEffect } from 'react';
import { VaultPath } from '@okw/core';
import { ExpectedVersionDTO, QueryRowDTO } from '@okw/workspace';
import {
  FileText,
  Tag,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Check,
  X,
  Trash2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface TableViewProps {
  rows: QueryRowDTO[];
  columns: string[];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  canEdit?: boolean;
  onSortChange?: (field: string) => void;
  onNavigate: (path: VaultPath) => void;
  onSetProperty?: (
    path: string,
    key: string,
    value: any,
    expectedVersion: ExpectedVersionDTO
  ) => Promise<void>;
}

interface ActiveCellEditor {
  path: string;
  col: string;
  draft: any;
  valueType: 'string' | 'number' | 'boolean' | 'null';
  expectedVersion: ExpectedVersionDTO;
  isSaving: boolean;
  isConflict: boolean;
  errorMessage?: string;
}

export const TableView: React.FC<TableViewProps> = ({
  rows,
  columns,
  sortField,
  sortDirection,
  canEdit = true,
  onSortChange,
  onNavigate,
  onSetProperty,
}) => {
  const [activeEditor, setActiveEditor] = useState<ActiveCellEditor | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (activeEditor && !activeEditor.isSaving && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeEditor?.path, activeEditor?.col]);

  const handleStartEdit = (e: React.MouseEvent, row: QueryRowDTO, col: string) => {
    e.stopPropagation();
    if (!canEdit || !onSetProperty) return;
    const expectedVersion = row.version ?? { token: '' };

    const val = row.properties?.[col];
    let valueType: 'string' | 'number' | 'boolean' | 'null' = 'string';
    let initialDraft: any = '';

    if (val !== undefined && val !== null) {
      if (typeof val === 'boolean') {
        valueType = 'boolean';
        initialDraft = val;
      } else if (typeof val === 'number') {
        valueType = 'number';
        initialDraft = String(val);
      } else if (typeof val === 'string') {
        valueType = 'string';
        initialDraft = val;
      } else {
        // Arrays/objects are read-only in inline scalar editor
        return;
      }
    } else {
      valueType = 'string';
      initialDraft = '';
    }

    setActiveEditor({
      path: row.path,
      col,
      draft: initialDraft,
      valueType,
      expectedVersion,
      isSaving: false,
      isConflict: false,
    });
  };

  const handleCommitEdit = async (explicitValue?: any) => {
    if (!activeEditor || !onSetProperty || activeEditor.isSaving) return;

    let finalVal: any;
    if (explicitValue !== undefined) {
      finalVal = explicitValue;
    } else if (activeEditor.valueType === 'boolean') {
      finalVal = Boolean(activeEditor.draft);
    } else if (activeEditor.valueType === 'number') {
      const parsed = Number(activeEditor.draft);
      if (isNaN(parsed)) {
        setActiveEditor((prev) =>
          prev ? { ...prev, errorMessage: 'Must be a valid number' } : null
        );
        return;
      }
      finalVal = parsed;
    } else {
      finalVal = String(activeEditor.draft);
    }

    setActiveEditor((prev) => (prev ? { ...prev, isSaving: true, errorMessage: undefined } : null));

    try {
      await onSetProperty(
        activeEditor.path,
        activeEditor.col,
        finalVal,
        activeEditor.expectedVersion
      );
      setActiveEditor(null);
    } catch (err: any) {
      const isConflict =
        err?.code === 'CONFLICT' ||
        err?.status === 409 ||
        err?.message?.toLowerCase().includes('conflict');

      setActiveEditor((prev) =>
        prev
          ? {
              ...prev,
              isSaving: false,
              isConflict,
              errorMessage: isConflict
                ? 'Modified externally (409 Conflict). Draft preserved.'
                : err?.message || 'Failed to save property',
            }
          : null
      );
    }
  };

  const handleClearProperty = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await handleCommitEdit(null);
  };

  const handleCancelEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    setActiveEditor(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleCommitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit(e);
    }
  };

  return (
    <div className="w-full h-full overflow-auto bg-slate-950 text-slate-100 select-none">
      <table className="w-full border-collapse text-xs text-left">
        <thead>
          <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-semibold sticky top-0 z-10 backdrop-blur-md">
            <th
              onClick={() => onSortChange?.('title')}
              className="p-3 border-r border-slate-800/60 min-w-[200px] cursor-pointer hover:text-slate-200 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-400" />
                  <span>Title</span>
                </div>
                {sortField === 'title' ? (
                  sortDirection === 'asc' ? (
                    <ArrowUp className="w-3 h-3 text-sky-400" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-sky-400" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100" />
                )}
              </div>
            </th>

            <th
              onClick={() => onSortChange?.('path')}
              className="p-3 border-r border-slate-800/60 min-w-[160px] cursor-pointer hover:text-slate-200 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span>Path</span>
                {sortField === 'path' ? (
                  sortDirection === 'asc' ? (
                    <ArrowUp className="w-3 h-3 text-sky-400" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-sky-400" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100" />
                )}
              </div>
            </th>

            <th className="p-3 border-r border-slate-800/60 min-w-[140px]">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400" />
                <span>Tags</span>
              </div>
            </th>

            {columns.map((col) => (
              <th
                key={col}
                onClick={() => onSortChange?.(col)}
                className="p-3 border-r border-slate-800/60 min-w-[130px] cursor-pointer hover:text-slate-200 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="capitalize">{col}</span>
                  {sortField === col ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="w-3 h-3 text-sky-400" />
                    ) : (
                      <ArrowDown className="w-3 h-3 text-sky-400" />
                    )
                  ) : (
                    <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {rows.map((row) => (
            <tr
              key={row.path}
              onClick={() => onNavigate(row.path)}
              className="hover:bg-slate-900/50 group transition-colors cursor-pointer"
            >
              {/* Title (Read-only) */}
              <td className="p-3 border-r border-slate-800/40 font-medium text-slate-200 group-hover:text-sky-400">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0" />
                  <span className="truncate">{row.title || row.path}</span>
                </div>
              </td>

              {/* Path (Read-only) */}
              <td className="p-3 border-r border-slate-800/40 text-slate-500 font-mono text-[11px] truncate">
                {row.path}
              </td>

              {/* Tags (Read-only) */}
              <td className="p-3 border-r border-slate-800/40">
                <div className="flex flex-wrap gap-1">
                  {row.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/50"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </td>

              {/* Dynamic Property Columns (Editable) */}
              {columns.map((col) => {
                const val = row.properties?.[col];
                const isEditing = activeEditor?.path === row.path && activeEditor?.col === col;

                let displayVal = '';
                if (val !== undefined && val !== null) {
                  if (typeof val === 'object') {
                    displayVal = Array.isArray(val) ? val.join(', ') : JSON.stringify(val);
                  } else {
                    displayVal = String(val);
                  }
                }

                if (isEditing) {
                  return (
                    <td
                      key={col}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 border-r border-slate-800/40 bg-slate-900/90 relative z-20 min-w-[160px]"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          {activeEditor.valueType === 'boolean' ? (
                            <select
                              ref={inputRef as React.RefObject<HTMLSelectElement>}
                              value={String(activeEditor.draft)}
                              disabled={activeEditor.isSaving}
                              onChange={(e) =>
                                setActiveEditor((prev) =>
                                  prev ? { ...prev, draft: e.target.value === 'true' } : null
                                )
                              }
                              onKeyDown={handleKeyDown}
                              className="bg-slate-950 border border-sky-500 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none flex-1"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              ref={inputRef as React.RefObject<HTMLInputElement>}
                              type={activeEditor.valueType === 'number' ? 'number' : 'text'}
                              value={activeEditor.draft}
                              disabled={activeEditor.isSaving}
                              onChange={(e) =>
                                setActiveEditor((prev) =>
                                  prev ? { ...prev, draft: e.target.value } : null
                                )
                              }
                              onKeyDown={handleKeyDown}
                              className="bg-slate-950 border border-sky-500 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none flex-1"
                              placeholder="Value..."
                            />
                          )}

                          {activeEditor.isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCommitEdit()}
                                className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white shrink-0"
                                title="Save (Enter)"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0"
                                title="Cancel (Esc)"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={handleClearProperty}
                                className="p-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-red-300 shrink-0"
                                title="Clear property (delete from note)"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>

                        {activeEditor.errorMessage && (
                          <div className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/40 p-1 rounded border border-amber-800/40">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">{activeEditor.errorMessage}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                }

                return (
                  <td
                    key={col}
                    data-testid={`cell-${row.path}-${col}`}
                    onClick={(e) => {
                      if (canEdit && onSetProperty) {
                        handleStartEdit(e, row, col);
                      }
                    }}
                    className={`p-3 border-r border-slate-800/40 text-slate-300 truncate ${
                      canEdit && onSetProperty
                        ? 'hover:bg-slate-800/60 cursor-pointer hover:border-sky-500/30'
                        : ''
                    }`}
                    title={canEdit ? 'Click to edit property' : undefined}
                  >
                    {displayVal ? (
                      <span className="truncate">{displayVal}</span>
                    ) : (
                      <span className="text-slate-600 italic">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-sm gap-2">
          <FileText className="w-8 h-8 opacity-30 text-slate-400" />
          <p>No documents match this query</p>
        </div>
      )}
    </div>
  );
};
