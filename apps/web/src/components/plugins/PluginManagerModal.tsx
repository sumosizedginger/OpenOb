import React, { useState } from 'react';
import { PluginHost, PluginInstance, PluginPermission } from '@okw/plugin';
import { Boxes, X, Shield, AlertTriangle, RotateCw, Power } from 'lucide-react';

interface PluginManagerModalProps {
  isOpen: boolean;
  pluginHost: PluginHost;
  onClose: () => void;
  onRefresh: () => void;
}

export const PluginManagerModal: React.FC<PluginManagerModalProps> = ({
  isOpen,
  pluginHost,
  onClose,
  onRefresh,
}) => {
  const [plugins, setPlugins] = useState<PluginInstance[]>(() => pluginHost.getPlugins());

  if (!isOpen) return null;

  const refreshList = () => {
    setPlugins([...pluginHost.getPlugins()]);
    onRefresh();
  };

  const handleToggle = async (inst: PluginInstance) => {
    if (inst.status === 'enabled') {
      await pluginHost.disablePlugin(inst.manifest.id);
    } else {
      await pluginHost.enablePlugin(inst.manifest.id);
    }
    refreshList();
  };

  const handleRestart = async (pluginId: string) => {
    await pluginHost.restartPlugin(pluginId);
    refreshList();
  };

  const getPermissionBadgeStyle = (perm: PluginPermission): React.CSSProperties => {
    switch (perm) {
      case 'vault.write':
      case 'vault.delete':
        return {
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          color: 'var(--status-warning)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
        };
      case 'workspace.modify':
      case 'editor.extend':
        return {
          backgroundColor: 'var(--surface-selected)',
          color: 'var(--accent-primary)',
          border: '1px solid var(--border-focus)',
        };
      case 'ai.use':
        return {
          backgroundColor: 'rgba(56, 189, 248, 0.12)',
          color: 'var(--status-info)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
        };
      default:
        return {
          backgroundColor: 'var(--surface-canvas)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-subtle)',
        };
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px' }}
      >
        {/* Top Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Boxes size={18} style={{ color: 'var(--accent-primary)' }} />
            <span>Plugin Manager</span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Plugin List */}
        <div
          className="modal-body"
          style={{
            maxHeight: '60vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {plugins.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 0',
                color: 'var(--text-muted)',
                fontSize: '13px',
              }}
            >
              No plugins registered.
            </div>
          ) : (
            plugins.map((inst) => (
              <div
                key={inst.manifest.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-lg)',
                  backgroundColor: 'var(--surface-canvas)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {/* Title & Status */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}
                      >
                        {inst.manifest.name}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--surface-sidebar)',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        v{inst.manifest.version}
                      </span>
                    </div>
                    <p
                      style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}
                    >
                      {inst.manifest.description}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {inst.status === 'error' && (
                      <button
                        onClick={() => handleRestart(inst.manifest.id)}
                        className="btn"
                        style={{
                          padding: '3px 8px',
                          fontSize: '11px',
                          color: 'var(--status-warning)',
                        }}
                        title="Restart Plugin"
                      >
                        <RotateCw size={11} /> Restart
                      </button>
                    )}

                    <button
                      onClick={() => handleToggle(inst)}
                      className={`btn ${inst.status === 'enabled' ? 'btn-primary' : 'btn-ghost'}`}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor:
                          inst.status === 'enabled'
                            ? 'var(--status-success)'
                            : inst.status === 'error'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : 'var(--surface-sidebar)',
                        borderColor:
                          inst.status === 'enabled'
                            ? 'var(--status-success)'
                            : 'var(--border-subtle)',
                      }}
                    >
                      <Power size={12} />
                      <span>
                        {inst.status === 'enabled'
                          ? 'Enabled'
                          : inst.status === 'error'
                            ? 'Error'
                            : 'Disabled'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Error Message if Crashed */}
                {inst.status === 'error' && inst.error && (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      fontSize: '12px',
                      color: 'var(--status-danger)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    <div>
                      <span style={{ fontWeight: 600 }}>Plugin Crashed:</span> {inst.error}
                    </div>
                  </div>
                )}

                {/* Declared Permissions (Constitution Law 20) */}
                <div
                  style={{
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
                  >
                    <Shield size={12} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>Permissions:</span>
                    {inst.manifest.permissions.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>None required</span>
                    ) : (
                      inst.manifest.permissions.map((perm) => (
                        <span
                          key={perm}
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontFamily: 'var(--font-mono)',
                            ...getPermissionBadgeStyle(perm),
                          }}
                        >
                          {perm}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
