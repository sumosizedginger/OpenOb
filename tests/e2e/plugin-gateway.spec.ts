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

test.describe('Phase 3H: Plugin SDK Authority & Gateway Integration E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3h-plugins-e2e-token-123';

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-plugins-e2e-'));

    // Create Templates directory with custom meeting template
    await fs.mkdir(path.join(tempVaultDir, 'Templates'), { recursive: true });
    await fs.writeFile(
      path.join(tempVaultDir, 'Templates', 'Meeting.md'),
      `---
title: {{title}}
date: {{date}}
tags: [meeting, e2e]
---
# {{title}}
E2E Meeting created at {{time}}.`
    );

    storage = new NodeFsVaultStorage(tempVaultDir);
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, new DefaultDocumentParser());

    workspace = new OpenObWorkspace({
      vaultName: 'PluginGatewayVault',
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

  test('Executes Daily Notes & Templates plugins through Gateway backend with OCC versioning', async ({
    page,
  }) => {
    // 1. Navigate to Web UI and connect to Gateway
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
    await expect(page.locator('.status-bar')).toContainText('Gateway: PluginGatewayVault', {
      timeout: 10000,
    });

    // 2. Trigger Daily Notes plugin command
    const dailyRes = await page.evaluate(async () => {
      const host = (window as any).__pluginHost;
      if (!host) throw new Error('__pluginHost not found on window');
      return await host.executeCommand('dailyNotes.openToday');
    });
    expect(dailyRes.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const dailyDiskPath = path.join(tempVaultDir, 'Daily', `${today}.md`);

    // Verify note was physically written to disk on Gateway
    const dailyContent = await fs.readFile(dailyDiskPath, 'utf8');
    expect(dailyContent).toContain(`# Daily Note: ${today}`);

    // Verify note is loaded into active editor in UI
    await expect(page.locator('.cm-content')).toContainText(`Daily Note: ${today}`, {
      timeout: 10000,
    });

    // 3. Trigger Templates plugin command
    const templateRes = await page.evaluate(async () => {
      const host = (window as any).__pluginHost;
      return await host.executeCommand('templates.createFromTemplate');
    });
    expect(templateRes.success).toBe(true);

    const templateDiskPath = path.join(tempVaultDir, 'Notes', `Meeting-${today}.md`);

    // Verify meeting note written to Gateway disk with interpolated variables
    const templateNoteContent = await fs.readFile(templateDiskPath, 'utf8');
    expect(templateNoteContent).toContain(`title: Meeting-${today}`);
    expect(templateNoteContent).toContain(`date: ${today}`);
    expect(templateNoteContent).not.toContain('{{title}}');

    // 4. Verify live Word Count plugin execution on active note
    const wordCountRes = await page.evaluate(async () => {
      const host = (window as any).__pluginHost;
      return await host.executeCommand('wordCount.compute');
    });
    expect(wordCountRes.success).toBe(true);
  });
});
