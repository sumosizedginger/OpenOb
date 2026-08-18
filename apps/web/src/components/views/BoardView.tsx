import React, { useMemo } from 'react';
import { QueryRow, VaultPath } from '@okw/core';
import { FileText, Tag, Layers, AlertCircle } from 'lucide-react';

export interface BoardViewProps {
  rows: QueryRow[];
  groupBy?: string;
  visibleProperties?: string[];
  total: number;
  onNavigate: (path: VaultPath) => void;
}

interface ColumnGroup {
  name: string;
  isUngrouped: boolean;
  isUnsupported: boolean;
  rows: QueryRow[];
}

export const BoardView: React.FC<BoardViewProps> = ({
  rows,
  groupBy = 'status',
  visibleProperties = [],
  total,
  onNavigate,
}) => {
  const effectiveGroupBy = groupBy.trim() || 'status';

  // Group rows into columns deterministically
  const columns = useMemo(() => {
    const groupMap = new Map<string, QueryRow[]>();
    const ungroupedKey = `No ${effectiveGroupBy}`;
    const unsupportedKey = 'Other / Unsupported';

    for (const row of rows) {
      const rawVal = row.properties ? row.properties[effectiveGroupBy] : undefined;
      let targetGroup: string;

      if (rawVal === undefined || rawVal === null || rawVal === '') {
        targetGroup = ungroupedKey;
      } else if (
        typeof rawVal === 'string' ||
        typeof rawVal === 'number' ||
        typeof rawVal === 'boolean'
      ) {
        targetGroup = String(rawVal);
      } else if (Array.isArray(rawVal)) {
        if (rawVal.length === 0) {
          targetGroup = ungroupedKey;
        } else if (
          rawVal.length === 1 &&
          (typeof rawVal[0] === 'string' ||
            typeof rawVal[0] === 'number' ||
            typeof rawVal[0] === 'boolean')
        ) {
          targetGroup = String(rawVal[0]);
        } else {
          targetGroup = unsupportedKey;
        }
      } else {
        // Complex map/object
        targetGroup = unsupportedKey;
      }

      if (!groupMap.has(targetGroup)) {
        groupMap.set(targetGroup, []);
      }
      groupMap.get(targetGroup)!.push(row);
    }

    // Always ensure at least the ungrouped column exists if no rows
    if (groupMap.size === 0) {
      groupMap.set(ungroupedKey, []);
    }

    const regularCols: ColumnGroup[] = [];
    let unsupportedCol: ColumnGroup | null = null;
    let ungroupedCol: ColumnGroup | null = null;

    for (const [name, colRows] of groupMap.entries()) {
      if (name === ungroupedKey) {
        ungroupedCol = { name, isUngrouped: true, isUnsupported: false, rows: colRows };
      } else if (name === unsupportedKey) {
        unsupportedCol = { name, isUngrouped: false, isUnsupported: true, rows: colRows };
      } else {
        regularCols.push({ name, isUngrouped: false, isUnsupported: false, rows: colRows });
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

    const result: ColumnGroup[] = [...regularCols];
    if (unsupportedCol) result.push(unsupportedCol);
    if (ungroupedCol) result.push(ungroupedCol);

    return result;
  }, [rows, effectiveGroupBy]);

  const isTruncated = total > rows.length;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
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
        {columns.map((col) => (
          <div
            key={col.name}
            className="flex flex-col w-72 max-w-xs shrink-0 max-h-full rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm backdrop-blur-sm"
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

                  return (
                    <div
                      key={row.path}
                      onClick={() => onNavigate(row.path)}
                      className="group p-3 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800/70 hover:border-sky-500/50 transition-all cursor-pointer shadow-sm hover:shadow-md"
                    >
                      {/* Card Title */}
                      <div className="flex items-start gap-2 mb-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 mt-0.5 shrink-0 transition-colors" />
                        <span className="text-xs font-medium text-slate-200 group-hover:text-sky-300 transition-colors break-words leading-tight">
                          {row.title || row.path}
                        </span>
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
        ))}
      </div>
    </div>
  );
};
