import React from 'react';
import { VaultPath } from '@okw/core';
import { AlertTriangle, RefreshCw, Check, X } from 'lucide-react';

interface ConflictModalProps {
  path: VaultPath;
  diskContent?: string;
  myContent: string;
  onReload: () => void;
  onForceOverwrite: () => void;
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  path,
  diskContent,
  myContent,
  onReload,
  onForceOverwrite,
  onClose,
}) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px' }}
      >
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--status-danger)' }}>
            <AlertTriangle size={18} /> External Modification Detected
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: '14px' }}>
            The file <strong>"{path}"</strong> was modified outside this editor (or concurrently).
            To protect your data from being silently overwritten, please choose how to resolve this
            conflict:
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                background: 'var(--bg-tertiary)',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                }}
              >
                CURRENT DISK VERSION
              </div>
              <pre
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  fontSize: '11px',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                }}
              >
                {diskContent || '(Unable to read disk content)'}
              </pre>
            </div>

            <div
              style={{
                background: 'var(--bg-tertiary)',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--accent-primary)',
                  marginBottom: '4px',
                }}
              >
                YOUR UNSAVED EDITOR BUFFER
              </div>
              <pre
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  fontSize: '11px',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                }}
              >
                {myContent}
              </pre>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onReload}>
            <RefreshCw size={13} /> Discard My Edits & Reload from Disk
          </button>
          <button
            className="btn btn-primary"
            style={{ backgroundColor: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
            onClick={onForceOverwrite}
          >
            <Check size={13} /> Overwrite Disk with My Version
          </button>
        </div>
      </div>
    </div>
  );
};
