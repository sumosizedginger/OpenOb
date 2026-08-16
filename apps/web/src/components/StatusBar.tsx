import React from 'react';
import { ParsedDocument, VaultPath } from '@okw/core';
import { CheckCircle2, AlertTriangle, RefreshCw, HardDrive, FileEdit } from 'lucide-react';

interface StatusBarProps {
  vaultName: string;
  activePath: VaultPath | null;
  parsedDoc: ParsedDocument | null;
  saveStatus: 'saved' | 'saving' | 'modified' | 'conflict';
  onSave: () => void;
  onOpenConflictModal?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  vaultName,
  activePath,
  parsedDoc,
  saveStatus,
  onSave,
  onOpenConflictModal,
}) => {
  return (
    <div className="status-bar">
      <div className="status-left">
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <HardDrive size={12} color="var(--accent-primary)" />
          {vaultName}
        </span>
        {activePath && <span style={{ color: 'var(--text-secondary)' }}>{activePath}</span>}
      </div>

      <div className="status-right">
        {parsedDoc && (
          <>
            <span>{parsedDoc.lineCount} lines</span>
            <span>{parsedDoc.wordCount} words</span>
            <span>{parsedDoc.links.length} links</span>
          </>
        )}

        {saveStatus === 'saved' && (
          <span className="save-status saved">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
        {saveStatus === 'saving' && (
          <span className="save-status saving">
            <RefreshCw size={12} className="spin" /> Saving...
          </span>
        )}
        {saveStatus === 'modified' && (
          <span
            className="save-status"
            style={{ color: 'var(--accent-primary)', cursor: 'pointer' }}
            onClick={onSave}
            title="Click to Safe Save (Ctrl+S)"
          >
            <FileEdit size={12} /> Modified (Ctrl+S to save)
          </span>
        )}
        {saveStatus === 'conflict' && (
          <span
            className="save-status conflict"
            style={{ cursor: 'pointer' }}
            onClick={onOpenConflictModal}
            title="External modification detected! Click to resolve."
          >
            <AlertTriangle size={12} /> External Conflict!
          </span>
        )}
      </div>
    </div>
  );
};
