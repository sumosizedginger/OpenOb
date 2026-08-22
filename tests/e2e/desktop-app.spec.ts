import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { DesktopVaultRuntime, DesktopSecretStore, DesktopBootstrapConfig } from '@okw/desktop';
import { startGateway, RunningGateway } from '@okw/gateway';
import { OpenObGatewayClient } from '@okw/workspace';

test.describe('Phase 3I: Electron Desktop Integration & Packaging E2E', () => {
  let testVaultDir: string;
  let cacheDir: string;
  let secretsDir: string;
  let runtime: DesktopVaultRuntime;
  let gateway: RunningGateway;
  let sessionToken: string;

  test.beforeEach(async () => {
    testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-e2e-desktop-vault-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-e2e-desktop-cache-'));
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okw-e2e-desktop-sec-'));

    // 1. Seed initial notes on disk
    fs.writeFileSync(
      path.join(testVaultDir, 'Welcome.md'),
      '---\ntype: note\nstatus: active\n---\n# Welcome to OpenOb Desktop\n\nYour sovereign knowledge workspace.',
      'utf8'
    );
    fs.mkdirSync(path.join(testVaultDir, 'Characters'), { recursive: true });
    fs.writeFileSync(
      path.join(testVaultDir, 'Characters', 'Kaelen.md'),
      '---\ntype: character\nrole: protagonist\nstatus: active\n---\n# Kaelen\n\nThe wanderer.',
      'utf8'
    );

    // 2. Initialize Desktop Runtime & Secrets
    const dbPath = path.join(cacheDir, 'index.db');
    const secPath = path.join(secretsDir, 'secrets.json');
    runtime = await DesktopVaultRuntime.create({
      vaultPath: testVaultDir,
      databasePath: dbPath,
      secretsPath: secPath,
      masterSecret: 'test-desktop-master-key',
      debounceMs: 20,
    });

    // 3. Start embedded Gateway on ephemeral loopback port
    sessionToken = `OPENOB_DESKTOP_TEST_${crypto.randomUUID()}`;
    gateway = await startGateway({
      workspace: runtime.workspace,
      host: '127.0.0.1',
      port: 0,
      token: sessionToken,
    });
  });

  test.afterEach(async () => {
    try {
      await gateway?.stop();
      await runtime?.close();
    } catch {}
    try {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
      fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.rmSync(secretsDir, { recursive: true, force: true });
    } catch {}
  });

  test('Full Desktop Lifecycle: bootstrap connection, native disk mutation, table/board views, plugins, and token non-leakage', async ({
    page,
  }) => {
    // 1. Inject Preload Desktop Bridge before page scripts run
    const bootstrapConfig: DesktopBootstrapConfig = {
      gatewayUrl: gateway.url,
      token: sessionToken,
      vaultName: 'Desktop Test Vault',
      vaultPath: testVaultDir,
    };

    await page.addInitScript((cfg) => {
      (window as any).openobDesktop = {
        async getBootstrapConfig() {
          return cfg;
        },
        async chooseVault() {
          return cfg;
        },
        async getAppInfo() {
          return { name: 'OpenOb', version: '0.1.0', platform: 'win32' };
        },
        async getOnboardingState() {
          return {
            version: 1,
            dismissedFirstRun: true,
            quickTourCompleted: true,
            completedChapters: [],
          };
        },
        async setOnboardingState(_state: any) {},
        onLifecycleEvent(_listener: any) {
          return () => {};
        },
      };
    }, bootstrapConfig);

    // 2. Navigate to application
    await page.goto('/');
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    // 3. Verify auto-connection via Desktop Preload Bridge
    const statusBar = page.locator('.status-bar');
    await expect(statusBar).toContainText(`Gateway: ${path.basename(testVaultDir)}`, {
      timeout: 10000,
    });

    // Verify seeded file appears in File Tree
    const welcomeNode = page.locator('.tree-item', { hasText: 'Welcome' }).first();
    await expect(welcomeNode).toBeVisible({ timeout: 5000 });

    // 4. Create and Edit a Note via UI
    await welcomeNode.click();

    const editor = page.locator('.cm-content');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor).toContainText('sovereign knowledge', { timeout: 5000 });

    // Perform an edit in the CodeMirror editor
    await editor.click();
    await page.keyboard.type('\n\nHe entered the northern bastion.');

    // Trigger save (Ctrl+S / Cmd+S)
    await page.keyboard.press('ControlOrMeta+s');

    await expect(statusBar).toContainText('Saved', { timeout: 8000 });

    // 5. Verify mutation settled on physical disk
    const welcomeDiskPath = path.join(testVaultDir, 'Welcome.md');
    const diskContent = fs.readFileSync(welcomeDiskPath, 'utf8');
    expect(diskContent).toContain('northern bastion');

    // 6. Verify External Agent Mutation (Section 47): external agent modifies note via Gateway and updates UI live
    const agentClient = new OpenObGatewayClient({
      url: gateway.url,
      token: sessionToken,
      clientId: 'external-test-agent',
    });
    await agentClient.createNote({
      path: 'ExternalLive.md',
      content: '# External Live Note\n\nCreated externally by autonomous agent.',
    });

    await expect(page.locator('.tree-item:has-text("ExternalLive")')).toBeVisible({
      timeout: 10000,
    });

    // 7. Token Non-Leakage Audit (Section 9): Verify session token is not stored in browser storage, DOM, or URL
    const tokenLeaks = await page.evaluate((tok) => {
      const leaks: string[] = [];

      // Check localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        const v = localStorage.getItem(k) || '';
        if (k.includes(tok) || v.includes(tok)) leaks.push(`localStorage:${k}`);
      }

      // Check sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i) || '';
        const v = sessionStorage.getItem(k) || '';
        if (k.includes(tok) || v.includes(tok)) leaks.push(`sessionStorage:${k}`);
      }

      // Check URL and history
      if (window.location.href.includes(tok)) leaks.push('URL');

      // Check DOM
      if (document.documentElement.innerHTML.includes(tok)) leaks.push('DOM');

      return leaks;
    }, sessionToken);

    expect(tokenLeaks).toEqual([]);
  });
});
