import { PluginPermission } from './types.js';

export class PermissionDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly requiredPermission: PluginPermission
  ) {
    super(
      `Plugin "${pluginId}" denied access: permission "${requiredPermission}" is not declared in its manifest.`
    );
    this.name = 'PermissionDeniedError';
  }
}

export class PluginLifecycleError extends Error {
  constructor(
    public readonly pluginId: string,
    message: string,
    public readonly cause?: any
  ) {
    super(`Plugin "${pluginId}" lifecycle error: ${message}`);
    this.name = 'PluginLifecycleError';
  }
}

export class InvalidManifestError extends Error {
  constructor(
    public readonly pluginId: string,
    message: string
  ) {
    super(`Plugin manifest invalid for "${pluginId}": ${message}`);
    this.name = 'InvalidManifestError';
  }
}

export class UndeclaredContributionError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly contributionType: 'command' | 'view',
    public readonly contributionId: string
  ) {
    super(
      `Plugin "${pluginId}" attempted to register undeclared ${contributionType} "${contributionId}". All contributions must be declared in manifest.contributes.`
    );
    this.name = 'UndeclaredContributionError';
  }
}

export class DuplicateContributionError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly contributionType: 'command' | 'view' | 'plugin',
    public readonly contributionId: string
  ) {
    super(
      `Duplicate ${contributionType} registration collision: "${contributionId}" is already registered by another plugin.`
    );
    this.name = 'DuplicateContributionError';
  }
}
