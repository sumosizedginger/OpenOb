import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MigrationResult {
  migrated: boolean;
  reason?: string;
  filesMigrated: string[];
}

/**
 * Safely and idempotently migrates legacy user profile files (@okw/desktop-app)
 * to the canonical product profile directory (OpenOb).
 *
 * Collision Policy:
 * - If canonical profile already exists and is initialized, prefer canonical and do not overwrite.
 * - If legacy profile exists and canonical is uninitialized, copy config, window state, and secure keys.
 * - Preserves legacy profile on disk as safe backup.
 */
export function migrateLegacyProfile(legacyDir: string, canonicalDir: string): MigrationResult {
  if (!fs.existsSync(legacyDir)) {
    return { migrated: false, reason: 'legacy_not_found', filesMigrated: [] };
  }

  // If canonical config or migration marker exists, do not overwrite
  const canonicalConfig = path.join(canonicalDir, 'desktop-config.json');
  const migrationMarker = path.join(canonicalDir, 'migration-marker.json');

  if (fs.existsSync(canonicalConfig) || fs.existsSync(migrationMarker)) {
    return { migrated: false, reason: 'canonical_already_exists', filesMigrated: [] };
  }

  if (!fs.existsSync(canonicalDir)) {
    fs.mkdirSync(canonicalDir, { recursive: true });
  }

  const filesToCopy = ['desktop-config.json', 'window-state.json'];
  const filesMigrated: string[] = [];

  for (const file of filesToCopy) {
    const src = path.join(legacyDir, file);
    const dest = path.join(canonicalDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      filesMigrated.push(file);
    }
  }

  // Migrate secure folder (e.g. master.key) if present
  const legacySecure = path.join(legacyDir, 'secure');
  const canonicalSecure = path.join(canonicalDir, 'secure');
  if (fs.existsSync(legacySecure)) {
    if (!fs.existsSync(canonicalSecure)) {
      fs.mkdirSync(canonicalSecure, { recursive: true });
    }
    const legacyKey = path.join(legacySecure, 'master.key');
    const canonicalKey = path.join(canonicalSecure, 'master.key');
    if (fs.existsSync(legacyKey) && !fs.existsSync(canonicalKey)) {
      fs.copyFileSync(legacyKey, canonicalKey);
      filesMigrated.push('secure/master.key');
    }
  }

  // Write migration marker for idempotency
  fs.writeFileSync(
    migrationMarker,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        legacySource: legacyDir,
        filesMigrated,
      },
      null,
      2
    ),
    'utf8'
  );

  return { migrated: true, filesMigrated };
}
