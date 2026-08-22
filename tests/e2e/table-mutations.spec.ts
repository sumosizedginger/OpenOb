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

test.describe('Phase 3F: Table Inline Property Editing & OCC E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3f-table-token-123';

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-table-e2e-'));

    await fs.writeFile(
      path.join(tempVaultDir, 'Task.md'),
      `---
title: Task Alpha
status: todo
priority: 1
done: false
tags: [work]
---
# Task Alpha
Details here.`
    );

    storage = new NodeFsVaultStorage(tempVaultDir);
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, new DefaultDocumentParser());

    workspace = new OpenObWorkspace({
      vaultName: 'TableMutationVault',
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

  test('1. Connects to gateway, inline edits string, number, and boolean properties with YAML type preservation', async ({
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

    await expect(page.locator('.status-bar')).toContainText('Gateway: TableMutationVault', {
      timeout: 10000,
    });

    // 2. Open Database Views (Table view)
    const viewsButton = page.locator('button[title="Database Views"]').first();
    await viewsButton.click();

    await expect(page.locator('text=Task Alpha').first()).toBeVisible({ timeout: 5000 });

    // 3. Edit string cell "todo" -> "in_progress"
    const statusCell = page.getByTestId('cell-Task.md-status');
    await statusCell.click();

    const textInput = page.locator('input[placeholder="Value..."]').first();
    await expect(textInput).toBeVisible();
    await textInput.fill('in_progress');
    await textInput.press('Enter');
    await expect(textInput).toBeHidden({ timeout: 5000 });

    // Wait for table cell to reflect in_progress
    await expect(statusCell).toHaveText('in_progress', { timeout: 5000 });

    // Verify on disk
    let raw = await fs.readFile(path.join(tempVaultDir, 'Task.md'), 'utf8');
    let fm = parseFrontmatter(raw);
    expect(fm.properties.status).toBe('in_progress');
    expect(typeof fm.properties.status).toBe('string');

    // 4. Edit number cell "1" -> "2"
    const priorityCell = page.getByTestId('cell-Task.md-priority');
    await priorityCell.click();

    const numInput = page.locator('input[type="number"]').first();
    await expect(numInput).toBeVisible();
    await numInput.fill('2');
    await page.locator('button[title="Save (Enter)"]').click();

    await expect(priorityCell).toHaveText('2', { timeout: 5000 });

    raw = await fs.readFile(path.join(tempVaultDir, 'Task.md'), 'utf8');
    fm = parseFrontmatter(raw);
    expect(fm.properties.priority).toBe(2);
    expect(typeof fm.properties.priority).toBe('number');

    // 5. Edit boolean cell "false" -> "true"
    const boolCell = page.getByTestId('cell-Task.md-done');
    await boolCell.click();

    const boolSelect = page.locator('select').filter({ hasText: 'true' }).first();
    await expect(boolSelect).toBeVisible();
    await boolSelect.selectOption('true');
    await page.locator('button[title="Save (Enter)"]').click();
    await expect(boolSelect).toBeHidden({ timeout: 5000 });

    await expect(boolCell).toHaveText('true', { timeout: 5000 });

    raw = await fs.readFile(path.join(tempVaultDir, 'Task.md'), 'utf8');
    fm = parseFrontmatter(raw);
    expect(fm.properties.done).toBe(true);
    expect(typeof fm.properties.done).toBe('boolean');

    // 6. Clear property "status" (delete from note)
    await statusCell.click();
    const clearBtn = page.locator('button[title*="Clear property"]').first();
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await page.waitForTimeout(500);

    raw = await fs.readFile(path.join(tempVaultDir, 'Task.md'), 'utf8');
    fm = parseFrontmatter(raw);
    expect(fm.properties.status).toBeUndefined();
  });

  test('2. Concurrency: human edit against stale row version triggers 409 conflict and preserves draft without overwrite', async ({
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
    await expect(page.locator('text=Task Alpha').first()).toBeVisible({ timeout: 5000 });

    // Human opens priority editor (priority is currently 2 from previous test)
    const priorityCell = page.getByTestId('cell-Task.md-priority');
    await priorityCell.click();
    const numInput = page.locator('input[type="number"]').first();
    await expect(numInput).toBeVisible();
    await numInput.fill('99'); // Human types 99 but does NOT save yet

    // External agent mutates note to priority 3 via Gateway REST (V1 -> V2)
    const currentNote = await agentClient.readNote('Task.md');
    await agentClient.setProperty({
      path: 'Task.md',
      key: 'priority',
      value: 3,
      expectedVersion: currentNote.version,
    });

    // Human now commits draft 99 using stale V1
    const saveBtn = page.locator('button[title="Save (Enter)"]').first();
    await saveBtn.click();

    // Verify 409 Conflict indicator appears
    await expect(page.locator('text=409 Conflict')).toBeVisible({ timeout: 5000 });

    // Verify human draft "99" is STILL in the input (draft preserved)
    await expect(numInput).toHaveValue('99');

    // Verify on disk: agent's value "3" was preserved and NOT overwritten by "99"
    const raw = await fs.readFile(path.join(tempVaultDir, 'Task.md'), 'utf8');
    const fm = parseFrontmatter(raw);
    expect(fm.properties.priority).toBe(3);
  });
});
