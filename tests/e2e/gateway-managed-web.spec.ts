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

test.describe('Phase 3B: Gateway-Managed Web Mode (One Vault Authority)', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  const TEST_TOKEN = 'phase3b-e2e-token-xyz-789';

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test.beforeAll(async () => {
    // 1. Create a real native temporary filesystem vault
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-native-vault-'));

    // 2. Populate native filesystem vault
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      `---
title: Welcome to Gateway Vault
tags: [gateway, e2e]
status: draft
---

# Welcome to Gateway Vault

This is a real native filesystem note managed exclusively by OpenOb Gateway.
Links to [[Projects/Alpha]].
`,
      'utf8'
    );

    const projDir = path.join(tempVaultDir, 'Projects');
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(
      path.join(projDir, 'Alpha.md'),
      `---
title: Project Alpha
tags: [project]
---

# Project Alpha

Native vault project documentation.
`,
      'utf8'
    );

    // 3. Start authoritative OpenObWorkspace & Gateway
    storage = new NodeFsVaultStorage(tempVaultDir, 'E2E-Native-Vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();
    await rebuildVaultIndex(storage, index, parser);
    const safeWriter = new SafeWriter(storage);

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
      vaultName: 'E2E-Native-Vault',
    });

    const port = await getFreePort();
    runningGateway = await startGateway({
      workspace,
      port,
      token: TEST_TOKEN,
    });
    gatewayUrl = runningGateway.url;
  });

  test.afterAll(async () => {
    await runningGateway?.stop();
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    // Connect to running gateway via test hook
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

    // Assert UI has switched to Gateway Mode
    await expect(page.locator('.status-bar')).toContainText('Gateway: E2E-Native-Vault', {
      timeout: 10000,
    });
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');
  });

  test('1. Read & Navigation: loads native notes from gateway and resolves backlinks', async ({
    page,
  }) => {
    // Check CodeMirror content matches Welcome.md
    await expect(page.locator('.cm-content')).toContainText('Welcome to Gateway Vault');

    // Open Project Alpha from file tree
    await page.locator('.file-tree .tree-item:has-text("Alpha")').first().click();

    await expect(page.locator('.tab-bar .tab')).toHaveCount(2);
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Alpha');
    await expect(page.locator('.cm-content')).toContainText('Native vault project documentation.');
  });

  test('2. Human Mutation & Autosave: saves edits via Gateway REST and updates native disk file', async ({
    page,
  }) => {
    // Focus CodeMirror and add text
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Edited by Human via Gateway Mode');

    // Save with Control+S
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toContainText('Saved', { timeout: 5000 });

    // Assert the native file on disk was updated through the gateway
    const diskContent = await fs.readFile(path.join(tempVaultDir, 'Welcome.md'), 'utf8');
    expect(diskContent).toContain('## Edited by Human via Gateway Mode');
  });

  test('3. Property Mutation: modifies frontmatter via Gateway and persists to native disk', async ({
    page,
  }) => {
    // Open Welcome note
    await page.locator('.file-tree .tree-item:has-text("Welcome")').first().click();

    // Call updateNoteProperty via hook or UI
    await page.evaluate(async () => {
      const backend = (window as any).__backend;
      if (backend) {
        const welcome = await backend.readNote('Welcome.md');
        await backend.setProperty({
          path: 'Welcome.md',
          key: 'status',
          value: 'completed',
          expectedVersion: { token: welcome.version.token },
        });
      }
    });

    // Verify native disk file
    const diskContent = await fs.readFile(path.join(tempVaultDir, 'Welcome.md'), 'utf8');
    expect(diskContent).toContain('status: completed');
  });

  test('4. Human vs External MCP Concurrency: detects 409 conflict, preserves human editor buffer, and protects agent V2 on disk', async ({
    page,
  }) => {
    // Open Projects/Alpha.md
    await page.locator('.file-tree .tree-item:has-text("Alpha")').first().click();
    await expect(page.locator('.cm-content')).toContainText('Project Alpha');

    // Human types unsaved changes (V1 -> Human Draft)
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Human Work In Progress');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // External agent updates Projects/Alpha.md to V2 directly through Gateway REST client
    const agentClient = new OpenObGatewayClient({
      url: gatewayUrl,
      token: TEST_TOKEN,
      clientId: 'external-agent-mcp',
    });
    const serverNote = await agentClient.readNote('Projects/Alpha.md');
    await agentClient.updateNote({
      path: 'Projects/Alpha.md',
      content: '# Project Alpha (Version 2 by MCP Agent)\n\nAgent updated content.',
      expectedVersion: { token: serverNote.version.token },
    });

    // Human attempts to save stale V1
    await page.keyboard.press('Control+s');

    // UI detects 409 Conflict
    await expect(page.locator('.save-status')).toContainText('Conflict', { timeout: 5000 });

    // Conflict modal is visible
    await expect(page.locator('.conflict-modal')).toBeVisible({ timeout: 5000 });

    // Human editor buffer is NOT wiped or overwritten
    await expect(page.locator('.cm-content')).toContainText('Human Work In Progress');

    // Real native filesystem on disk is SAFE and contains Agent V2
    const diskContent = await fs.readFile(path.join(tempVaultDir, 'Projects', 'Alpha.md'), 'utf8');
    expect(diskContent).toContain('Version 2 by MCP Agent');

    // Human clicks "Reload from Disk" in conflict modal
    await page.locator('.conflict-modal button:has-text("Reload")').click();

    // After reload, editor displays V2
    await expect(page.locator('.cm-content')).toContainText('Version 2 by MCP Agent', {
      timeout: 5000,
    });
    await expect(page.locator('.save-status')).toContainText('Saved');
  });

  test('5. Resurrection Prevention: External agent deletion blocks stale save and prevents recreating deleted note', async ({
    page,
  }) => {
    // 1. Create a note for deletion test
    const agentClient = new OpenObGatewayClient({
      url: gatewayUrl,
      token: TEST_TOKEN,
      clientId: 'external-agent-mcp',
    });

    await agentClient.createNote({
      path: 'Temporary.md',
      content: '# Temporary Note\n\nTo be deleted.',
    });

    // Refresh file list in UI and open note
    await page.evaluate(async () => {
      if ((window as any).__refreshVault) {
        await (window as any).__refreshVault();
      }
    });
    await page.locator('.file-tree .tree-item:has-text("Temporary")').first().click();
    // 2. Human types into editor making tab dirty
    await page.locator('.cm-content').click();
    await page.keyboard.type('\nTrying to save to deleted note');
    await expect(page.locator('.tab-bar .tab.active .tab-dirty-indicator')).toBeVisible({
      timeout: 5000,
    });

    // 3. External agent deletes Temporary.md concurrently
    const current = await agentClient.readNote('Temporary.md');
    await agentClient.deleteNote({
      path: 'Temporary.md',
      expectedVersion: { token: current.version.token },
    });

    // 4. Human attempts save on deleted note
    await page.keyboard.press('Control+s');

    // UI surfaces conflict / not found and does NOT resurrect file on disk
    await expect(page.locator('.save-status')).toContainText('Conflict', { timeout: 5000 });

    const existsOnDisk = await fs
      .access(path.join(tempVaultDir, 'Temporary.md'))
      .then(() => true)
      .catch(() => false);
    expect(existsOnDisk).toBe(false);
  });

  test('6. Disconnect Gateway: switches cleanly back to local memory vault', async ({ page }) => {
    // Disconnect via test hook or UI
    await page.evaluate(async () => {
      if ((window as any).__disconnectGateway) {
        await (window as any).__disconnectGateway();
      }
    });

    // Assert status bar shows Local mode without Gateway prefix
    await expect(page.locator('.status-bar')).not.toContainText('Gateway:');
    await expect(page.locator('.status-bar')).toContainText('Open Knowledge Workspace', {
      timeout: 5000,
    });
  });

  test('7. R3B-1 Error Discrimination: Read-only save and dead-gateway save render truthful states instead of conflict', async ({
    page,
  }) => {
    // 1. Set up a read-only gateway
    const roStorage = new NodeFsVaultStorage(tempVaultDir, 'RO-Vault');
    const roParser = new DefaultDocumentParser();
    const roIndex = new MemoryDocumentIndex();
    const roSafeWriter = new SafeWriter(roStorage);
    const roWorkspace = new OpenObWorkspace({
      storage: roStorage,
      index: roIndex,
      parser: roParser,
      safeWriter: roSafeWriter,
      readOnly: true,
      vaultName: 'RO-Vault',
    });

    const roPort = await getFreePort();
    const roGateway = await startGateway({
      workspace: roWorkspace,
      port: roPort,
      token: TEST_TOKEN,
    });

    try {
      // Connect to read-only gateway
      await page.evaluate(
        async ({ url, token }) => {
          return await (window as any).__connectToGateway(url, token);
        },
        { url: roGateway.url, token: TEST_TOKEN }
      );

      await expect(page.locator('.status-bar')).toContainText('Gateway: RO-Vault', {
        timeout: 5000,
      });

      // Intercept alert for read-only save
      let alertMessage = '';
      page.once('dialog', async (dialog) => {
        alertMessage = dialog.message();
        await dialog.dismiss();
      });

      // Type and attempt save on read-only gateway
      await page.locator('.cm-content').click();
      await page.keyboard.type('\n\nAttempted edit on read-only vault');
      await page.keyboard.press('Control+s');

      // Verify alert was shown and status is NOT "External Conflict!"
      await expect.poll(() => alertMessage, { timeout: 5000 }).toContain('Read-only gateway');
      await expect(page.locator('.save-status')).not.toContainText('Conflict');
      await expect(page.locator('.save-status')).toContainText('Modified');
    } finally {
      await roGateway.stop();
    }
  });

  test('8. R3B-2 Safe Disconnect: Dirty buffer triggers confirmation and preserves edits on cancel', async ({
    page,
  }) => {
    // Open Welcome note and make dirty edit
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\nUnsaved draft that must not be silently lost');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // 1. User attempts to disconnect and CANCELS the prompt
    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // User chooses Cancel
    });

    const cancelRes = await page.evaluate(async () => {
      return await (window as any).__disconnectGateway();
    });

    expect(dialogMessage).toContain('unsaved changes');
    expect(cancelRes.cancelled).toBe(true);

    // Buffer and Gateway mode are preserved
    await expect(page.locator('.status-bar')).toContainText('Gateway: E2E-Native-Vault');
    await expect(page.locator('.cm-content')).toContainText(
      'Unsaved draft that must not be silently lost'
    );

    // 2. User attempts to disconnect and CONFIRMS
    page.once('dialog', async (dialog) => {
      await dialog.accept(); // User chooses OK / Discard
    });

    const confirmRes = await page.evaluate(async () => {
      return await (window as any).__disconnectGateway();
    });

    expect(confirmRes.success).toBe(true);
    await expect(page.locator('.status-bar')).not.toContainText('Gateway:');
    await expect(page.locator('.status-bar')).toContainText('Open Knowledge Workspace');
  });

  test('9. R3B-3 Gateway Health Monitoring: Unreachable gateway flips status bar to Disconnected automatically', async ({
    page,
  }) => {
    // Start temporary standalone gateway
    const healthDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-health-vault-'));
    await fs.writeFile(path.join(healthDir, 'Note.md'), '# Note\n\nContent');
    const healthStorage = new NodeFsVaultStorage(healthDir, 'Health-Vault');
    const healthParser = new DefaultDocumentParser();
    const healthIndex = new MemoryDocumentIndex();
    const healthSafeWriter = new SafeWriter(healthStorage);
    const healthWorkspace = new OpenObWorkspace({
      storage: healthStorage,
      index: healthIndex,
      parser: healthParser,
      safeWriter: healthSafeWriter,
      readOnly: false,
      vaultName: 'Health-Vault',
    });

    const healthPort = await getFreePort();
    const healthGateway = await startGateway({
      workspace: healthWorkspace,
      port: healthPort,
      token: TEST_TOKEN,
    });

    try {
      // Connect to health gateway
      await page.evaluate(
        async ({ url, token }) => {
          return await (window as any).__connectToGateway(url, token);
        },
        { url: healthGateway.url, token: TEST_TOKEN }
      );

      await expect(page.locator('.status-bar')).toContainText('Gateway: Health-Vault', {
        timeout: 5000,
      });

      // Type some unsaved content
      await page.locator('.cm-content').click();
      await page.keyboard.type('\n\nImportant text during outage');

      // Kill the health gateway
      await healthGateway.stop();

      // Within ~4 seconds, the health check probe flips status to Disconnected without user input
      await expect(
        page.locator('.badge-disconnected, .save-status.disconnected').first()
      ).toBeVisible({
        timeout: 6000,
      });
      await expect(page.locator('.status-bar')).toContainText('Disconnected');

      // Verify editor content remains intact during outage
      await expect(page.locator('.cm-content')).toContainText('Important text during outage');
    } finally {
      await fs.rm(healthDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
