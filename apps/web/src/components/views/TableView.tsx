import React, { useState } from 'react';
import { ParsedDocument, VaultPath } from '@okw/core';
import { FileText, Plus, ArrowUpDown, Tag } from 'lucide-react';

interface TableViewProps {
  documents: ParsedDocument[];
  properties: string[];
  onNavigate: (path: VaultPath) => void;
  onUpdateProperty?: (path: VaultPath, key: string, value: any) => void;
  onAddProperty?: (name: string) => void;
}

export const TableView: React.FC<TableViewProps> = ({
  documents,
  properties,
  onNavigate,
  onUpdateProperty,
  onAddProperty,
}) => {
  const [editingCell, setEditingCell] = useState<{ path: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [newPropName, setNewPropName] = useState('');
  const [showAddPropInput, setShowAddPropInput] = useState(false);

  const startEditing = (doc: ParsedDocument, key: string) => {
    if (!onUpdateProperty) return;
    const val = key === 'title' ? doc.title : doc.properties?.[key];
    setEditingCell({ path: doc.path, key });
    setEditValue(val !== undefined && val !== null ? String(val) : '');
  };

  const saveEditing = () => {
    if (!editingCell || !onUpdateProperty) return;
    let parsedVal: any = editValue.trim();
    if (parsedVal === 'true') parsedVal = true;
    else if (parsedVal === 'false') parsedVal = false;
    else if (parsedVal === 'null' || parsedVal === '') parsedVal = null;
    else if (!isNaN(Number(parsedVal))) parsedVal = Number(parsedVal);

    onUpdateProperty(editingCell.path, editingCell.key, parsedVal);
    setEditingCell(null);
  };

  const handleAddPropertySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPropName.trim() && onAddProperty) {
      onAddProperty(newPropName.trim());
      setNewPropName('');
      setShowAddPropInput(false);
    }
  };

  return (
    <div className="w-full h-full overflow-auto bg-slate-950 text-slate-100 select-none">
      <table className="w-full border-collapse text-xs text-left">
        <thead>
          <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-semibold sticky top-0 z-10 backdrop-blur-md">
            <th className="p-3 border-r border-slate-800/60 min-w-[200px]">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                <span>Title</span>
              </div>
            </th>
            <th className="p-3 border-r border-slate-800/60 min-w-[140px]">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400" />
                <span>Tags</span>
              </div>
            </th>
            {properties.map((prop) => (
              <th key={prop} className="p-3 border-r border-slate-800/60 min-w-[130px]">
                <div className="flex items-center justify-between">
                  <span className="capitalize">{prop}</span>
                  <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100 cursor-pointer" />
                </div>
              </th>
            ))}
            <th className="p-2 min-w-[80px]">
              {showAddPropInput ? (
                <form onSubmit={handleAddPropertySubmit} className="flex items-center gap-1">
                  <input
                    type="text"
                    placeholder="Prop name"
                    value={newPropName}
                    onChange={(e) => setNewPropName(e.target.value)}
                    autoFocus
                    className="px-2 py-0.5 text-[11px] bg-slate-950 border border-sky-500 rounded text-slate-200 focus:outline-none w-24"
                  />
                  <button type="submit" className="text-[10px] px-1.5 py-0.5 bg-sky-600 rounded text-white font-medium">
                    Add
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setShowAddPropInput(true)}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Column</span>
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {documents.map((doc) => (
            <tr key={doc.path} className="hover:bg-slate-900/50 group transition-colors">
              {/* Title Cell */}
              <td
                onClick={() => onNavigate(doc.path)}
                className="p-3 border-r border-slate-800/40 cursor-pointer font-medium text-slate-200 group-hover:text-sky-400"
              >
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0" />
                  <span className="truncate">{doc.title}</span>
                </div>
              </td>

              {/* Tags Cell */}
              <td className="p-3 border-r border-slate-800/40">
                <div className="flex flex-wrap gap-1">
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/50"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </td>

              {/* Dynamic Property Cells */}
              {properties.map((prop) => {
                const val = doc.properties?.[prop];
                const isEditing = editingCell?.path === doc.path && editingCell?.key === prop;

                return (
                  <td
                    key={prop}
                    onDoubleClick={() => startEditing(doc, prop)}
                    className="p-3 border-r border-slate-800/40 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEditing}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditing();
                          if (e.key === 'Escape') setEditingCell(null);
                        }}
                        autoFocus
                        className="w-full px-1.5 py-0.5 text-xs bg-slate-950 border border-sky-500 rounded text-slate-100 focus:outline-none"
                      />
                    ) : (
                      <div className="truncate text-slate-300">
                        {val === undefined || val === null ? (
                          <span className="text-slate-600 italic">-</span>
                        ) : typeof val === 'boolean' ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              val
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                                : 'bg-rose-950/60 text-rose-300 border border-rose-800/50'
                            }`}
                          >
                            {val ? 'TRUE' : 'FALSE'}
                          </span>
                        ) : Array.isArray(val) ? (
                          val.join(', ')
                        ) : (
                          String(val)
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
              <td className="p-3"></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
