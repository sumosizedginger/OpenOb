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
      expect(title).toBe('Open Knowledge Workspace');

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

    const electronApp = await electron.launch({
      executablePath: exePath,
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      const title = await window.title();
      expect(title).toBe('Open Knowledge Workspace');

      const bootstrap = await window.evaluate(async () => {
        return await (window as any).openobDesktop.getBootstrapConfig();
      });
      expect(bootstrap.gatewayUrl).toMatch(/^http:\/\/127\.0.0\.1:\d+/);
    } finally {
      await electronApp.close();
    }
  });
});
