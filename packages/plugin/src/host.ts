import {
  Plugin,
  PluginCommand,
  PluginHostContext,
  PluginInstance,
  PluginManifest,
  PluginView,
  VALID_PLUGIN_PERMISSIONS,
} from './types.js';
import { createPluginAPI } from './bridge.js';
import { DuplicateContributionError, InvalidManifestError } from './errors.js';

export interface PluginRegistration {
  manifest: PluginManifest;
  factory: () => Plugin;
}

/**
 * Validates a plugin manifest for structural correctness and permitted capabilities.
 */
export function validatePluginManifest(manifest: PluginManifest): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new InvalidManifestError('unknown', 'Manifest must be a non-null object.');
  }

  const { id, name, version, apiVersion, permissions, contributes } = manifest;

  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(id) || id.length > 128) {
    throw new InvalidManifestError(
      id || 'unknown',
      'Plugin ID must be a non-empty alphanumeric string (max 128 chars, dots/dashes/underscores allowed).'
    );
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new InvalidManifestError(id, 'Plugin name must be a non-empty string.');
  }

  if (!version || typeof version !== 'string' || version.trim().length === 0) {
    throw new InvalidManifestError(id, 'Plugin version must be a non-empty string.');
  }

  if (!apiVersion || typeof apiVersion !== 'string' || apiVersion.trim().length === 0) {
    throw new InvalidManifestError(id, 'Plugin apiVersion must be a non-empty string.');
  }

  if (!Array.isArray(permissions)) {
    throw new InvalidManifestError(id, 'Plugin permissions must be an array.');
  }

  const seenPerms = new Set<string>();
  for (const perm of permissions) {
    if (!VALID_PLUGIN_PERMISSIONS.includes(perm as any)) {
      throw new InvalidManifestError(id, `Unknown or unauthorized permission: "${perm}".`);
    }
    if (seenPerms.has(perm)) {
      throw new InvalidManifestError(id, `Duplicate permission declared: "${perm}".`);
    }
    seenPerms.add(perm);
  }

  if (contributes) {
    if (typeof contributes !== 'object') {
      throw new InvalidManifestError(id, 'contributes must be an object.');
    }

    if (contributes.commands) {
      if (!Array.isArray(contributes.commands)) {
        throw new InvalidManifestError(id, 'contributes.commands must be an array.');
      }
      const seenCmds = new Set<string>();
      for (const cmd of contributes.commands) {
        if (!cmd || typeof cmd.id !== 'string' || cmd.id.trim().length === 0) {
          throw new InvalidManifestError(id, 'Declared command must have a non-empty string id.');
        }
        if (seenCmds.has(cmd.id)) {
          throw new InvalidManifestError(id, `Duplicate command ID declared: "${cmd.id}".`);
        }
        seenCmds.add(cmd.id);
      }
    }

    if (contributes.views) {
      if (!Array.isArray(contributes.views)) {
        throw new InvalidManifestError(id, 'contributes.views must be an array.');
      }
      const seenViews = new Set<string>();
      for (const view of contributes.views) {
        if (!view || typeof view.id !== 'string' || view.id.trim().length === 0) {
          throw new InvalidManifestError(id, 'Declared view must have a non-empty string id.');
        }
        if (seenViews.has(view.id)) {
          throw new InvalidManifestError(id, `Duplicate view ID declared: "${view.id}".`);
        }
        seenViews.add(view.id);
      }
    }
  }
}

/**
 * Permission-gated, crash-resilient Plugin Host (Constitution Law 20, F-007).
 * Controls plugin lifecycle, capability gating, contribution safety, and error containment.
 */
export class PluginHost {
  private readonly registrations = new Map<string, PluginRegistration>();
  private readonly instances = new Map<string, PluginInstance>();
  private context: PluginHostContext;

  constructor(context: PluginHostContext) {
    this.context = { ...context };
  }

  updateContext(context: Partial<PluginHostContext>): void {
    this.context = { ...this.context, ...context };
  }

  getContext(): PluginHostContext {
    return this.context;
  }

  registerPlugin(manifest: PluginManifest, factory: () => Plugin): void {
    validatePluginManifest(manifest);

    if (this.registrations.has(manifest.id)) {
      throw new DuplicateContributionError(manifest.id, 'plugin', manifest.id);
    }

    this.registrations.set(manifest.id, { manifest, factory });
    this.instances.set(manifest.id, {
      manifest,
      plugin: null,
      status: 'loaded',
      registeredCommands: [],
      registeredViews: [],
    });
  }

  async enablePlugin(pluginId: string): Promise<boolean> {
    const reg = this.registrations.get(pluginId);
    const inst = this.instances.get(pluginId);

    if (!reg || !inst) {
      return false;
    }

    if (inst.status === 'enabled') {
      return true;
    }

    try {
      const plugin = reg.factory();
      inst.plugin = plugin;
      inst.registeredCommands = [];
      inst.registeredViews = [];

      const onRegisterCommand = (cmd: PluginCommand) => {
        // Collision check across other enabled plugins
        for (const [otherId, otherInst] of this.instances.entries()) {
          if (otherId !== pluginId && otherInst.status === 'enabled') {
            if (otherInst.registeredCommands.some((c) => c.id === cmd.id)) {
              throw new DuplicateContributionError(pluginId, 'command', cmd.id);
            }
          }
        }
      };

      const onRegisterView = (view: PluginView) => {
        // Collision check across other enabled plugins
        for (const [otherId, otherInst] of this.instances.entries()) {
          if (otherId !== pluginId && otherInst.status === 'enabled') {
            if (otherInst.registeredViews.some((v) => v.id === view.id)) {
              throw new DuplicateContributionError(pluginId, 'view', view.id);
            }
          }
        }
      };

      const api = createPluginAPI(
        reg.manifest,
        () => this.context,
        inst.registeredCommands,
        inst.registeredViews,
        onRegisterCommand,
        onRegisterView
      );

      // Safe execution boundary (Law 20, F-007)
      await plugin.onload(api);

      inst.status = 'enabled';
      inst.error = undefined;
      return true;
    } catch (err: any) {
      // Isolate crash within plugin boundary
      inst.status = 'error';
      inst.error = err.message || 'Unknown error during plugin initialization';
      inst.plugin = null;
      inst.registeredCommands = [];
      inst.registeredViews = [];
      return false;
    }
  }

  async disablePlugin(pluginId: string): Promise<boolean> {
    const inst = this.instances.get(pluginId);
    if (!inst || inst.status !== 'enabled') {
      return false;
    }

    try {
      if (inst.plugin && typeof inst.plugin.onunload === 'function') {
        await inst.plugin.onunload();
      }
    } catch (err: any) {
      // Record unload error without crashing host
      console.warn(`Plugin "${pluginId}" threw during onunload:`, err);
    } finally {
      inst.plugin = null;
      inst.status = 'disabled';
      inst.registeredCommands = [];
      inst.registeredViews = [];
    }

    return true;
  }

  async restartPlugin(pluginId: string): Promise<boolean> {
    await this.disablePlugin(pluginId);
    return await this.enablePlugin(pluginId);
  }

  getPlugins(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId);
  }

  getAllCommands(): PluginCommand[] {
    const commands: PluginCommand[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status === 'enabled') {
        commands.push(...inst.registeredCommands);
      }
    }
    return commands;
  }

  getAllViews(): PluginView[] {
    const views: PluginView[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status === 'enabled') {
        views.push(...inst.registeredViews);
      }
    }
    return views;
  }

  async executeCommand(commandId: string): Promise<{ success: boolean; error?: string }> {
    for (const inst of this.instances.values()) {
      if (inst.status === 'enabled') {
        const cmd = inst.registeredCommands.find((c) => c.id === commandId);
        if (cmd) {
          try {
            await cmd.callback();
            return { success: true };
          } catch (err: any) {
            // Contain command execution failure
            return { success: false, error: err.message };
          }
        }
      }
    }
    return { success: false, error: `Command "${commandId}" not found.` };
  }

  renderView(viewId: string, container: HTMLElement): { success: boolean; error?: string } {
    for (const inst of this.instances.values()) {
      if (inst.status === 'enabled') {
        const view = inst.registeredViews.find((v) => v.id === viewId);
        if (view) {
          try {
            view.render(container);
            return { success: true };
          } catch (err: any) {
            if (typeof document !== 'undefined') {
              const errEl = document.createElement('div');
              errEl.className = 'plugin-view-error';
              errEl.style.color = '#f87171';
              errEl.style.padding = '8px';
              errEl.style.fontSize = '12px';
              errEl.textContent = `Plugin View Error: ${err?.message || 'Failed to render'}`;
              if (typeof container.replaceChildren === 'function') {
                container.replaceChildren(errEl);
              } else if (typeof container.appendChild === 'function') {
                container.textContent = '';
                container.appendChild(errEl);
              }
            } else if (container) {
              container.textContent = `Plugin View Error: ${err?.message || 'Failed to render'}`;
            }
            return { success: false, error: err?.message || 'Failed to render view' };
          }
        }
      }
    }
    return { success: false, error: `View "${viewId}" not found.` };
  }
}
