import React from 'react';
import { VaultPath } from '@okw/core';
import { QueryRowDTO } from '@okw/workspace';
import { FileText, Tag, Hash } from 'lucide-react';

interface ListViewProps {
  rows: QueryRowDTO[];
  onNavigate: (path: VaultPath) => void;
}

export const ListView: React.FC<ListViewProps> = ({ rows, onNavigate }) => {
  return (
    <div className="w-full h-full overflow-y-auto bg-slate-950 p-4 space-y-2.5 select-none">
      {rows.map((row) => (
        <div
          key={row.path}
          onClick={() => onNavigate(row.path)}
          className="bg-slate-900/60 border border-slate-800 hover:border-sky-500/60 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-all cursor-pointer group flex items-center justify-between gap-4"
        >
          {/* Left info: Icon, Title, Path */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-sky-950/80 text-slate-400 group-hover:text-sky-400 transition-colors shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-200 group-hover:text-sky-400 truncate">
                {row.title || row.path}
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5 font-mono">{row.path}</div>
            </div>
          </div>

          {/* Right info: Tags, properties badges, word count */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Tags */}
            <div className="flex flex-wrap gap-1">
              {row.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/50 flex items-center gap-1"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
            </div>

            {/* Custom Frontmatter Properties summary */}
            {row.properties && Object.keys(row.properties).length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                {Object.entries(row.properties)
                  .filter(([k]) => k !== 'tags' && k !== 'tag' && k !== 'title')
                  .slice(0, 3)
                  .map(([k, v]) => {
                    const strVal =
                      typeof v === 'object' && v !== null
                        ? Array.isArray(v)
                          ? v.join(', ')
                          : JSON.stringify(v)
                        : String(v);
                    return (
                      <span
                        key={k}
                        className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700/60"
                      >
                        <span className="text-slate-500 font-medium">{k}:</span> {strVal}
                      </span>
                    );
                  })}
              </div>
            )}

            {/* Word count */}
            {row.wordCount !== undefined && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Hash className="w-3 h-3 text-slate-600" />
                {row.wordCount} words
              </span>
            )}
          </div>
        </div>
      ))}

      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-sm gap-2">
          <FileText className="w-8 h-8 opacity-30 text-slate-400" />
          <p>No documents match this query</p>
        </div>
      )}
    </div>
  );
};
