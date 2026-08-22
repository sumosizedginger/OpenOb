import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { OpenObGatewayClient, OpenObWorkspace } from '@okw/workspace';
import { RunningGateway, startGateway } from '../../apps/gateway/src/server.js';
import { seedOnboardingDismissed } from './helpers.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

test.describe('Phase 3D: Database Views & Query E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3d-e2e-views-token-789';

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-views-e2e-'));

    await fs.writeFile(
      path.join(tempVaultDir, 'Alpha.md'),
      `---
title: Alpha Project
status: active
priority: 1
tags: [project]
---
# Alpha Project
Alpha details.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'Beta.md'),
      `---
title: Beta Project
status: planning
priority: 2
tags: [project]
---
# Beta Project
Beta details.`
    );

    storage = new NodeFsVaultStorage(tempVaultDir);
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, new DefaultDocumentParser());

    workspace = new OpenObWorkspace({
      vaultName: 'ViewsTestVault',
      storage,
      index,
      safeWriter: new SafeWriter(storage),
      readOnly: false,
    });

    const port = await getFreePort();
    runningGateway = await startGateway({
      workspace,
      port,
      token: TEST_TOKEN,
      serveWeb: true,
    });

    gatewayUrl = runningGateway.url;
    agentClient = new OpenObGatewayClient({ url: gatewayUrl, token: TEST_TOKEN });
  });

  test.afterAll(async () => {
    await runningGateway?.stop();
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('Connects to Gateway and displays Table / List Views, updating on external mutation', async ({
    page,
  }) => {
    // 1. Navigate to app and connect to gateway
    await page.goto('/');
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    const connectRes = await page.evaluate(
      async ({ url, token }) => {
        if ((window as any).__connectToGateway) {
          return await (window as any).__connectToGateway(url, token);
        }
        return { success: false, error: '__connectToGateway not found on window' };
      },
      { url: gatewayUrl, token: TEST_TOKEN }
    );
    expect(connectRes.success).toBe(true);

    // Wait for workspace status to reflect connected vault
    await expect(page.locator('.status-bar')).toContainText('Gateway: ViewsTestVault', {
      timeout: 10000,
    });

    // 2. Switch to Database Views mode via top toolbar
    const viewsButton = page.locator('button[title="Database Views"]').first();
    await expect(viewsButton).toBeVisible();
    await viewsButton.click();

    // Verify Table view is active and renders seeded notes
    await expect(page.locator('text=Alpha Project').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Beta Project').first()).toBeVisible({ timeout: 5000 });

    // 3. Switch to List view
    const listToggle = page.locator('button:has-text("List")').first();
    await expect(listToggle).toBeVisible();
    await listToggle.click();
    await expect(page.locator('text=Alpha Project').first()).toBeVisible();

    // Switch back to Table view
    const tableToggle = page.locator('button:has-text("Table")').first();
    await expect(tableToggle).toBeVisible();
    await tableToggle.click();

    // 4. Agent mutates property on Beta.md via Gateway REST
    const betaNote = await agentClient.readNote('Beta.md');
    await agentClient.setProperty({
      path: 'Beta.md',
      key: 'status',
      value: 'completed',
      expectedVersion: betaNote.version,
    });

    // 5. Verify the table reflects updated property via live change stream
    await expect(page.locator('text=completed').first()).toBeVisible({ timeout: 10000 });
  });
});
