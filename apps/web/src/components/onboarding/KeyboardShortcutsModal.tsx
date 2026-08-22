/**
 * apps/web/src/components/onboarding/KeyboardShortcutsModal.tsx
 * Keyboard shortcuts cheat sheet for OpenOb.
 */

import React from 'react';
import { Keyboard, X } from 'lucide-react';

import { KEYBOARD_SHORTCUTS } from '../../onboarding/keyboardShortcuts.js';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
          {KEYBOARD_SHORTCUTS.map((group) => (
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
