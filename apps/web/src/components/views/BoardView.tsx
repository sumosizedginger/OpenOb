import React from 'react';
import { ParsedDocument, VaultPath } from '@okw/core';
import { groupDocumentsByProperty } from '@okw/index';
import { FileText, Plus, ArrowRight, Tag } from 'lucide-react';

interface BoardViewProps {
  documents: ParsedDocument[];
  groupBy: string;
  onNavigate: (path: VaultPath) => void;
  onUpdateProperty?: (path: VaultPath, key: string, value: any) => void;
  onCreateNoteInGroup?: (groupValue: string) => void;
}

export const BoardView: React.FC<BoardViewProps> = ({
  documents,
  groupBy,
  onNavigate,
  onUpdateProperty,
  onCreateNoteInGroup,
}) => {
  const groups = groupDocumentsByProperty(documents, groupBy);
  const groupNames = Array.from(groups.keys());

  return (
    <div className="w-full h-full overflow-x-auto overflow-y-hidden bg-slate-950 p-4 flex gap-4 select-none">
      {groupNames.map((groupName) => {
        const groupDocs = groups.get(groupName) || [];

        return (
          <div
            key={groupName}
            className="w-72 shrink-0 flex flex-col bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden shadow-md max-h-full"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-3 py-2.5 bg-slate-800/60 border-b border-slate-700/60">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200 capitalize">{groupName}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-slate-300 font-medium">
                  {groupDocs.length}
                </span>
              </div>
              {onCreateNoteInGroup && (
                <button
                  onClick={() =>
                    onCreateNoteInGroup(groupName === `No ${groupBy}` ? '' : groupName)
                  }
                  className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-700/60"
                  title={`New note in ${groupName}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Column Cards List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {groupDocs.map((doc) => (
                <div
                  key={doc.path}
                  className="bg-slate-950/80 border border-slate-800/80 hover:border-sky-500/60 rounded-lg p-3 shadow-sm hover:shadow-md transition-all group cursor-pointer flex flex-col gap-2"
                  onClick={() => onNavigate(doc.path)}
                >
                  {/* Card Title */}
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-200 group-hover:text-sky-400 leading-tight">
                        {doc.title}
                      </span>
                    </div>
                  </div>

                  {/* Tags */}
                  {doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.2 rounded text-[9px] bg-purple-950/60 text-purple-300 border border-purple-800/50 flex items-center gap-0.5"
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Move to another column select */}
                  {onUpdateProperty && groupNames.length > 1 && (
                    <div
                      className="pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="flex items-center gap-1">
                        <ArrowRight className="w-2.5 h-2.5 opacity-60" /> Move:
                      </span>
                      <select
                        value={groupName}
                        onChange={(e) => {
                          const targetVal =
                            e.target.value === `No ${groupBy}` ? null : e.target.value;
                          onUpdateProperty(doc.path, groupBy, targetVal);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-sky-500"
                      >
                        {groupNames.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ))}

              {groupDocs.length === 0 && (
                <div className="text-center py-6 text-slate-600 text-xs italic">
                  No notes in this group
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
