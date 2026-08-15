import React, { useState } from 'react';
import { ParsedDocument } from '@okw/core';
import {
  Tag,
  Sliders,
  Calendar,
  Hash,
  Type,
  CheckSquare,
  List,
  Plus,
  Trash2,
} from 'lucide-react';

interface PropertiesPanelProps {
  parsedDoc: ParsedDocument | null;
  allTags: Map<string, number>;
  onSelectTag?: (tag: string) => void;
  onUpdateProperties?: (properties: Record<string, any>) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  parsedDoc,
  allTags,
  onSelectTag,
  onUpdateProperties,
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'tags'>('properties');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [newType, setNewType] = useState<'text' | 'number' | 'boolean' | 'date'>('text');
  const [isAdding, setIsAdding] = useState(false);

  const properties = parsedDoc?.properties || {};

  // Infer property icon / type
  const getPropertyIcon = (val: any) => {
    if (typeof val === 'boolean') return <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />;
    if (typeof val === 'number') return <Hash className="w-3.5 h-3.5 text-sky-400" />;
    if (Array.isArray(val)) return <List className="w-3.5 h-3.5 text-purple-400" />;
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      return <Calendar className="w-3.5 h-3.5 text-amber-400" />;
    }
    return <Type className="w-3.5 h-3.5 text-slate-400" />;
  };

  const handleAddProperty = () => {
    if (!newKey.trim()) return;
    let parsedVal: any = newVal;
    if (newType === 'number') parsedVal = Number(newVal) || 0;
    if (newType === 'boolean') parsedVal = newVal.toLowerCase() === 'true';

    const updated = { ...properties, [newKey.trim()]: parsedVal };
    onUpdateProperties?.(updated);
    setNewKey('');
    setNewVal('');
    setIsAdding(false);
  };

  const handleDeleteProperty = (key: string) => {
    const updated = { ...properties };
    delete updated[key];
    onUpdateProperties?.(updated);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-200">
      {/* Header Tabs */}
      <div className="flex items-center border-b border-slate-800 px-3 py-2 bg-slate-950/50">
        <div className="flex items-center gap-1 bg-slate-800/60 p-0.5 rounded-md text-xs">
          <button
            onClick={() => setActiveTab('properties')}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'properties'
                ? 'bg-sky-500/20 text-sky-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Properties
          </button>
          <button
            onClick={() => setActiveTab('tags')}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'tags'
                ? 'bg-purple-500/20 text-purple-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            Tags ({allTags.size})
          </button>
        </div>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'properties' && (
          <div className="space-y-3">
            {/* Note Metadata Overview */}
            {parsedDoc ? (
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Document Metadata
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-400">Words: <span className="text-slate-200 font-mono">{parsedDoc.wordCount}</span></div>
                  <div className="text-slate-400">Lines: <span className="text-slate-200 font-mono">{parsedDoc.lineCount}</span></div>
                  {parsedDoc.aliases && parsedDoc.aliases.length > 0 && (
                    <div className="col-span-2 text-slate-400">
                      Aliases: <span className="text-sky-300">{parsedDoc.aliases.join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic">No active note selected</div>
            )}

            {/* Frontmatter Key-Value List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Frontmatter Fields</span>
                <button
                  onClick={() => setIsAdding(!isAdding)}
                  className="p-1 rounded text-sky-400 hover:bg-slate-800 flex items-center gap-1 text-[11px]"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              {/* Add Property Form */}
              {isAdding && (
                <div className="bg-slate-950 border border-sky-500/40 rounded-lg p-2.5 space-y-2 text-xs">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Property name"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                    />
                    <select
                      value={newType}
                      onChange={(e: any) => setNewType(e.target.value)}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="date">Date</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Value"
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                    />
                    <button
                      onClick={handleAddProperty}
                      className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* Rendered Properties */}
              {Object.keys(properties).length === 0 ? (
                <div className="text-xs text-slate-500 italic py-2">No frontmatter properties defined</div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(properties).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between p-2 rounded-md bg-slate-950/40 border border-slate-800/80 hover:border-slate-700 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getPropertyIcon(val)}
                        <span className="text-slate-300 font-medium truncate">{key}:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-mono truncate max-w-[120px]">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                        <button
                          onClick={() => handleDeleteProperty(key)}
                          className="text-slate-600 hover:text-rose-400 p-0.5"
                          title="Delete property"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tags Hierarchy Explorer */}
        {activeTab === 'tags' && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Vault Tags</div>
            {allTags.size === 0 ? (
              <div className="text-xs text-slate-500 italic py-2">No tags found across vault notes</div>
            ) : (
              <div className="space-y-1">
                {Array.from(allTags.entries()).map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => onSelectTag?.(tag)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-slate-950/40 border border-slate-800/80 hover:border-purple-500/40 hover:bg-purple-950/20 text-xs group transition-colors"
                  >
                    <div className="flex items-center gap-2 text-purple-300 font-medium">
                      <Tag className="w-3.5 h-3.5 text-purple-400" />
                      #{tag}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-900/40 text-purple-300 border border-purple-800/40">
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
