import React, { useState } from 'react';
import { ParsedDocument } from '@okw/core';
import { Tag, Sliders, Calendar, Hash, Type, CheckSquare, List, Plus, Trash2 } from 'lucide-react';

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

  const getPropertyIcon = (val: any) => {
    if (typeof val === 'boolean')
      return <CheckSquare size={13} style={{ color: 'var(--status-success)' }} />;
    if (typeof val === 'number') return <Hash size={13} style={{ color: 'var(--status-info)' }} />;
    if (Array.isArray(val)) return <List size={13} style={{ color: 'var(--accent-primary)' }} />;
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      return <Calendar size={13} style={{ color: 'var(--status-warning)' }} />;
    }
    return <Type size={13} style={{ color: 'var(--text-muted)' }} />;
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', userSelect: 'none' }}>
      {/* Header Tabs */}
      <div style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="view-mode-group" style={{ width: '100%' }}>
          <button
            onClick={() => setActiveTab('properties')}
            className={`view-mode-btn ${activeTab === 'properties' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Sliders size={12} />
            <span>Properties</span>
          </button>
          <button
            onClick={() => setActiveTab('tags')}
            className={`view-mode-btn ${activeTab === 'tags' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Tag size={12} />
            <span>Tags ({allTags.size})</span>
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {activeTab === 'properties' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Metadata Card */}
            {parsedDoc ? (
              <div
                style={{
                  backgroundColor: 'var(--surface-canvas)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  DOCUMENT METADATA
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '4px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Words:{' '}
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {parsedDoc.wordCount}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Lines:{' '}
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {parsedDoc.lineCount}
                    </span>
                  </div>
                  {parsedDoc.aliases && parsedDoc.aliases.length > 0 && (
                    <div style={{ gridColumn: 'span 2', color: 'var(--text-secondary)' }}>
                      Aliases:{' '}
                      <span style={{ color: 'var(--accent-primary)' }}>
                        {parsedDoc.aliases.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '12px',
                }}
              >
                No active note selected
              </div>
            )}

            {/* Frontmatter Key-Value List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  FRONTMATTER FIELDS
                </span>
                <button
                  onClick={() => setIsAdding(!isAdding)}
                  className="btn-ghost"
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    color: 'var(--accent-primary)',
                  }}
                >
                  <Plus size={11} /> Add
                </button>
              </div>

              {/* Add Property Form */}
              {isAdding && (
                <div
                  style={{
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="text"
                      placeholder="Property name"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        padding: '4px 6px',
                        backgroundColor: 'var(--surface-canvas)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                    <select
                      value={newType}
                      onChange={(e: any) => setNewType(e.target.value)}
                      style={{
                        fontSize: '12px',
                        padding: '4px 6px',
                        backgroundColor: 'var(--surface-canvas)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="date">Date</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="text"
                      placeholder="Value"
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        padding: '4px 6px',
                        backgroundColor: 'var(--surface-canvas)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={handleAddProperty}
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '4px 10px', height: '26px' }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* Rendered Properties */}
              {Object.keys(properties).length === 0 ? (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                    padding: '8px 0',
                  }}
                >
                  No frontmatter properties defined
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {Object.entries(properties).map(([key, val]) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '5px 8px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-canvas)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '12px',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}
                      >
                        {getPropertyIcon(val)}
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {key}:
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-mono)',
                            maxWidth: '120px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                        <button
                          onClick={() => handleDeleteProperty(key)}
                          className="btn-icon"
                          style={{ width: '18px', height: '18px' }}
                          title="Delete property"
                        >
                          <Trash2 size={11} style={{ color: 'var(--text-muted)' }} />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                letterSpacing: '0.02em',
              }}
            >
              VAULT TAGS
            </div>
            {allTags.size === 0 ? (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  padding: '8px 0',
                }}
              >
                No tags found across vault notes
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {Array.from(allTags.entries()).map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => onSelectTag?.(tag)}
                    className="tree-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--accent-primary)',
                        fontWeight: 500,
                        fontSize: '12px',
                      }}
                    >
                      <Tag size={12} />
                      <span>#{tag}</span>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--surface-selected)',
                        color: 'var(--accent-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
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
