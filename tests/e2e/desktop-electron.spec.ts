import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

test.describe('Real Electron Desktop Launch & Embedded Gateway Smoke Test (P0-1, P1-1, P2-1)', () => {
  test('Electron launches compiled bundle, serves web UI, initializes safeStorage, and authorizes AI endpoints', async () => {
    const mainScript = path.resolve('apps/desktop/dist/main.cjs');
    expect(fs.existsSync(mainScript)).toBe(true);

    const electronApp = await electron.launch({
      args: [mainScript],
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });

    try {
      // 1. Wait for MainWindow to open and evaluate title
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      const title = await window.title();
      expect(title).toBe('OpenOb');

      // Wait for React UI to mount (.app-container, .app-header, .app-logo)
      await window.waitForSelector('.app-container', { timeout: 10000 });
      await window.waitForSelector('.app-logo', { timeout: 5000 });
      const logoText = await window.locator('.logo-text').textContent();
      expect(logoText).toBe('OpenOb');

      // Negative assertion: Ensure raw UNAUTHORIZED JSON is NEVER rendered
      const bodyText = await window.locator('body').textContent();
      expect(bodyText).not.toContain('UNAUTHORIZED');
      expect(bodyText).not.toContain('Missing or invalid authentication credentials');

      // 2. Verify Preload Bridge is securely injected
      const isDesktopInjected = await window.evaluate(() => {
        return typeof (window as any).openobDesktop !== 'undefined';
      });
      expect(isDesktopInjected).toBe(true);

      // 3. Verify Bootstrap Config from IPC
      const bootstrap = await window.evaluate(async () => {
        return await (window as any).openobDesktop.getBootstrapConfig();
      });

      expect(bootstrap).toBeDefined();
      expect(bootstrap.gatewayUrl).toMatch(/^http:\/\/127\.0.0\.1:\d+/);
      expect(bootstrap.token).toMatch(/^OPENOB_DESKTOP_/);
      expect(['ready', 'unavailable', 'corrupted']).toContain(bootstrap.storageStatus);

      // 4. Verify Embedded Gateway Health (P0-1)
      const healthRes = await fetch(`${bootstrap.gatewayUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson.status).toBe('ok');

      // 5. Verify Content-Security-Policy header on static response (P2-1)
      const rootRes = await fetch(bootstrap.gatewayUrl);
      const cspHeader = rootRes.headers.get('content-security-policy');
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).toContain("object-src 'none'");

      // 6. Verify Desktop AI Scopes are authorized (P1-1)
      const aiProvidersRes = await fetch(`${bootstrap.gatewayUrl}/api/v1/ai/providers`, {
        headers: {
          authorization: `Bearer ${bootstrap.token}`,
        },
      });
      expect(aiProvidersRes.status).toBe(200);
      const aiProvidersJson = await aiProvidersRes.json();
      expect(Array.isArray(aiProvidersJson.providers)).toBe(true);

      // 7. Verify App Info IPC
      const appInfo = await window.evaluate(async () => {
        return await (window as any).openobDesktop.getAppInfo();
      });
      expect(appInfo.name).toBe('OpenOb');
    } finally {
      await electronApp.close();
    }
  });

  test('Packaged Windows executable (win-unpacked/OpenOb.exe) launches and serves UI', async () => {
    const exePath = path.resolve('apps/desktop/release/win-unpacked/OpenOb.exe');
    if (!fs.existsSync(exePath)) {
      test.skip();
      return;
    }

    // 1. Verify packaged web assets structure in resources/web
    const resourcesWebDir = path.resolve('apps/desktop/release/win-unpacked/resources/web');
    expect(
      fs.existsSync(path.join(resourcesWebDir, 'index.html')),
      'resources/web/index.html must exist'
    ).toBe(true);
    expect(
      fs.existsSync(path.join(resourcesWebDir, 'favicon.ico')),
      'resources/web/favicon.ico must exist'
    ).toBe(true);
    expect(
      fs.existsSync(path.join(resourcesWebDir, 'brand/openob-mark.png')),
      'resources/web/brand/openob-mark.png must exist'
    ).toBe(true);

    const assetsDir = path.join(resourcesWebDir, 'assets');
    expect(fs.existsSync(assetsDir), 'resources/web/assets must exist').toBe(true);
    const assetFiles = fs.readdirSync(assetsDir);
    expect(
      assetFiles.some((f) => f.endsWith('.js')),
      'Production JS bundle must exist in resources/web/assets'
    ).toBe(true);
    expect(
      assetFiles.some((f) => f.endsWith('.css')),
      'Production CSS bundle must exist in resources/web/assets'
    ).toBe(true);

    const electronApp = await electron.launch({
      executablePath: exePath,
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // 2. Window title and real OpenOb UI DOM assertion
      const title = await window.title();
      expect(title).toBe('OpenOb');

      // Wait for React UI to mount (.app-container, .app-header, .app-logo)
      await window.waitForSelector('.app-container', { timeout: 10000 });
      await window.waitForSelector('.app-logo', { timeout: 5000 });
      await window.waitForSelector('.logo-text', { timeout: 5000 });

      const logoText = await window.locator('.logo-text').textContent();
      expect(logoText).toBe('OpenOb');

      // 3. Negative assertion: Ensure raw UNAUTHORIZED JSON is NEVER rendered
      const bodyText = await window.locator('body').textContent();
      expect(bodyText).not.toContain('UNAUTHORIZED');
      expect(bodyText).not.toContain('Missing or invalid authentication credentials');
      expect(bodyText).not.toContain('{"code":');

      // 4. Verify bootstrap configuration
      const bootstrap = await window.evaluate(async () => {
        return await (window as any).openobDesktop.getBootstrapConfig();
      });
      expect(bootstrap.gatewayUrl).toMatch(/^http:\/\/127\.0.0\.1:\d+/);
      expect(bootstrap.token).toMatch(/^OPENOB_DESKTOP_/);

      // 5. HTTP Probes against running loopback Gateway
      // A. GET / without Authorization -> 200 text/html OpenOb index
      const rootRes = await fetch(bootstrap.gatewayUrl);
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers.get('content-type')).toContain('text/html');
      const rootHtml = await rootRes.text();
      expect(rootHtml).toContain('<div id="root"></div>');
      expect(rootHtml).toContain('<title>OpenOb</title>');

      // B. GET /assets/<production-js> without Authorization -> 200 javascript
      const jsAsset = assetFiles.find((f) => f.endsWith('.js'));
      expect(jsAsset).toBeDefined();
      const jsRes = await fetch(`${bootstrap.gatewayUrl}/assets/${jsAsset}`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get('content-type')).toMatch(/javascript/);

      // C. GET /favicon.ico without Authorization -> 200 image/x-icon
      const favRes = await fetch(`${bootstrap.gatewayUrl}/favicon.ico`);
      expect(favRes.status).toBe(200);

      // D. GET /brand/openob-mark.png without Authorization -> 200 image/png
      const brandRes = await fetch(`${bootstrap.gatewayUrl}/brand/openob-mark.png`);
      expect(brandRes.status).toBe(200);
      expect(brandRes.headers.get('content-type')).toContain('image/png');

      // E. GET /api/v1/workspace without Authorization -> 401 UNAUTHORIZED
      const unauthApiRes = await fetch(`${bootstrap.gatewayUrl}/api/v1/workspace`);
      expect(unauthApiRes.status).toBe(401);
      const unauthJson = await unauthApiRes.json();
      expect(unauthJson.code).toBe('UNAUTHORIZED');

      // F. GET /api/v1/workspace with desktop session token -> 200 JSON
      const authApiRes = await fetch(`${bootstrap.gatewayUrl}/api/v1/workspace`, {
        headers: {
          authorization: `Bearer ${bootstrap.token}`,
        },
      });
      expect(authApiRes.status).toBe(200);
      const authJson = await authApiRes.json();
      expect(authJson.apiVersion).toBe('v1');
    } finally {
      await electronApp.close();
    }
  });
});
