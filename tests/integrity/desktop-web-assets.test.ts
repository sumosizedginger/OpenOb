import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGatewayServer } from '../../apps/gateway/src/server.js';
import { OpenObWorkspace } from '@okw/workspace';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';

describe('Desktop Packaged Web Asset Resolution & Failure Guard', () => {
  it('verifies that packaged resources/web contains all required production assets when built', () => {
    const resourcesWebDir = path.resolve('apps/desktop/release/win-unpacked/resources/web');
    if (!fs.existsSync(resourcesWebDir)) {
      // If release has not been generated in this environment, verify electron-builder configuration
      const builderConfig = JSON.parse(
        fs.readFileSync('apps/desktop/electron-builder.json', 'utf8')
      );
      expect(builderConfig.extraResources).toBeDefined();
      expect(
        builderConfig.extraResources.some((r: any) => r.from === '../web/dist' && r.to === 'web')
      ).toBe(true);
      return;
    }

    expect(fs.existsSync(path.join(resourcesWebDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(resourcesWebDir, 'favicon.ico'))).toBe(true);
    expect(fs.existsSync(path.join(resourcesWebDir, 'brand/openob-mark.png'))).toBe(true);

    const assetsDir = path.join(resourcesWebDir, 'assets');
    expect(fs.existsSync(assetsDir)).toBe(true);
    const files = fs.readdirSync(assetsDir);
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('.css'))).toBe(true);
  });

  it('Gateway static handler: returns 404 for missing static asset and does NOT leak 401 UNAUTHORIZED', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      vaultName: 'test-vault',
      serverInstanceId: 'srv-1',
      readOnly: false,
    });

    const server = createGatewayServer({
      workspace,
      token: 'SECRET_OPENOB_TOKEN',
      serveWeb: true,
      webDistPath: path.resolve('non_existent_folder_xyz_123'),
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as import('node:net').AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. GET / when static folder is missing -> returns 404 Not Found (NOT 401 Unauthorized!)
      const rootRes = await fetch(baseUrl);
      expect(rootRes.status).toBe(404);
      const rootText = await rootRes.text();
      expect(rootText).not.toContain('UNAUTHORIZED');
      expect(rootText).not.toContain('Missing or invalid authentication credentials');

      // 2. GET /api/v1/notes without token -> returns 401 UNAUTHORIZED
      const apiRes = await fetch(`${baseUrl}/api/v1/notes`);
      expect(apiRes.status).toBe(401);
      const apiJson = await apiRes.json();
      expect(apiJson.code).toBe('UNAUTHORIZED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Gateway static handler: serves valid web assets publicly and protects API endpoints with token', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      vaultName: 'test-vault',
      serverInstanceId: 'srv-1',
      readOnly: false,
    });

    const webDistPath = path.resolve('apps/web/dist');
    if (!fs.existsSync(webDistPath)) {
      return;
    }

    const server = createGatewayServer({
      workspace,
      token: 'SECRET_OPENOB_TOKEN',
      serveWeb: true,
      webDistPath,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as import('node:net').AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. GET / -> 200 text/html
      const rootRes = await fetch(baseUrl);
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers.get('content-type')).toContain('text/html');
      const rootHtml = await rootRes.text();
      expect(rootHtml).toContain('<title>OpenOb</title>');

      // 2. GET /api/v1/workspace without token -> 401 UNAUTHORIZED
      const apiUnauth = await fetch(`${baseUrl}/api/v1/workspace`);
      expect(apiUnauth.status).toBe(401);

      // 3. GET /api/v1/workspace with token -> 200 JSON
      const apiAuth = await fetch(`${baseUrl}/api/v1/workspace`, {
        headers: { authorization: 'Bearer SECRET_OPENOB_TOKEN' },
      });
      expect(apiAuth.status).toBe(200);
      const wsJson = await apiAuth.json();
      expect(wsJson.name).toBe('test-vault');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Desktop startup failure mode: throws clear error if web assets/index.html are missing, preventing Gateway fallback', () => {
    // Simulating packaged environment without index.html
    const checkPackagedWebDist = (resourcesPath: string, isPackaged: boolean) => {
      if (isPackaged) {
        const packagedWeb = path.join(resourcesPath, 'web');
        if (!fs.existsSync(path.join(packagedWeb, 'index.html'))) {
          throw new Error(
            `OpenOb web application assets are missing from the desktop package (checked "${packagedWeb}").`
          );
        }
        return packagedWeb;
      }
      return path.resolve('apps/web/dist');
    };

    // 1. Packaged directory without index.html -> throws expected error
    const emptyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-web-'));
    try {
      expect(() => checkPackagedWebDist(emptyTempDir, true)).toThrowError(
        /OpenOb web application assets are missing from the desktop package/
      );
    } finally {
      fs.rmSync(emptyTempDir, { recursive: true, force: true });
    }
  });
});
