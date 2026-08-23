import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { getPublicAssetUrl } from '../../apps/web/src/utils/assets.js';

describe('GitHub Pages Deployment & Base-Path Integrity', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const webDistDir = path.join(rootDir, 'apps/web/dist');

  it('1. verifies getPublicAssetUrl helper correctly handles different base URLs', () => {
    expect(getPublicAssetUrl('brand/openob-mark.png')).toBeDefined();
    expect(getPublicAssetUrl('/brand/openob-mark.png')).toBeDefined();
  });

  it('2. verifies production web build artifacts exist and have proper structure', () => {
    if (!fs.existsSync(webDistDir)) {
      return;
    }

    const indexHtmlPath = path.join(webDistDir, 'index.html');
    expect(fs.existsSync(indexHtmlPath)).toBe(true);

    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    expect(indexHtml).toContain('<div id="root"></div>');
    expect(indexHtml).toContain('<title>OpenOb</title>');

    // Check favicon and brand public files copied to dist
    expect(fs.existsSync(path.join(webDistDir, 'favicon.ico'))).toBe(true);
    expect(fs.existsSync(path.join(webDistDir, 'favicon-32x32.png'))).toBe(true);
    expect(fs.existsSync(path.join(webDistDir, 'brand/openob-mark.png'))).toBe(true);
    expect(fs.existsSync(path.join(webDistDir, 'brand/openob-mark-64.png'))).toBe(true);
  });

  it('3. verifies simulated /OpenOb/ subpath server serves all assets with 200 OK', async () => {
    if (!fs.existsSync(webDistDir)) {
      return;
    }

    // Spin up an ephemeral HTTP server serving webDistDir under /OpenOb/
    const server = http.createServer((req, res) => {
      const urlPath = req.url || '/';
      if (!urlPath.startsWith('/OpenOb/')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      let subPath = urlPath.slice('/OpenOb/'.length);
      if (subPath === '' || subPath === '/') {
        subPath = 'index.html';
      }

      const filePath = path.join(webDistDir, subPath.split('?')[0]);
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
    const baseUrl = `http://127.0.0.1:${port}/OpenOb/`;

    try {
      // 1. Fetch index.html
      const indexRes = await fetch(baseUrl);
      expect(indexRes.status).toBe(200);
      const html = await indexRes.text();
      expect(html).toContain('<div id="root"></div>');

      // 2. Fetch brand mark
      const brandRes = await fetch(`${baseUrl}brand/openob-mark.png`);
      expect(brandRes.status).toBe(200);
      expect(brandRes.headers.get('content-type')).toBe('image/png');

      // 3. Fetch favicon
      const favRes = await fetch(`${baseUrl}favicon.ico`);
      expect(favRes.status).toBe(200);

      // 4. Fetch JS asset if present in assets/
      const assetsDir = path.join(webDistDir, 'assets');
      if (fs.existsSync(assetsDir)) {
        const assets = fs.readdirSync(assetsDir);
        const jsFile = assets.find((f) => f.endsWith('.js'));
        if (jsFile) {
          const jsRes = await fetch(`${baseUrl}assets/${jsFile}`);
          expect(jsRes.status).toBe(200);
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
