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
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: 'var(--surface-canvas)',
        color: 'var(--text-primary)',
        userSelect: 'none',
      }}
    >
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}
      >
        <thead>
          <tr
            style={{
              backgroundColor: 'var(--surface-sidebar)',
              borderBottom: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <th
              onClick={() => onSortChange?.('title')}
              style={{
                padding: '10px 14px',
                borderRight: '1px solid var(--border-subtle)',
                minWidth: '200px',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText size={13} style={{ color: 'var(--accent-primary)' }} />
                  <span>Title</span>
                </div>
                {sortField === 'title' ? (
                  sortDirection === 'asc' ? (
                    <ArrowUp size={12} style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <ArrowDown size={12} style={{ color: 'var(--accent-primary)' }} />
                  )
                ) : (
                  <ArrowUpDown size={12} style={{ opacity: 0.3 }} />
                )}
              </div>
            </th>

            <th
              onClick={() => onSortChange?.('path')}
              style={{
                padding: '10px 14px',
                borderRight: '1px solid var(--border-subtle)',
                minWidth: '160px',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                }}
              >
                <span>Path</span>
                {sortField === 'path' ? (
                  sortDirection === 'asc' ? (
                    <ArrowUp size={12} style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <ArrowDown size={12} style={{ color: 'var(--accent-primary)' }} />
                  )
                ) : (
                  <ArrowUpDown size={12} style={{ opacity: 0.3 }} />
                )}
              </div>
            </th>

            <th
              style={{
                padding: '10px 14px',
                borderRight: '1px solid var(--border-subtle)',
                minWidth: '140px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Tag size={13} style={{ color: 'var(--status-info)' }} />
                <span>Tags</span>
              </div>
            </th>

            {columns.map((col) => (
              <th
                key={col}
                onClick={() => onSortChange?.(col)}
                style={{
                  padding: '10px 14px',
                  borderRight: '1px solid var(--border-subtle)',
                  minWidth: '130px',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span>{col}</span>
                  {sortField === col ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp size={12} style={{ color: 'var(--accent-primary)' }} />
                    ) : (
                      <ArrowDown size={12} style={{ color: 'var(--accent-primary)' }} />
                    )
                  ) : (
                    <ArrowUpDown size={12} style={{ opacity: 0.3 }} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.path}
              onClick={() => onNavigate(row.path)}
              className="tree-item"
              style={{
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'transparent',
                borderRadius: 0,
                margin: 0,
                display: 'table-row',
              }}
            >
              {/* Title */}
              <td
                style={{
                  padding: '8px 14px',
                  borderRight: '1px solid var(--border-subtle)',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  maxWidth: '220px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {row.title || row.path}
                  </span>
                </div>
              </td>

              {/* Path */}
              <td
                style={{
                  padding: '8px 14px',
                  borderRight: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  maxWidth: '180px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.path}
              </td>

              {/* Tags */}
              <td style={{ padding: '8px 14px', borderRight: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {row.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '10px',
                        backgroundColor: 'var(--surface-selected)',
                        color: 'var(--accent-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </td>

              {/* Dynamic Property Columns */}
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
                      style={{
                        padding: '4px 8px',
                        borderRight: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-elevated)',
                        minWidth: '160px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                              style={{
                                backgroundColor: 'var(--surface-canvas)',
                                border: '1px solid var(--border-focus)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '3px 6px',
                                fontSize: '12px',
                                color: 'var(--text-primary)',
                                flex: 1,
                              }}
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
                              style={{
                                backgroundColor: 'var(--surface-canvas)',
                                border: '1px solid var(--border-focus)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '3px 6px',
                                fontSize: '12px',
                                color: 'var(--text-primary)',
                                flex: 1,
                                outline: 'none',
                              }}
                              placeholder="Value..."
                            />
                          )}

                          {activeEditor.isSaving ? (
                            <Loader2
                              size={13}
                              className="spin"
                              style={{ color: 'var(--accent-primary)' }}
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCommitEdit()}
                                className="btn btn-primary"
                                style={{ padding: '3px 6px', height: '22px' }}
                                title="Save (Enter)"
                              >
                                <Check size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="btn"
                                style={{ padding: '3px 6px', height: '22px' }}
                                title="Cancel (Esc)"
                              >
                                <X size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={handleClearProperty}
                                className="btn"
                                style={{
                                  padding: '3px 6px',
                                  height: '22px',
                                  color: 'var(--status-danger)',
                                }}
                                title="Clear property"
                              >
                                <Trash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>

                        {activeEditor.errorMessage && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '10px',
                              color: 'var(--status-warning)',
                            }}
                          >
                            <AlertTriangle size={11} />
                            <span>{activeEditor.errorMessage}</span>
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
                    style={{
                      padding: '8px 14px',
                      borderRight: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      maxWidth: '160px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={canEdit ? 'Click to edit property' : undefined}
                  >
                    {displayVal ? (
                      <span>{displayVal}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0',
            color: 'var(--text-muted)',
            gap: '8px',
          }}
        >
          <FileText size={32} style={{ opacity: 0.3 }} />
          <p>No documents match this query</p>
        </div>
      )}
    </div>
  );
};
