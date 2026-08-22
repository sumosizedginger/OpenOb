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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--surface-canvas)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* Error / Conflict Banner */}
      {errorMessage && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            padding: '8px 16px',
            color: 'var(--status-danger)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 30,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="btn-icon"
            style={{ width: '18px', height: '18px' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Truncation warning banner */}
      {isTruncated && (
        <div
          style={{
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
            padding: '6px 16px',
            color: 'var(--status-info)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span>
            Showing first {rows.length} of {total} cards. Refine filters to display the complete
            board.
          </span>
        </div>
      )}

      {/* Kanban Column Container */}
      <div
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '16px',
          display: 'flex',
          gap: '16px',
          alignItems: 'flex-start',
          userSelect: 'none',
        }}
      >
        {columns.map((col) => {
          const isDragOver = dragOverColName === col.name;

          return (
            <div
              key={col.name}
              onDragOver={(e) => handleDragOver(e, col)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '280px',
                minWidth: '260px',
                maxHeight: '100%',
                borderRadius: 'var(--radius-xl)',
                backgroundColor: isDragOver ? 'var(--surface-selected)' : 'var(--surface-sidebar)',
                border: isDragOver
                  ? '2px solid var(--border-focus)'
                  : '1px solid var(--border-subtle)',
                boxShadow: isDragOver ? 'var(--shadow-md)' : 'none',
                transition: 'all var(--duration-fast) ease',
              }}
            >
              {/* Column Header */}
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <Layers size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      textTransform: 'capitalize',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={col.name}
                  >
                    {col.name}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--surface-canvas)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {col.rows.length}
                </span>
              </div>

              {/* Column Cards Scrollable Body */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  minHeight: '120px',
                }}
              >
                {col.rows.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '32px 0',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    No notes
                  </div>
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
                        className="group"
                        draggable={canEdit && Boolean(row.version)}
                        onDragStart={(e) => handleDragStart(e, row, col.name)}
                        onClick={() => onNavigate(row.path)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-lg)',
                          backgroundColor: 'var(--surface-canvas)',
                          border: '1px solid var(--border-subtle)',
                          cursor: canEdit && Boolean(row.version) ? 'grab' : 'pointer',
                          boxShadow: 'var(--shadow-sm)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          position: 'relative',
                          transition: 'all var(--duration-fast) ease',
                        }}
                      >
                        {/* Card Header & Title */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: '6px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigate(row.path);
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '6px',
                              minWidth: 0,
                              cursor: 'pointer',
                            }}
                          >
                            <FileText
                              size={13}
                              style={{
                                color: 'var(--accent-primary)',
                                marginTop: '2px',
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 500,
                                color: 'var(--text-primary)',
                                wordBreak: 'break-word',
                                lineHeight: '1.4',
                              }}
                            >
                              {row.title || row.path}
                            </span>
                          </div>

                          {/* Move Menu */}
                          {canEdit && onSetProperty && (
                            <div
                              style={{ position: 'relative', flexShrink: 0 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveMenuCardPath((prev) =>
                                    prev === row.path ? null : row.path
                                  )
                                }
                                className="btn-icon"
                                style={{ width: '18px', height: '18px' }}
                                title="Move card..."
                              >
                                <MoreVertical size={11} />
                              </button>

                              {isMenuOpen && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: '22px',
                                    width: '160px',
                                    backgroundColor: 'var(--surface-elevated)',
                                    border: '1px solid var(--border-medium)',
                                    borderRadius: 'var(--radius-md)',
                                    boxShadow: 'var(--shadow-lg)',
                                    zIndex: 30,
                                    padding: '4px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                  }}
                                >
                                  <div
                                    style={{
                                      padding: '4px 6px',
                                      fontSize: '10px',
                                      fontWeight: 600,
                                      color: 'var(--text-muted)',
                                      textTransform: 'uppercase',
                                      borderBottom: '1px solid var(--border-subtle)',
                                      marginBottom: '2px',
                                    }}
                                  >
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
                                        style={{
                                          width: '100%',
                                          textAlign: 'left',
                                          padding: '4px 6px',
                                          borderRadius: 'var(--radius-sm)',
                                          backgroundColor: 'transparent',
                                          border: 'none',
                                          color: 'var(--text-primary)',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                        }}
                                      >
                                        <span
                                          style={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {targetC.name}
                                        </span>
                                        {targetC.isUngrouped ? (
                                          <Trash2
                                            size={11}
                                            style={{ color: 'var(--status-danger)' }}
                                          />
                                        ) : (
                                          <ArrowRight size={11} style={{ opacity: 0.5 }} />
                                        )}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Card Path */}
                        <div
                          style={{
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-muted)',
                            paddingLeft: '19px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.path}
                        </div>

                        {/* Visible Properties */}
                        {extraProps.length > 0 && (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '4px',
                              paddingLeft: '19px',
                            }}
                          >
                            {extraProps.map(([key, val]) => (
                              <span
                                key={key}
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 5px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: 'var(--surface-sidebar)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                <span style={{ color: 'var(--text-muted)', marginRight: '3px' }}>
                                  {key}:
                                </span>
                                <span
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--accent-primary)',
                                  }}
                                >
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
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '3px',
                              paddingLeft: '19px',
                            }}
                          >
                            {row.tags.map((tag) => (
                              <span
                                key={tag}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--surface-selected)',
                                  color: 'var(--accent-primary)',
                                  border: '1px solid var(--border-subtle)',
                                }}
                              >
                                <Tag size={8} />
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
