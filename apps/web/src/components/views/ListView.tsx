import React from 'react';
import { ParsedDocument, VaultPath } from '@okw/core';
import { FileText, Tag, Hash } from 'lucide-react';

interface ListViewProps {
  documents: ParsedDocument[];
  onNavigate: (path: VaultPath) => void;
}

export const ListView: React.FC<ListViewProps> = ({ documents, onNavigate }) => {
  return (
    <div className="w-full h-full overflow-y-auto bg-slate-950 p-4 space-y-2.5 select-none">
      {documents.map((doc) => (
        <div
          key={doc.path}
          onClick={() => onNavigate(doc.path)}
          className="bg-slate-900/60 border border-slate-800 hover:border-sky-500/60 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-all cursor-pointer group flex items-center justify-between gap-4"
        >
          {/* Left info: Icon, Title, Path */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-sky-950/80 text-slate-400 group-hover:text-sky-400 transition-colors shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-200 group-hover:text-sky-400 truncate">
                {doc.title}
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5">{doc.path}</div>
            </div>
          </div>

          {/* Right info: Tags, properties badges, word count */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Tags */}
            <div className="flex flex-wrap gap-1">
              {doc.tags.slice(0, 3).map((tag) => (
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
            {doc.properties && Object.keys(doc.properties).length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                {Object.entries(doc.properties)
                  .filter(([k]) => k !== 'tags' && k !== 'tag' && k !== 'title')
                  .slice(0, 2)
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700/60"
                    >
                      <span className="text-slate-500 font-medium">{k}:</span> {String(v)}
                    </span>
                  ))}
              </div>
            )}

            {/* Word count */}
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Hash className="w-3 h-3 text-slate-600" />
              {doc.wordCount} words
            </span>
          </div>
        </div>
      ))}

      {documents.length === 0 && (
        <div className="text-center py-16 text-slate-500 text-sm">
          No documents match this view's filter criteria
        </div>
      )}
    </div>
  );
};
