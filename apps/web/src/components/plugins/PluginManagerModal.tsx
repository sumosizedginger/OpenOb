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

  const getPermissionBadgeClass = (perm: PluginPermission) => {
    switch (perm) {
      case 'vault.write':
      case 'vault.delete':
        return 'bg-amber-950/80 text-amber-300 border-amber-800';
      case 'workspace.modify':
      case 'editor.extend':
        return 'bg-purple-950/80 text-purple-300 border-purple-800';
      case 'ai.use':
        return 'bg-sky-950/80 text-sky-300 border-sky-800';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-950 rounded-xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col max-h-[85vh]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Plugin Manager</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plugin List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {plugins.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">No plugins installed.</div>
          ) : (
            plugins.map((inst) => (
              <div
                key={inst.manifest.id}
                className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3 hover:border-slate-700 transition-colors"
              >
                {/* Title & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-100">
                        {inst.manifest.name}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                        v{inst.manifest.version}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{inst.manifest.description}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {inst.status === 'error' && (
                      <button
                        onClick={() => handleRestart(inst.manifest.id)}
                        className="px-2 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700 rounded text-xs flex items-center gap-1"
                        title="Restart Plugin"
                      >
                        <RotateCw className="w-3 h-3" /> Restart
                      </button>
                    )}

                    <button
                      onClick={() => handleToggle(inst)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        inst.status === 'enabled'
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : inst.status === 'error'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
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
                  <div className="p-2.5 rounded bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Plugin Crashed:</span> {inst.error}
                    </div>
                  </div>
                )}

                {/* Declared Permissions (Constitution Law 20) */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Shield className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[11px] text-slate-400">Permissions:</span>
                    {inst.manifest.permissions.length === 0 ? (
                      <span className="text-[11px] text-slate-500">None required</span>
                    ) : (
                      inst.manifest.permissions.map((perm) => (
                        <span
                          key={perm}
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${getPermissionBadgeClass(
                            perm
                          )}`}
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
      </div>
    </div>
  );
};
