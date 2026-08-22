import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

test.describe('Visual Screenshot Capture Harness', () => {
  let app: ElectronApplication;
  let page: Page;
  let tempUserDataDir: string;
  const screenshotsDir = path.resolve('artifacts/screenshots');

  test.beforeAll(async () => {
    await fs.mkdir(screenshotsDir, { recursive: true });
    tempUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-visual-profile-'));

    app = await electron.launch({
      args: ['apps/desktop/dist/main.cjs', `--user-data-dir=${tempUserDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-container', { timeout: 10000 });
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    await fs.rm(tempUserDataDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Capture Comprehensive Visual Suite', async () => {
    // If welcome modal is visible on first run, dismiss it
    const skipWelcome = page.locator('.welcome-skip-btn');
    try {
      await skipWelcome.waitFor({ state: 'visible', timeout: 3000 });
      await skipWelcome.click();
      await skipWelcome.waitFor({ state: 'hidden', timeout: 3000 });
    } catch {}

    // Click "Create Note" button
    const createBtn = page.locator('.btn-primary:has-text("Create Note")');
    if (await createBtn.isVisible()) {
      await createBtn.click();
    } else {
      await page.locator('button[title="New Note (Ctrl+N)"]').click();
    }

    await page.waitForSelector('.cm-content', { timeout: 5000 });

    const noteContent = `---
status: active
priority: high
category: architecture
tags:
  - architecture
  - offline
  - desktop
---

# The Architecture of Modern Knowledge Systems

Knowledge management in 2026 demands **low-friction prose**, deterministic versioning, and zero vendor lock-in.

## Key Principles

- [[Local-First Foundation]] — User files remain plain UTF-8 text on physical media.
- [[Deterministic OCC]] — Conflict resolution through token hashes and CAS.
- Fast interactive graph queries and bidirectional references.

### Task Roadmap
- [x] Phase 1: Markdown AST parser and OCC engine
- [x] Phase 2: React web workspace and CodeMirror 6 editor
- [x] Phase 3I: Electron native runtime and desktop packaging
- [ ] Public Alpha Release

> [!NOTE]
> OpenOb enforces strict data ownership: all vaults are 100% offline-capable with optional self-hosted gateway synchronization.

\`\`\`typescript
interface VaultSnapshot {
  readonly version: DocumentVersion;
  readonly content: string;
}
\`\`\`
`;

    // Insert content into CodeMirror editor instantly
    await page.click('.cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(noteContent);
    await page.waitForTimeout(100);

    // Save with Ctrl+S
    await page.keyboard.press('Control+S');
    await page.waitForTimeout(600);

    const conflictModal = page.locator('.modal-overlay.conflict-modal');
    if (await conflictModal.isVisible()) {
      const resolveBtn = conflictModal.locator('button').first();
      if (await resolveBtn.isVisible()) {
        await resolveBtn.click();
      }
    }

    // 1. Capture Flagship Screen: Active Note in Split View
    await page.screenshot({ path: path.join(screenshotsDir, '01-flagship-editor-split.png') });

    // 2. Capture Single Editor View
    if (await conflictModal.isVisible()) {
      const resolveBtn = conflictModal.locator('button').first();
      if (await resolveBtn.isVisible()) {
        await resolveBtn.click();
      }
    }
    await page.locator('[data-testid="view-mode-menu-trigger"]').click();
    await page.locator('[data-testid="view-mode-editor"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotsDir, '02-editor-single-pane.png') });

    // 3. Capture Single Preview View
    await page.locator('[data-testid="view-mode-menu-trigger"]').click();
    await page.locator('[data-testid="view-mode-preview"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotsDir, '03-preview-single-pane.png') });

    // Return to split view
    await page.locator('[data-testid="view-mode-menu-trigger"]').click();
    await page.locator('[data-testid="view-mode-split"]').click();
    await page.waitForTimeout(300);

    // 4. Capture Command Palette (Ctrl+P)
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.command-palette', { timeout: 3000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(screenshotsDir, '04-command-palette.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 5. Capture Properties Inspector Tab
    await page.locator('.inspector-tab:has-text("Properties")').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotsDir, '05-inspector-properties.png') });

    // 6. Capture AI Assistant Drawer
    await page.locator('[data-testid="toggle-ai"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotsDir, '06-inspector-ai-drawer.png') });

    // 7. Capture Database Views: Table
    await page.locator('[data-testid="main-mode-views"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotsDir, '07-database-table-view.png') });

    // 8. Capture Database Views: Board (Kanban)
    const boardBtn = page.locator('.view-mode-btn[title="Board View"]');
    if (await boardBtn.isVisible()) {
      await boardBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(screenshotsDir, '08-database-board-view.png') });
    }

    // Return to Editor
    await page.locator('[data-testid="main-mode-editor"]').click();
    await page.waitForTimeout(300);

    // 9. Capture Global Graph Modal (from overflow menu)
    await page.locator('[data-testid="more-menu"]').click();
    await page.waitForTimeout(200);
    const graphOption = page.locator('button:has-text("Global Graph View")');
    if (await graphOption.isVisible()) {
      await graphOption.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(screenshotsDir, '09-global-graph-view.png') });
      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 10. Capture Plugin Manager Modal
    await page.locator('[data-testid="more-menu"]').click();
    await page.waitForTimeout(200);
    const pluginOption = page.locator('button:has-text("Plugin Manager")');
    if (await pluginOption.isVisible()) {
      await pluginOption.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(screenshotsDir, '10-plugin-manager-modal.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });
});
