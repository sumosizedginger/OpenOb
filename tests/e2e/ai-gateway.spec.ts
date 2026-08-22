import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { OpenObWorkspace } from '@okw/workspace';
import { RunningGateway, startGateway } from '../../apps/gateway/src/server.js';
import { ServerSecretStore } from '@okw/ai';
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

test.describe('Phase 3G: AI Gateway Hardening & Grounded Retrieval E2E', () => {
  let tempVaultDir: string;
  let runningGateway: RunningGateway;
  let gatewayUrl: string;
  let workspace: OpenObWorkspace;
  let storage: NodeFsVaultStorage;
  let secretStore: ServerSecretStore;
  const TEST_TOKEN = 'phase3g-e2e-token-abc-123';

  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
  });

  test.beforeAll(async () => {
    // 1. Create a real native temporary filesystem vault
    tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-ai-gateway-vault-'));

    // 2. Populate native filesystem vault
    await fs.writeFile(
      path.join(tempVaultDir, 'Welcome.md'),
      `---
title: Welcome to Gateway Vault
tags: [gateway, ai, e2e]
status: draft
---

# Welcome to Gateway Vault

This is a real native filesystem note managed exclusively by OpenOb Gateway.
Links to [[Research/Quantum]].
`,
      'utf8'
    );

    const researchDir = path.join(tempVaultDir, 'Research');
    await fs.mkdir(researchDir, { recursive: true });
    await fs.writeFile(
      path.join(researchDir, 'Quantum.md'),
      `---
title: Quantum Computing
tags: [research, science]
---

# Quantum Computing

Quantum algorithms leverage superposition and entanglement for computational speedup.
`,
      'utf8'
    );

    // 3. Initialize workspace backend & server-side SecretStore
    storage = new NodeFsVaultStorage(tempVaultDir, 'ai-gateway-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();
    const safeWriter = new SafeWriter(storage);

    await rebuildVaultIndex(storage, index, parser);

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      vaultName: 'ai-gateway-vault',
      readOnly: false,
    });

    secretStore = new ServerSecretStore({
      OPENOB_AI_OPENAI_KEY: 'sk-env-default-openai-test-key-1234',
    });

    const port = await getFreePort();

    // 4. Start gateway with AI scopes (API server only; no static web serving)
    runningGateway = await startGateway({
      workspace,
      host: '127.0.0.1',
      port,
      token: TEST_TOKEN,
      scopes: [
        'workspace.read',
        'workspace.search',
        'workspace.write',
        'properties.write',
        'workspace.rename',
        'workspace.delete',
        'workspace.views.write',
        'workspace.ai.use',
        'workspace.ai.configure',
      ],
      secretStore,
    });

    gatewayUrl = runningGateway.url;
  });

  test.afterAll(async () => {
    if (runningGateway) {
      await runningGateway.stop();
    }
    if (tempVaultDir) {
      await fs.rm(tempVaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('Gateway AI Secret Protection & Zero-Browser-Storage Guarantee', async ({ page }) => {
    // 1. Visit Playwright web app
    await page.goto('/');
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    // 2. Connect running browser application to test Gateway
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
    await expect(page.locator('.status-bar')).toContainText('Gateway: ai-gateway-vault', {
      timeout: 10000,
    });

    // 3. Assert App precondition before AI controls
    await expect(page.locator('.app-container')).toBeVisible();
    await expect(page.locator('[data-testid="toggle-ai"]')).toBeVisible();

    // 4. Open AI Assistant panel via stable test id
    await page.locator('[data-testid="toggle-ai"]').click();

    // 5. Open BYOK Settings modal
    const settingsBtn = page.locator('button[title="BYOK & AI Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Select OpenAI provider to view its masked secret
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('openai');
    await expect(page.locator('text=sk-••••••••1234')).toBeVisible();

    // Configure Anthropic secret
    await providerSelect.selectOption('anthropic');

    const apiKeyInput = page.locator('input[placeholder*="Paste API Key"]');
    await apiKeyInput.fill('sk-ant-custom-anthropic-key-9999');
    await page.click('button:has-text("Save")');

    // Verify masked key shows up
    await expect(page.locator('text=sk-••••••••9999')).toBeVisible();

    // 6. Verify Raw Secret Zero-Leak Guarantee in browser storage
    const sessionStorageKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k) keys.push(k);
      }
      return keys;
    });

    const localStorageKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      return keys;
    });

    // Assert no okw_sec_* keys exist in sessionStorage or localStorage
    expect(sessionStorageKeys.some((k) => k.startsWith('okw_sec_'))).toBe(false);
    expect(localStorageKeys.some((k) => k.startsWith('okw_sec_'))).toBe(false);
  });

  test('Standalone Mode Cloud BYOK Isolation Notice', async ({ page }) => {
    // 1. Visit Web in Standalone mode (without connecting to gateway)
    await page.goto('/');
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    // 2. Assert App precondition
    await expect(page.locator('.app-container')).toBeVisible();
    await expect(page.locator('[data-testid="toggle-ai"]')).toBeVisible();

    // 3. Open AI Assistant panel
    await page.locator('[data-testid="toggle-ai"]').click();

    // 4. Open BYOK Settings modal
    const settingsBtn = page.locator('button[title="BYOK & AI Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Select a cloud provider in standalone mode
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('openai');

    // Verify clear isolation notice is displayed
    await expect(
      page
        .locator(
          'text=Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application state'
        )
        .first()
    ).toBeVisible();
  });

  test('Truthful Model Discovery & Error State in UI (G3G-2)', async ({ page }) => {
    // 1. Visit Playwright web app
    await page.goto('/');
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });

    // 2. Connect running browser application to test Gateway
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
    await expect(page.locator('.status-bar')).toContainText('Gateway: ai-gateway-vault', {
      timeout: 10000,
    });

    // 3. Assert App precondition
    await expect(page.locator('.app-container')).toBeVisible();
    await expect(page.locator('[data-testid="toggle-ai"]')).toBeVisible();

    // 4. Open AI Assistant panel
    await page.locator('[data-testid="toggle-ai"]').click();

    // 5. Select Ollama (which is dead in test environment)
    const settingsBtn = page.locator('button[title="BYOK & AI Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('ollama');

    // Close settings modal to view main drawer
    await page.locator('button[title="BYOK & AI Settings"]').click();

    // Verify unavailable / error state appears in UI
    await expect(page.locator('button:has-text("Retry")')).toBeVisible({ timeout: 5000 });

    // Verify model select option is disabled / unavailable (no fake "llama3" option)
    const modelOptions = await page.locator('select').nth(1).innerText();
    expect(modelOptions).toContain('Unavailable');
    expect(modelOptions).not.toContain('llama3');

    // 6. Switch to configured OpenAI provider
    await settingsBtn.click();
    await providerSelect.selectOption('openai');
    await page.locator('button[title="BYOK & AI Settings"]').click();

    // Verify real OpenAI models appear
    await expect(page.locator('select').nth(1)).toContainText('GPT-4o');
  });
});
