import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { DefaultDocumentParser, parseFrontmatter } from '@okw/markdown';
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

test.describe('Phase 3F: Board Drag Mutation & Concurrency E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3f-board-token-123';

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-board-drag-e2e-'));

    await fs.writeFile(
      path.join(tempVaultDir, 'CardA.md'),
      `---
title: Card Alpha
status: todo
priority: 1
---
# Card Alpha
Alpha content.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'CardB.md'),
      `---
title: Card Beta
status: in_progress
priority: 2
---
# Card Beta
Beta content.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'CardC.md'),
      `---
title: Card Gamma
status: done
priority: 3
---
# Card Gamma
Gamma content.`
    );

    storage = new NodeFsVaultStorage(tempVaultDir);
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, new DefaultDocumentParser());

    workspace = new OpenObWorkspace({
      vaultName: 'BoardDragVault',
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
      scopes: ['workspace.read', 'workspace.write', 'properties.write', 'workspace.views.write'],
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

  test('1. Moves card between columns and ungrouped column, updating disk and preserving types', async ({
    page,
  }) => {
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

    await expect(page.locator('.status-bar')).toContainText('Gateway: BoardDragVault', {
      timeout: 10000,
    });

    // 2. Open Database Views and switch to Board mode
    const viewsButton = page.locator('button[title="Database Views"]').first();
    await viewsButton.click();

    const boardToggle = page.locator('button:has-text("Board")').first();
    await boardToggle.click();

    await expect(page.locator('text=Card Alpha').first()).toBeVisible({ timeout: 5000 });

    // 3. Move Card Alpha (todo) to "done" column via accessible move menu
    const cardAlpha = page.locator('.group:has-text("Card Alpha")').first();
    await cardAlpha.hover();
    const menuBtn = cardAlpha.locator('button[title="Move card..."]').first();
    await menuBtn.click();

    await page.getByTestId('move-to-done').click();

    // Verify on disk: CardA.md status is now "done"
    await page.waitForTimeout(500);
    let raw = await fs.readFile(path.join(tempVaultDir, 'CardA.md'), 'utf8');
    let fm = parseFrontmatter(raw);
    expect(fm.properties.status).toBe('done');
    expect(typeof fm.properties.status).toBe('string');

    // 4. Move Card Beta (in_progress) to "No status" (ungrouped) -> deletes property
    const cardBeta = page.locator('.group:has-text("Card Beta")').first();
    await cardBeta.hover();
    const menuBtnB = cardBeta.locator('button[title="Move card..."]').first();
    await menuBtnB.click();

    await page.getByTestId('move-to-No status').click();

    await page.waitForTimeout(500);
    raw = await fs.readFile(path.join(tempVaultDir, 'CardB.md'), 'utf8');
    fm = parseFrontmatter(raw);
    expect(fm.properties.status).toBeUndefined();

    // 5. Change groupBy to numeric property "priority"
    const groupByInput = page.locator('input[placeholder="status..."]').first();
    await groupByInput.fill('priority');
    await page.waitForTimeout(600);

    // Verify columns 1, 2, 3 appear
    await expect(page.locator('span[title="1"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('span[title="3"]').first()).toBeVisible({ timeout: 5000 });

    // Move Card Alpha (priority 1) to priority column 3
    const cardAlphaInPriority = page.locator('.group:has-text("Card Alpha")').first();
    await cardAlphaInPriority.hover();
    const menuBtnAlpha = cardAlphaInPriority.locator('button[title="Move card..."]').first();
    await menuBtnAlpha.click();

    await page.getByTestId('move-to-3').click();

    await page.waitForTimeout(500);
    raw = await fs.readFile(path.join(tempVaultDir, 'CardA.md'), 'utf8');
    fm = parseFrontmatter(raw);
    expect(fm.properties.priority).toBe(3);
    expect(typeof fm.properties.priority).toBe('number');
  });

  test('2. Concurrency: stale card mutation triggers 409 conflict and preserves external agent update', async ({
    page,
  }) => {
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

    const viewsButton = page.locator('button[title="Database Views"]').first();
    await viewsButton.click();

    const boardToggle = page.locator('button:has-text("Board")').first();
    await boardToggle.click();

    // Reset groupBy to status
    const groupByInput = page.locator('input[placeholder="status..."]').first();
    await groupByInput.fill('status');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Card Gamma').first()).toBeVisible({ timeout: 5000 });

    // Read CardC version currently displayed on Board (V1)
    const cardC = await agentClient.readNote('CardC.md');
    const v1 = cardC.version;

    // External agent mutates CardC to "blocked" (V1 -> V2)
    await agentClient.setProperty({
      path: 'CardC.md',
      key: 'status',
      value: 'blocked',
      expectedVersion: v1,
    });

    // Human client attempts to commit Board move using stale V1
    const result = await page.evaluate(async (staleVersion) => {
      try {
        const backend = (window as any).__backend;
        await backend.setProperty({
          path: 'CardC.md',
          key: 'status',
          value: 'done',
          expectedVersion: staleVersion,
        });
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          code: err.code,
          status: err.status,
          message: err.message || String(err),
        };
      }
    }, v1);

    // Verify 409 Conflict rejection
    expect(result.success).toBe(false);
    expect(
      result.status === 409 ||
        result.code === 'CONFLICT' ||
        result.message.toLowerCase().includes('conflict')
    ).toBe(true);

    // Verify on disk: CardC remains "blocked" (agent V2 preserved, no overwrite)
    const raw = await fs.readFile(path.join(tempVaultDir, 'CardC.md'), 'utf8');
    const fm = parseFrontmatter(raw);
    expect(fm.properties.status).toBe('blocked');
  });
});
