import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, HardDrive, GitCommit, Info, Cpu } from 'lucide-react';
import type { DesktopAppInfo } from '@okw/desktop';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);

  useEffect(() => {
    if (isOpen && typeof window !== 'undefined' && window.openobDesktop) {
      window.openobDesktop
        .getAppInfo()
        .then(setAppInfo)
        .catch((err) => console.warn('Failed to load desktop app info:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const version = appInfo?.version || '0.1.0-rc1';
  const sha = appInfo?.buildSha || '3d61b8a';
  const isClean = appInfo?.sourceClean ?? true;
  const platform =
    appInfo?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'web');
  const storageStatus = appInfo?.storageStatus || 'web-local';

  const fullVersionString = `${version} (${sha.slice(0, 7)}${isClean ? '' : '-dirty'})`;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          width: '460px',
          maxWidth: '90vw',
          backgroundColor: 'var(--surface-elevated, #1e1e2e)',
          borderRadius: '12px',
          border: '1px solid var(--border-subtle, #313244)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          padding: '24px',
          color: 'var(--text-primary, #cdd6f4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                color: '#fff',
                fontSize: '18px',
              }}
            >
              O
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>OpenOb</h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted, #a6adc8)' }}>
                Local-First Knowledge Workspace
              </span>
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '20px',
            fontSize: '13px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--surface-base, #181825)',
              borderRadius: '6px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted, #a6adc8)',
              }}
            >
              <Info size={15} /> Version
            </span>
            <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{fullVersionString}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--surface-base, #181825)',
              borderRadius: '6px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted, #a6adc8)',
              }}
            >
              <GitCommit size={15} /> Commit SHA
            </span>
            <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{sha}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--surface-base, #181825)',
              borderRadius: '6px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted, #a6adc8)',
              }}
            >
              <Cpu size={15} /> Platform
            </span>
            <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{platform}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--surface-base, #181825)',
              borderRadius: '6px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted, #a6adc8)',
              }}
            >
              <ShieldCheck size={15} /> Secret Storage
            </span>
            <span style={{ fontWeight: 500 }}>
              {storageStatus === 'ready'
                ? 'OS Encrypted (DPAPI/Keychain)'
                : storageStatus === 'unavailable'
                  ? 'Transient Memory Key'
                  : storageStatus === 'corrupted'
                    ? 'Degraded / Reset'
                    : 'Browser Storage'}
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: '20px',
            padding: '12px',
            borderRadius: '6px',
            background: 'var(--surface-base, #181825)',
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--text-muted, #a6adc8)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
              color: 'var(--text-primary, #cdd6f4)',
            }}
          >
            <HardDrive size={14} /> <strong>Zero Data-Loss Guarantee</strong>
          </div>
          Your Markdown notes are the single canonical truth. Indices and embeddings are strictly
          disposable and can be fully rebuilt anytime.
        </div>

        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
