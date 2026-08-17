import React from 'react';
import { ParsedDocument, VaultPath } from '@okw/core';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  HardDrive,
  FileEdit,
  Server,
  ServerOff,
  Lock,
  WifiOff,
  AlertCircle,
} from 'lucide-react';

interface StatusBarProps {
  vaultName: string;
  vaultMode: 'memory' | 'fsa' | 'gateway';
  isReadOnly?: boolean;
  gatewayReachable?: boolean;
  activePath: VaultPath | null;
  parsedDoc: ParsedDocument | null;
  saveStatus: 'saved' | 'saving' | 'modified' | 'conflict' | 'disconnected';
  onSave: () => void;
  onOpenConflictModal?: () => void;
  onOpenGatewayModal?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  vaultName,
  vaultMode,
  isReadOnly = false,
  gatewayReachable = true,
  activePath,
  parsedDoc,
  saveStatus,
  onSave,
  onOpenConflictModal,
  onOpenGatewayModal,
}) => {
  const isDisconnected =
    vaultMode === 'gateway' && (!gatewayReachable || saveStatus === 'disconnected');

  return (
    <div className="status-bar">
      <div className="status-left">
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            cursor: onOpenGatewayModal ? 'pointer' : 'default',
          }}
          onClick={onOpenGatewayModal}
          title={
            vaultMode === 'gateway'
              ? isDisconnected
                ? 'OpenOb Gateway is unreachable / disconnected'
                : `Connected to OpenOb Gateway (${isReadOnly ? 'Read-Only' : 'Writable'})`
              : `Local Vault Mode (${vaultMode.toUpperCase()})`
          }
        >
          {vaultMode === 'gateway' ? (
            isDisconnected ? (
              <ServerOff size={12} color="#ef4444" />
            ) : (
              <Server size={12} color="var(--accent-primary)" />
            )
          ) : (
            <HardDrive size={12} color="var(--accent-primary)" />
          )}
          <span style={{ fontWeight: 600 }}>
            {vaultMode === 'gateway' ? `Gateway: ${vaultName}` : vaultName}
          </span>
          {vaultMode === 'gateway' && isDisconnected && (
            <span
              className="badge-disconnected"
              style={{
                fontSize: '10px',
                padding: '1px 4px',
                borderRadius: '3px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                fontWeight: 600,
              }}
            >
              <WifiOff size={9} /> Disconnected
            </span>
          )}
          {isReadOnly && !isDisconnected && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 4px',
                borderRadius: '3px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <Lock size={9} /> Read-Only
            </span>
          )}
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

        {saveStatus === 'disconnected' && (
          <span
            className="save-status disconnected"
            style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            title="Gateway is unreachable. Changes are held in memory."
          >
            <AlertCircle size={12} /> Disconnected
          </span>
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
