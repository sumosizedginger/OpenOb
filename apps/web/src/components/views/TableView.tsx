import React from 'react';
import { VaultPath } from '@okw/core';
import { QueryRowDTO } from '@okw/workspace';
import { FileText, Tag, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface TableViewProps {
  rows: QueryRowDTO[];
  columns: string[];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (field: string) => void;
  onNavigate: (path: VaultPath) => void;
}

export const TableView: React.FC<TableViewProps> = ({
  rows,
  columns,
  sortField,
  sortDirection,
  onSortChange,
  onNavigate,
}) => {
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
              {/* Title */}
              <td className="p-3 border-r border-slate-800/40 font-medium text-slate-200 group-hover:text-sky-400">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0" />
                  <span className="truncate">{row.title || row.path}</span>
                </div>
              </td>

              {/* Path */}
              <td className="p-3 border-r border-slate-800/40 text-slate-500 font-mono text-[11px] truncate">
                {row.path}
              </td>

              {/* Tags */}
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

              {/* Dynamic Property Columns */}
              {columns.map((col) => {
                const val = row.properties?.[col];
                let displayVal = '';
                if (val !== undefined && val !== null) {
                  if (typeof val === 'object') {
                    displayVal = Array.isArray(val) ? val.join(', ') : JSON.stringify(val);
                  } else {
                    displayVal = String(val);
                  }
                }

                return (
                  <td
                    key={col}
                    className="p-3 border-r border-slate-800/40 text-slate-300 truncate"
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
