import {
  computeContentHash,
  ConflictError,
  FileVersion,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';

export interface SafeSaveOptions {
  /**
   * Expected version token. If provided and current on-disk version does not match,
   * safe save halts and throws ConflictError without mutating the file.
   */
  expectedVersion?: FileVersion | null;
  /**
   * If true, skips version checks (user explicitly chose to overwrite).
   */
  force?: boolean;
}

export interface AutosaveState {
  isSaving: boolean;
  hasPendingSave: boolean;
  lastSavedVersion: FileVersion | null;
  lastSavedHash: string | null;
}

/**
 * SafeWriter encapsulates safe atomic save semantics:
 * 1. Pre-write validation: verifies expectedVersion against current storage.
 * 2. Hash integrity check: computes and records content hashes.
 * 3. Write through VaultStorage adapter.
 * 4. Post-write verification: verifies resulting snapshot and version token.
 */
export class SafeWriter {
  constructor(private readonly storage: VaultStorage) {}

  /**
   * Safely writes content to a vault path.
   */
  async safeSave(
    path: VaultPath,
    content: string | Uint8Array,
    options: SafeSaveOptions = {}
  ): Promise<WriteResult> {
    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const contentHash = computeContentHash(bytes);

    // If not forcing, check if content is actually different from current storage version
    if (!options.force && options.expectedVersion) {
      const currentStat = await this.storage.stat(path);
      if (currentStat?.version) {
        if (
          currentStat.version.token !== options.expectedVersion.token &&
          currentStat.version.hash !== options.expectedVersion.hash
        ) {
          // File changed externally!
          const currentSnapshot = await this.storage.read(path);
          throw new ConflictError(
            path,
            options.expectedVersion,
            currentStat.version,
            currentSnapshot.content,
            `SafeSave rejected: "${path}" was modified externally since last read.`
          );
        }
      }
    }

    const expected = options.force ? undefined : (options.expectedVersion ?? null);
    const result = await this.storage.write(path, expected, bytes);

    // Post-write verification
    if (result.snapshot.version.hash !== contentHash) {
      throw new Error(
        `SafeSave verification failed on "${path}": written hash ${result.snapshot.version.hash} does not match expected ${contentHash}`
      );
    }

    return result;
  }
}
