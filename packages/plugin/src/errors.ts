import { PluginPermission } from './types.js';

export class PermissionDeniedError extends Error {
  constructor(public readonly pluginId: string, public readonly requiredPermission: PluginPermission) {
    super(`Plugin "${pluginId}" denied access: permission "${requiredPermission}" is not declared in its manifest.`);
    this.name = 'PermissionDeniedError';
  }
}

export class PluginLifecycleError extends Error {
  constructor(public readonly pluginId: string, message: string, public readonly cause?: any) {
    super(`Plugin "${pluginId}" lifecycle error: ${message}`);
    this.name = 'PluginLifecycleError';
  }
}
