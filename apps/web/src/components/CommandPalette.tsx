import React, { useEffect, useState } from 'react';
import { VaultEntry, VaultPath } from '@okw/core';
import { Search, FileText, Plus, FolderPlus, RefreshCw, X } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  entries: VaultEntry[];
  onClose: () => void;
  onOpenNote: (path: VaultPath) => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  entries,
  onClose,
  onOpenNote,
  onCreateNote,
  onCreateFolder,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const notes = entries.filter(
    (e) => !e.isDirectory && (e.path.endsWith('.md') || e.path.endsWith('.markdown'))
  );

  const filteredNotes = notes.filter(
    (n) =>
      n.path.toLowerCase().includes(query.toLowerCase()) ||
      n.name.toLowerCase().includes(query.toLowerCase())
  );

  const actions = [
    {
      id: 'create-note',
      title: 'Create New Note',
      sub: 'Create a new markdown note at vault root',
      icon: <Plus size={14} style={{ color: 'var(--accent-primary)' }} />,
      run: () => {
        onCreateNote();
        onClose();
      },
    },
    {
      id: 'create-folder',
      title: 'Create New Folder',
      sub: 'Create a directory for organizing notes',
      icon: <FolderPlus size={14} style={{ color: '#d97706' }} />,
      run: () => {
        onCreateFolder();
        onClose();
      },
    },
    {
      id: 'rebuild-index',
      title: 'Rebuild Derived Index',
      sub: 'Reconstruct full-text search and backlink indexes from files',
      icon: <RefreshCw size={14} style={{ color: 'var(--status-info)' }} />,
      run: () => {
        onRefresh();
        onClose();
      },
    },
  ];

  const filteredActions = query.trim()
    ? actions.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
    : actions;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const total = filteredNotes.length + filteredActions.length;
      if (total > 0) setSelectedIndex((prev) => (prev + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const total = filteredNotes.length + filteredActions.length;
      if (total > 0) setSelectedIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === 'Enter') {
      if (selectedIndex < filteredNotes.length) {
        onOpenNote(filteredNotes[selectedIndex].path);
        onClose();
      } else {
        const actionIdx = selectedIndex - filteredNotes.length;
        if (filteredActions[actionIdx]) {
          filteredActions[actionIdx].run();
        }
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-input-wrapper">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="command-input"
            placeholder="Type a note name or action..."
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button className="btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="command-list">
          {filteredNotes.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  padding: '4px 10px',
                  letterSpacing: '0.02em',
                }}
              >
                NOTES ({filteredNotes.length})
              </div>
              {filteredNotes.map((note, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={note.path}
                    className={`command-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onOpenNote(note.path);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <FileText
                        size={14}
                        style={{
                          color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="command-item-title">{note.name.replace(/\.md$/, '')}</div>
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {note.path}
                        </div>
                      </div>
                    </div>
                    <span className="command-badge">Note</span>
                  </div>
                );
              })}
            </div>
          )}

          {filteredActions.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  padding: '4px 10px',
                  letterSpacing: '0.02em',
                }}
              >
                ACTIONS
              </div>
              {filteredActions.map((act, idx) => {
                const globalIdx = filteredNotes.length + idx;
                const isSelected = globalIdx === selectedIndex;
                return (
                  <div
                    key={act.id}
                    className={`command-item ${isSelected ? 'selected' : ''}`}
                    onClick={act.run}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {act.icon}
                      <div>
                        <div className="command-item-title">{act.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {act.sub}
                        </div>
                      </div>
                    </div>
                    <span className="command-badge">Action</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
