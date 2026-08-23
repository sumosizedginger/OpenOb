import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('OpenOb Canonical Brand Mark Integration (Section 21)', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('1. verifies canonical master asset and brand derivatives in assets/brand/', () => {
    const masterPath = path.join(rootDir, 'assets/brand/openob-jackass-master.png');
    expect(fs.existsSync(masterPath)).toBe(true);
    const masterStat = fs.statSync(masterPath);
    expect(masterStat.size).toBeGreaterThan(1000000); // 2.4MB master asset

    const derivatives = [
      'openob-icon-1024.png',
      'openob-icon-512.png',
      'openob-icon-256.png',
      'openob-mark-transparent.png',
      'README.md',
    ];

    for (const file of derivatives) {
      const p = path.join(rootDir, 'assets/brand', file);
      expect(fs.existsSync(p), `Expected ${file} to exist in assets/brand/`).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(0);
    }
  });

  it('2. verifies desktop build icon assets and electron-builder.json config', () => {
    const buildDir = path.join(rootDir, 'apps/desktop/build');
    const icoPath = path.join(buildDir, 'icon.ico');
    const icnsPath = path.join(buildDir, 'icon.icns');
    const iconsDir = path.join(buildDir, 'icons');

    expect(fs.existsSync(icoPath), 'Windows icon.ico must exist').toBe(true);
    expect(fs.statSync(icoPath).size).toBeGreaterThan(1000);

    expect(fs.existsSync(icnsPath), 'macOS icon.icns must exist').toBe(true);
    expect(fs.statSync(icnsPath).size).toBeGreaterThan(1000);

    const requiredSizes = [
      '16x16.png',
      '24x24.png',
      '32x32.png',
      '48x48.png',
      '64x64.png',
      '128x128.png',
      '256x256.png',
      '512x512.png',
      '1024x1024.png',
    ];
    for (const sizeFile of requiredSizes) {
      const p = path.join(iconsDir, sizeFile);
      expect(fs.existsSync(p), `Expected Linux icon ${sizeFile} to exist`).toBe(true);
    }

    const electronBuilderJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'apps/desktop/electron-builder.json'), 'utf8')
    );
    expect(electronBuilderJson.win.icon).toBe('build/icon.ico');
    expect(electronBuilderJson.mac.icon).toBe('build/icon.icns');
    expect(electronBuilderJson.linux.icon).toBe('build/icons');
  });

  it('3. verifies web public favicons and in-app brand mark assets', () => {
    const webPublicDir = path.join(rootDir, 'apps/web/public');
    const expectedWebAssets = [
      'favicon.ico',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon-48x48.png',
      'apple-touch-icon.png',
      'brand/openob-mark.png',
      'brand/openob-mark-64.png',
    ];

    for (const asset of expectedWebAssets) {
      const p = path.join(webPublicDir, asset);
      expect(fs.existsSync(p), `Expected web public asset ${asset} to exist`).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(0);
    }
  });

  it('4. verifies web index.html references canonical brand favicons without generic inline SVG book icon', () => {
    const indexHtml = fs.readFileSync(path.join(rootDir, 'apps/web/index.html'), 'utf8');
    expect(indexHtml).toContain('rel="icon" type="image/x-icon" href="/favicon.ico"');
    expect(indexHtml).toContain(
      'rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"'
    );
    expect(indexHtml).not.toContain(
      "<path d='M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z'/>"
    );
    expect(indexHtml).toContain('<title>OpenOb</title>');
  });

  it('5. verifies App.tsx uses canonical OpenOb brand mark image instead of ShieldCheck', () => {
    const appTsx = fs.readFileSync(path.join(rootDir, 'apps/web/src/App.tsx'), 'utf8');
    expect(appTsx).toContain('brand/openob-mark.png');
    expect(appTsx).toContain('alt="OpenOb logo — jackass skull within a broken gold sigil"');
    expect(appTsx).not.toContain('<ShieldCheck');
  });

  it('6. verifies desktop main.ts configures BrowserWindow icon and Windows AppUserModelId', () => {
    const mainTs = fs.readFileSync(path.join(rootDir, 'apps/desktop/src/main.ts'), 'utf8');
    expect(mainTs).toContain("app.setAppUserModelId('com.openob.app')");
    expect(mainTs).toContain('getWindowIconPath()');
  });
});
