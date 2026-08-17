import React, { useState, useEffect } from 'react';
import { Server, Key, X, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

interface GatewayConnectModalProps {
  isOpen: boolean;
  currentUrl?: string;
  isConnected: boolean;
  onConnect: (url: string, token?: string) => Promise<{ success: boolean; error?: string }>;
  onDisconnect?: () => void;
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
      <div className="modal-content gateway-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div
            className="modal-title"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Server size={18} color="var(--accent-primary)" />
            <span>Connect to OpenOb Gateway</span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p
            className="modal-description"
            style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}
          >
            Connect to a running local OpenOb Gateway. In Gateway Mode, the browser acts as a pure
            REST client with zero direct disk writes, sharing authoritative concurrency control with
            external agents and tools.
          </p>

          {errorMsg && (
            <div
              className="error-alert"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {isConnected && (
            <div
              className="success-alert"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              <CheckCircle2 size={16} />
              <span>Currently connected to {currentUrl}</span>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
            >
              Gateway URL
            </label>
            <input
              type="text"
              className="form-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:4200"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '6px',
              }}
            >
              <Key size={12} />
              Gateway Token (Optional / If Required)
            </label>
            <input
              type="password"
              className="form-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter authorization bearer token"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                marginTop: '4px',
                display: 'block',
              }}
            >
              Tokens are stored only in session memory and never persisted to permanent local
              storage or rendered in URLs.
            </span>
          </div>

          <div
            className="modal-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}
          >
            {isConnected && onDisconnect && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  marginRight: 'auto',
                }}
              >
                Switch to Local Mode
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isLoading || !url.trim()}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: '#fff',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isLoading && <RefreshCw size={14} className="spin" />}
              <span>{isLoading ? 'Connecting...' : isConnected ? 'Reconnect' : 'Connect'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
