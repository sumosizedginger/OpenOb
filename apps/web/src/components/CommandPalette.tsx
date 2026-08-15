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

  const notes = entries.filter((e) => !e.isDirectory && (e.path.endsWith('.md') || e.path.endsWith('.markdown')));

  const filteredNotes = notes.filter((n) =>
    n.path.toLowerCase().includes(query.toLowerCase()) ||
    n.name.toLowerCase().includes(query.toLowerCase())
  );

  const actions = [
    {
      id: 'create-note',
      title: 'Create New Note',
      sub: 'Create a new markdown note at vault root',
      icon: <Plus size={15} color="var(--accent-primary)" />,
      run: () => {
        onCreateNote();
        onClose();
      },
    },
    {
      id: 'create-folder',
      title: 'Create New Folder',
      sub: 'Create a directory for organizing notes',
      icon: <FolderPlus size={15} color="#fbbf24" />,
      run: () => {
        onCreateFolder();
        onClose();
      },
    },
    {
      id: 'rebuild-index',
      title: 'Rebuild Derived Index',
      sub: 'Reconstruct full-text search and backlink indexes from files',
      icon: <RefreshCw size={15} color="var(--status-info)" />,
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
    } else if (e.key === 'Enter') {
      if (filteredNotes.length > 0) {
        onOpenNote(filteredNotes[selectedIndex % filteredNotes.length].path);
        onClose();
      } else if (filteredActions.length > 0) {
        filteredActions[0].run();
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-input-wrapper">
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            className="command-input"
            placeholder="Type a note name or command... (Esc to close)"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="command-list">
          {filteredNotes.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', padding: '6px 12px' }}>
                NOTES ({filteredNotes.length})
              </div>
              {filteredNotes.map((note, index) => (
                <div
                  key={note.path}
                  className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => {
                    onOpenNote(note.path);
                    onClose();
                  }}
                >
                  <div className="command-item-left">
                    <FileText size={15} color="var(--accent-primary)" />
                    <div>
                      <div className="command-item-title">{note.name.replace(/\.md$/, '')}</div>
                      <div className="command-item-sub">{note.path}</div>
                    </div>
                  </div>
                  <span className="command-badge">Open</span>
                </div>
              ))}
            </div>
          )}

          {filteredActions.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', padding: '6px 12px' }}>
                ACTIONS
              </div>
              {filteredActions.map((act) => (
                <div key={act.id} className="command-item" onClick={act.run}>
                  <div className="command-item-left">
                    {act.icon}
                    <div>
                      <div className="command-item-title">{act.title}</div>
                      <div className="command-item-sub">{act.sub}</div>
                    </div>
                  </div>
                  <span className="command-badge">Action</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
