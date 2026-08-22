import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateLegacyProfile } from '@okw/desktop';

describe('Desktop Profile Identity & Safe Migration (Items 12-15)', () => {
  let tempBaseDir: string;
  let legacyDir: string;
  let canonicalDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-profile-test-'));
    legacyDir = path.join(tempBaseDir, '@okw', 'desktop-app');
    canonicalDir = path.join(tempBaseDir, 'OpenOb');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  it('safely migrates desktop-config, window-state, and secure master key from legacy profile', () => {
    fs.mkdirSync(path.join(legacyDir, 'secure'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'desktop-config.json'),
      JSON.stringify({ lastVaultPath: 'C:\\test\\vault' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(legacyDir, 'window-state.json'),
      JSON.stringify({ width: 1280, height: 800 }),
      'utf8'
    );
    fs.writeFileSync(path.join(legacyDir, 'secure', 'master.key'), 'encrypted-key-bytes', 'utf8');

    const result = migrateLegacyProfile(legacyDir, canonicalDir);

    expect(result.migrated).toBe(true);
    expect(result.filesMigrated).toContain('desktop-config.json');
    expect(result.filesMigrated).toContain('window-state.json');
    expect(result.filesMigrated).toContain('secure/master.key');

    // Verify files copied to canonical
    expect(fs.existsSync(path.join(canonicalDir, 'desktop-config.json'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'window-state.json'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'secure', 'master.key'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'migration-marker.json'))).toBe(true);

    // Verify legacy files still preserved as backup
    expect(fs.existsSync(path.join(legacyDir, 'desktop-config.json'))).toBe(true);
    expect(fs.readFileSync(path.join(canonicalDir, 'secure', 'master.key'), 'utf8')).toBe(
      'encrypted-key-bytes'
    );
  });

  it('collision policy: prefers existing canonical profile and does not overwrite with legacy data', () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'desktop-config.json'),
      JSON.stringify({ lastVaultPath: 'C:\\legacy\\vault' }),
      'utf8'
    );

    fs.mkdirSync(canonicalDir, { recursive: true });
    fs.writeFileSync(
      path.join(canonicalDir, 'desktop-config.json'),
      JSON.stringify({ lastVaultPath: 'C:\\canonical\\vault' }),
      'utf8'
    );

    const result = migrateLegacyProfile(legacyDir, canonicalDir);

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('canonical_already_exists');

    // Canonical config is untouched
    const canonicalConfig = JSON.parse(
      fs.readFileSync(path.join(canonicalDir, 'desktop-config.json'), 'utf8')
    );
    expect(canonicalConfig.lastVaultPath).toBe('C:\\canonical\\vault');
  });

  it('idempotency: subsequent runs do not re-run migration or fail', () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'desktop-config.json'),
      JSON.stringify({ lastVaultPath: 'C:\\test\\vault' }),
      'utf8'
    );

    const firstRun = migrateLegacyProfile(legacyDir, canonicalDir);
    expect(firstRun.migrated).toBe(true);

    const secondRun = migrateLegacyProfile(legacyDir, canonicalDir);
    expect(secondRun.migrated).toBe(false);
    expect(secondRun.reason).toBe('canonical_already_exists');
  });
});
