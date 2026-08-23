import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { seedOnboardingDismissed } from './helpers.js';

test.describe('GitHub Pages Simulated /OpenOb/ Subpath Smoke Test', () => {
  let server: http.Server;
  let baseUrl: string;
  const webDistDir = path.resolve('apps/web/dist');

  test.beforeAll(async () => {
    if (!fs.existsSync(webDistDir) || !fs.existsSync(path.join(webDistDir, 'index.html'))) {
      return;
    }

    server = http.createServer((req, res) => {
      const urlPath = req.url || '/';
      if (!urlPath.startsWith('/OpenOb/')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      let subPath = urlPath.slice('/OpenOb/'.length);
      if (subPath === '' || subPath === '/' || subPath.startsWith('?')) {
        subPath = 'index.html';
      }

      const cleanSubPath = subPath.split('?')[0];
      const filePath = path.join(webDistDir, cleanSubPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentType =
          ext === '.html'
            ? 'text/html'
            : ext === '.js'
              ? 'application/javascript'
              : ext === '.css'
                ? 'text/css'
                : ext === '.png'
                  ? 'image/png'
                  : ext === '.ico'
                    ? 'image/x-icon'
                    : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('File Not Found');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}/OpenOb/`;
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test('Boots web app beneath /OpenOb/ subpath without asset 404s or console errors', async ({
    page,
  }) => {
    if (!baseUrl) {
      test.skip();
      return;
    }

    const failedRequests: string[] = [];
    const pageErrors: string[] = [];

    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(baseUrl);
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 5000 });
    expect(await page.title()).toBe('OpenOb');

    // Verify brand logo loaded cleanly
    const logoImg = page.locator('.logo-icon');
    await expect(logoImg).toBeVisible();
    const isImageLoaded = await logoImg.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
    );
    expect(isImageLoaded).toBe(true);

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
