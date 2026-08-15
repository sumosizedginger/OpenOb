import type {
  Plugin,
  PluginCommand,
  PluginHostContext,
  PluginInstance,
  PluginManifest,
  PluginView,
} from './types.js';
import { createPluginAPI } from './bridge.js';

export interface PluginRegistration {
  manifest: PluginManifest;
  factory: () => Plugin;
}

/**
 * Sandboxed, crash-resilient Plugin Host (Constitution Law 20, F-007).
 * Controls plugin lifecycle, capability gating, and error containment.
 */
export class PluginHost {
  private readonly registrations = new Map<string, PluginRegistration>();
  private readonly instances = new Map<string, PluginInstance>();
  private context: PluginHostContext;

  constructor(context: PluginHostContext) {
    this.context = context;
  }

  updateContext(context: Partial<PluginHostContext>): void {
    this.context = { ...this.context, ...context };
  }

  registerPlugin(manifest: PluginManifest, factory: () => Plugin): void {
    this.registrations.set(manifest.id, { manifest, factory });
    if (!this.instances.has(manifest.id)) {
      this.instances.set(manifest.id, {
        manifest,
        plugin: null,
        status: 'loaded',
        registeredCommands: [],
        registeredViews: [],
      });
    }
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

      const api = createPluginAPI(
        reg.manifest,
        this.context,
        inst.registeredCommands,
        inst.registeredViews
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
}
