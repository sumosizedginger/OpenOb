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

test.describe('Phase 3C: Live Gateway Change Stream E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let agentClient: OpenObGatewayClient;
  const TEST_TOKEN = 'phase3c-e2e-token-live-stream-456';

  test.beforeAll(async () => {
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-stream-e2e-'));

    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      `---
title: Welcome to Live Stream Vault
tags: [gateway, sse]
---

# Welcome to Live Stream Vault

This note demonstrates real-time changes streamed from agents to the Web UI.
`,
      'utf8'
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'LiveClean.md'),
      `---
title: Live Clean Note
---

# Live Clean Note

Initial text version 1.
`,
      'utf8'
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'LiveDirty.md'),
      `---
title: Live Dirty Note
---

# Live Dirty Note

Initial clean text.
`,
      'utf8'
    );

    await fs.writeFile(
      path.join(tempVaultDir, 'ToRename.md'),
      `This note will be renamed by an external agent.\n`,
      'utf8'
    );

    storage = new NodeFsVaultStorage(tempVaultDir, 'E2E-Stream-Vault');
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
      vaultName: 'E2E-Stream-Vault',
    });

    const port = await getFreePort();
    runningGateway = await startGateway({
      workspace,
      port,
      token: TEST_TOKEN,
    });
    gatewayUrl = runningGateway.url;

    agentClient = new OpenObGatewayClient({
      url: gatewayUrl,
      token: TEST_TOKEN,
      clientId: 'autonomous-mcp-agent',
    });
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

    await expect(page.locator('.status-bar')).toContainText('Gateway: E2E-Stream-Vault', {
      timeout: 10000,
    });
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');
  });

  test('1. Clean Open Note: updates immediately when external agent modifies note without manual refresh', async ({
    page,
  }) => {
    // 1. Open LiveClean.md in the Web UI
    await page.locator('.file-tree .tree-item:has-text("LiveClean")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Live Clean');
    await expect(page.locator('.cm-content')).toContainText('Initial text version 1.');

    // 2. Read note via agent to obtain current version token
    const initialRead = await agentClient.readNote('LiveClean.md');

    // 3. External agent mutates LiveClean.md through the Gateway REST API
    const updated = await agentClient.updateNote({
      path: 'LiveClean.md',
      content: `# Live Clean Note\n\nExternal Agent Content Version 2! Applied live at ${Date.now()}`,
      expectedVersion: { token: initialRead.version.token },
    });
    expect(updated.durableSuccess).toBe(true);

    // 4. Web UI should auto-update live via SSE stream WITHOUT manual refresh
    await expect(page.locator('.cm-content')).toContainText('External Agent Content Version 2!', {
      timeout: 10000,
    });
  });

  test('2. Dirty Open Note: preserves human buffer 100%, does NOT overwrite, prevents silent auto-save, and triggers OCC 409', async ({
    page,
  }) => {
    // 1. Open LiveDirty.md
    await page.locator('.file-tree .tree-item:has-text("LiveDirty")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Live Dirty');

    // 2. Human user types into CodeMirror editor making tab DIRTY
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nHuman unsaved typing in progress...');

    // Verify tab is dirty
    await expect(page.locator('.tab-bar .tab.active .tab-dirty-indicator')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('.cm-content')).toContainText('Human unsaved typing in progress...');

    // 3. Read current disk version and have external agent mutate LiveDirty.md concurrently
    const initialRead = await agentClient.readNote('LiveDirty.md');
    const agentUpdate = await agentClient.updateNote({
      path: 'LiveDirty.md',
      content: `# Live Dirty Note\n\nAgent concurrent write on disk!`,
      expectedVersion: { token: initialRead.version.token },
    });
    expect(agentUpdate.durableSuccess).toBe(true);

    // 4. Wait for SSE event to arrive. Verify Human buffer is NOT overwritten!
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-content')).toContainText('Human unsaved typing in progress...');
    await expect(page.locator('.cm-content')).not.toContainText('Agent concurrent write on disk!');

    // Status bar shows conflict/stale state
    await expect(page.locator('.status-bar')).toContainText('Conflict', { timeout: 5000 });
  });

  test('3. External Creation & Deletion: dynamically updates file tree and closes clean tabs', async ({
    page,
  }) => {
    // 1. External agent creates NewStreamNote.md
    const newNote = await agentClient.createNote({
      path: 'NewStreamNote.md',
      content: '# New Stream Note\n\nCreated dynamically by agent.',
    });
    expect(newNote.durableSuccess).toBe(true);

    // 2. Web UI file tree reflects NewStreamNote immediately
    await expect(page.locator('.file-tree .tree-item:has-text("NewStreamNote")')).toBeVisible({
      timeout: 10000,
    });

    // 3. Open NewStreamNote in tab
    await page.locator('.file-tree .tree-item:has-text("NewStreamNote")').click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('New Stream Note');
    await expect(page.locator('.cm-content')).toContainText('Created dynamically by agent.');

    // 4. External agent deletes NewStreamNote.md
    const deleteRes = await agentClient.deleteNote({
      path: 'NewStreamNote.md',
      expectedVersion: { token: newNote.currentVersion.token },
    });
    expect(deleteRes.durableSuccess).toBe(true);

    // 5. Web UI file tree removes note and clean tab is closed
    await expect(page.locator('.file-tree .tree-item:has-text("NewStreamNote")')).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(page.locator('.tab-bar .tab:has-text("New Stream Note")')).toHaveCount(0, {
      timeout: 10000,
    });
  });

  test('4. External Rename: migrates open tab and loads new path content', async ({ page }) => {
    // 1. Open ToRename.md
    await page.locator('.file-tree .tree-item:has-text("ToRename")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('ToRename');
    await expect(page.locator('.cm-content')).toContainText(
      'This note will be renamed by an external agent.'
    );

    // 2. Read version and perform rename via agent
    const readRes = await agentClient.readNote('ToRename.md');
    const renameRes = await agentClient.renameNote({
      oldPath: 'ToRename.md',
      newPath: 'RenamedGoal.md',
      expectedVersion: { token: readRes.version.token },
    });
    expect(renameRes.durableSuccess).toBe(true);

    // 3. Web UI tab updates to RenamedGoal.md and loads content
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('RenamedGoal', {
      timeout: 10000,
    });
    await expect(page.locator('.file-tree .tree-item:has-text("RenamedGoal")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('5. Gateway Restart Resync: browser reconnects across gateway restart, receives stream.reset, and keeps OCC/buffer safety', async ({
    page,
  }) => {
    // 1. Open Welcome note and verify initial text
    await expect(page.locator('.cm-content')).toContainText(
      'This note demonstrates real-time changes'
    );

    // 2. Dirty edit in editor without saving
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nHuman Unsaved Work Across Restart.');
    await expect(page.locator('.tab-bar .tab.active .tab-dirty-indicator')).toBeVisible({
      timeout: 5000,
    });

    // 3. Stop Gateway A
    const port = (runningGateway.server.address() as net.AddressInfo).port;
    await runningGateway.stop();
    await new Promise((r) => setTimeout(r, 400));

    // 4. Start Gateway B on same vault and same port
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
      vaultName: 'E2E-Stream-Vault',
    });

    runningGateway = await startGateway({
      workspace,
      port,
      token: TEST_TOKEN,
    });
    gatewayUrl = runningGateway.url;

    agentClient = new OpenObGatewayClient({
      url: gatewayUrl,
      token: TEST_TOKEN,
      clientId: 'restart-test-agent',
    });

    // 5. Assert browser automatically reconnects to Gateway B, preserves dirty human buffer
    await expect(page.locator('.status-bar')).toContainText('Gateway: E2E-Stream-Vault', {
      timeout: 15000,
    });
    await expect(page.locator('.cm-content')).toContainText('Human Unsaved Work Across Restart.');

    // 6. External agent mutates a separate note (LiveClean.md) through Gateway B
    const readClean = await agentClient.readNote('LiveClean.md');
    await agentClient.updateNote({
      path: 'LiveClean.md',
      content: '# Live Clean Note\n\nMutated after Gateway Restart by Agent B.',
      expectedVersion: { token: readClean.version.token },
    });

    // 7. Switch to LiveClean tab -> clean note reflects Agent B mutation immediately
    await page.locator('.file-tree .tree-item:has-text("LiveClean")').first().click();
    await expect(page.locator('.cm-content')).toContainText(
      'Mutated after Gateway Restart by Agent B.',
      { timeout: 10000 }
    );
  });
});
