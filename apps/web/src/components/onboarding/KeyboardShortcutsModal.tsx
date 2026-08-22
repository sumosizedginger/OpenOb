/**
 * apps/web/src/components/onboarding/KeyboardShortcutsModal.tsx
 * Keyboard shortcuts cheat sheet for OpenOb.
 */

import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  key: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation & Search',
    items: [
      { key: 'Ctrl+P', description: 'Quick Open note finder' },
      { key: 'Ctrl+Shift+P', description: 'Command Palette' },
      { key: 'Ctrl+G', description: 'Global Graph View' },
      { key: 'Ctrl+N', description: 'Create new note' },
      { key: 'Ctrl+\\', description: 'Toggle left file sidebar' },
    ],
  },
  {
    title: 'Editor & Layout',
    items: [
      { key: 'Ctrl+S', description: 'Save current note immediately' },
      { key: 'Ctrl+E', description: 'Cycle view mode (Editor / Split / Preview)' },
      { key: 'Ctrl+W', description: 'Close active tab' },
      { key: 'F2', description: 'Rename active or selected note' },
    ],
  },
  {
    title: 'General & Dialogs',
    items: [
      { key: 'Escape', description: 'Close modals, drawers, or active tour' },
      { key: 'Arrow Keys', description: 'Navigate lists, file tree, and menus' },
      { key: 'Enter', description: 'Confirm selection or next tour step' },
    ],
  },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay shortcuts-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="modal-container shortcuts-modal-container">
        <div className="shortcuts-modal-header">
          <div className="shortcuts-title-group">
            <Keyboard size={20} className="text-accent" />
            <h2 id="shortcuts-title" className="shortcuts-title">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close shortcuts"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3 className="shortcuts-group-title">{group.title}</h3>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.key} className="shortcuts-row">
                    <span className="shortcuts-desc">{item.description}</span>
                    <kbd className="shortcuts-key">{item.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
