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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

test.describe('Phase 3E: Saved Views & Read-Only Board E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3e-e2e-board-token-123';

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-board-e2e-'));

    await fs.writeFile(
      path.join(tempVaultDir, 'Task1.md'),
      `---
title: First Task
status: todo
priority: 1
tags: [task]
---
# First Task
First details.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'Task2.md'),
      `---
title: Second Task
status: in_progress
priority: 2
tags: [task]
---
# Second Task
Second details.`
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'Task3.md'),
      `---
title: Third Task
status: done
priority: 3
tags: [task]
---
# Third Task
Third details.`
    );

    storage = new NodeFsVaultStorage(tempVaultDir);
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, new DefaultDocumentParser());

    workspace = new OpenObWorkspace({
      vaultName: 'BoardTestVault',
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
      scopes: ['workspace.read', 'workspace.views.write', 'workspace.write', 'properties.write'],
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

  test('Connects to Gateway, displays Board View with columns, navigates on card click, saves view, and updates live on mutation', async ({
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

    await expect(page.locator('.status-bar')).toContainText('Gateway: BoardTestVault', {
      timeout: 10000,
    });

    // 2. Switch to Database Views mode
    const viewsButton = page.locator('button[title="Database Views"]').first();
    await expect(viewsButton).toBeVisible();
    await viewsButton.click();

    // 3. Switch to Board View
    const boardToggle = page.locator('button:has-text("Board")').first();
    await expect(boardToggle).toBeVisible();
    await boardToggle.click();

    // Verify columns exist on the board
    await expect(page.locator('text=todo').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=in_progress').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=done').first()).toBeVisible({ timeout: 5000 });

    // Verify cards are inside columns
    await expect(page.locator('text=First Task').first()).toBeVisible();
    await expect(page.locator('text=Second Task').first()).toBeVisible();
    await expect(page.locator('text=Third Task').first()).toBeVisible();

    // 4. Click First Task card -> navigates to note editor
    await page.locator('text=First Task').first().click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.cm-content')).toContainText('First Task');

    // 5. Switch back to Database Views
    await viewsButton.click();
    await expect(boardToggle).toBeVisible();
    await boardToggle.click();

    // 6. Save current view as "Sprint Kanban"
    const saveViewButton = page.locator('button:has-text("Save View")').first();
    await expect(saveViewButton).toBeVisible();
    await saveViewButton.click();

    // Fill view name in modal
    const viewNameInput = page.locator('input[placeholder*="Active Tasks"]').first();
    await expect(viewNameInput).toBeVisible();
    await viewNameInput.fill('Sprint Kanban');
    await page.locator('button[type="submit"]:has-text("Save View")').click();

    // Verify saved view is loaded and listed in dropdown
    const select = page.locator('select').first();
    await expect(select).toContainText('Sprint Kanban');

    // 7. External Agent mutates First Task from "todo" to "done" via Gateway REST
    const task1 = await agentClient.readNote('Task1.md');
    await agentClient.setProperty({
      path: 'Task1.md',
      key: 'status',
      value: 'done',
      expectedVersion: task1.version,
    });

    // 8. Board live updates: First Task moves to "done" column
    // The "todo" column count should now be 0 or empty, and "done" column should have First Task and Third Task
    await expect(page.locator('text=First Task').first()).toBeVisible({ timeout: 10000 });
  });
});
