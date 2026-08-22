import React, { useState, useEffect } from 'react';
import { Server, Key, X, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

interface GatewayConnectModalProps {
  isOpen: boolean;
  currentUrl?: string;
  isConnected: boolean;
  onConnect: (url: string, token?: string) => Promise<{ success: boolean; error?: string }>;
  onDisconnect?: () => Promise<{ success: boolean; cancelled?: boolean } | void> | void;
  onClose: () => void;
}

export const GatewayConnectModal: React.FC<GatewayConnectModalProps> = ({
  isOpen,
  currentUrl = 'http://127.0.0.1:4200',
  isConnected,
  onConnect,
  onDisconnect,
  onClose,
}) => {
  const [url, setUrl] = useState(currentUrl);
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setIsLoading(false);
      // Auto-detect same-origin default if served over HTTP loopback
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const origin = window.location.origin;
        if (
          origin.startsWith('http://127.0.0.1') ||
          origin.startsWith('http://localhost') ||
          origin.startsWith('http://[::1]')
        ) {
          setUrl(origin);
        }
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);

    const res = await onConnect(url.trim(), token.trim() || undefined);
    setIsLoading(false);

    if (res.success) {
      onClose();
    } else {
      setErrorMsg(res.error || 'Failed to connect to gateway');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog gateway-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Server size={16} style={{ color: 'var(--accent-primary)' }} />
            <span>Connect to OpenOb Gateway</span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Connect to a running local OpenOb Gateway. In Gateway Mode, the app acts as a pure
              REST client with zero direct disk writes, sharing authoritative concurrency control
              with external agents and tools.
            </p>

            {errorMsg && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: 'var(--status-danger)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '14px',
                }}
              >
                <AlertCircle size={15} />
                <span>{errorMsg}</span>
              </div>
            )}

            {isConnected && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: 'var(--status-success)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '14px',
                }}
              >
                <CheckCircle2 size={15} />
                <span>Currently connected to {currentUrl}</span>
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Gateway URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://127.0.0.1:4200"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-canvas)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  outline: 'none',
                }}
                required
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                <Key size={12} />
                Gateway Token (Optional)
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter authorization token"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-canvas)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                Tokens are kept only in session memory and never leaked into file storage or URLs.
              </span>
            </div>
          </div>

          <div className="modal-footer">
            {isConnected && onDisconnect && (
              <button
                type="button"
                className="btn btn-disconnect"
                onClick={async () => {
                  const res = await onDisconnect();
                  if (res && res.cancelled) return;
                  onClose();
                }}
                style={{ marginRight: 'auto' }}
              >
                Switch to Local Mode
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isLoading || !url.trim()}>
              {isLoading && <RefreshCw size={13} className="spin" />}
              <span>{isLoading ? 'Connecting...' : isConnected ? 'Reconnect' : 'Connect'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
