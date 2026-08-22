/**
 * tests/e2e/onboarding-tour.spec.ts
 * Real Electron Guided Onboarding & Learn Center E2E Test Suite.
 * Validates first-run welcome, quick tour step-by-step walkthrough, skip behavior,
 * persistence across restarts, Learn Center replay, and visual screenshot captures.
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

test.describe('Real Electron Guided Onboarding & Learn Center (Sections 44, 45, 50, 51)', () => {
  let tempUserDataDir: string;
  const screenshotsDir = path.resolve('artifacts/screenshots/onboarding');

  test.beforeAll(async () => {
    await fs.mkdir(screenshotsDir, { recursive: true });
  });

  test('Full Onboarding Lifecycle: First Launch Welcome -> Quick Tour -> Persistence Across Restart -> Learn Center Replay', async () => {
    tempUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openob-onboarding-e2e-'));
    const mainScript = path.resolve('apps/desktop/dist/main.cjs');

    // -----------------------------------------------------------------------
    // SESSION 1: Fresh Launch (First Run)
    // -----------------------------------------------------------------------
    let app: ElectronApplication = await electron.launch({
      args: [mainScript, `--user-data-dir=${tempUserDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });

    let page: Page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-container', { timeout: 15000 });

    // 1. Verify Welcome Modal on First Run
    const welcomeOverlay = page.locator('.welcome-modal-overlay');
    await expect(welcomeOverlay).toBeVisible({ timeout: 10000 });

    // Verify Brand Mark in Welcome Modal
    const brandMark = page.locator('.welcome-brand-mark');
    await expect(brandMark).toBeVisible();
    expect(await brandMark.getAttribute('src')).toBe('/brand/openob-mark.png');

    // Verify Title and Description
    const welcomeTitle = page.locator('.welcome-title');
    await expect(welcomeTitle).toHaveText('Welcome to OpenOb');
    const welcomeDesc = page.locator('.welcome-description');
    await expect(welcomeDesc).toContainText('Your notes are ordinary Markdown files');

    // Capture Screenshot 1: Welcome Dialog
    await page.screenshot({ path: path.join(screenshotsDir, '01-onboarding-welcome.png') });

    // 2. Start the 5-Minute Quick Tour
    const startTourBtn = page.locator('.welcome-start-btn');
    await startTourBtn.click();

    // Verify Tour Overlay mounts
    const tourOverlay = page.locator('.tour-overlay-root');
    await expect(tourOverlay).toBeVisible({ timeout: 5000 });
    const tourCard = page.locator('.tour-card');
    await expect(tourCard).toBeVisible();

    // Step 1: Welcome (1 / 13)
    await expect(page.locator('.tour-step-counter')).toHaveText('1 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Welcome to OpenOb');

    // Advance to Step 2: Sidebar (2 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('2 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Your Vault Files');
    await page.screenshot({ path: path.join(screenshotsDir, '02-tour-spotlight-sidebar.png') });

    // Advance to Step 3: Create & Organize (3 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('3 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Create & Organize');

    // Advance to Step 4: Multi-Tab Workspace (4 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('4 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Multi-Tab Workspace');

    // Advance to Step 5: Fast Markdown Editor (5 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('5 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Fast Markdown Editor');
    await page.screenshot({ path: path.join(screenshotsDir, '03-tour-spotlight-editor.png') });

    // Advance to Step 6: Editor, Split & Preview (6 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('6 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Editor, Split & Preview');

    // Advance to Step 7: Search & Quick Open (7 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('7 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Instant Search & Quick Open');

    // Advance to Step 8: Contextual Inspector (8 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('8 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Contextual Inspector');

    // Advance to Step 9: Database Views (9 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('9 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Database Views');
    await page.screenshot({ path: path.join(screenshotsDir, '04-tour-views.png') });

    // Advance to Step 10: Interactive Knowledge Graph (10 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('10 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Interactive Knowledge Graph');

    // Advance to Step 11: Grounded Assistive AI (11 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('11 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Grounded Assistive AI');
    await page.screenshot({ path: path.join(screenshotsDir, '05-tour-ai.png') });

    // Advance to Step 12: Plugins & Settings (12 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('12 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('Plugins & Settings');

    // Advance to Step 13: Finish (13 / 13)
    await page.locator('.tour-card button:has-text("Next")').click();
    await expect(page.locator('.tour-step-counter')).toHaveText('13 / 13');
    await expect(page.locator('.tour-step-title')).toHaveText('You’re Ready to Write');

    // Complete the Quick Tour
    const finishBtn = page.locator('.tour-card button:has-text("Finish")');
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();

    // Verify tour overlay disappears
    await expect(page.locator('.tour-overlay-root')).not.toBeVisible();

    // Close Session 1
    await app.close();

    // -----------------------------------------------------------------------
    // SESSION 2: Subsequent Launch (Verify Non-Reappearance & Learn Center)
    // -----------------------------------------------------------------------
    app = await electron.launch({
      args: [mainScript, `--user-data-dir=${tempUserDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });

    page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-container', { timeout: 15000 });

    // 3. Verify Welcome Modal does NOT reappear on subsequent startup
    await page.waitForTimeout(500);
    const welcomeOnRestart = page.locator('.welcome-modal-overlay');
    expect(await welcomeOnRestart.isVisible()).toBe(false);

    // 4. Open Learn Center from More Menu
    const moreMenuBtn = page.locator('button[data-testid="more-menu"]');
    await moreMenuBtn.click();

    const learnMenuItem = page.locator('.more-menu-item:has-text("Learn OpenOb")');
    await expect(learnMenuItem).toBeVisible();
    await learnMenuItem.click();

    // Verify Learn Center Modal opens
    const learnCenterModal = page.locator('.learn-center-modal-overlay');
    await expect(learnCenterModal).toBeVisible();
    await expect(page.locator('.learn-center-title')).toHaveText('Learn OpenOb');

    // Verify Quick Tour is marked Completed
    const heroCompletedBadge = page.locator('.learn-completed-badge');
    await expect(heroCompletedBadge).toBeVisible();
    await expect(heroCompletedBadge).toContainText('Completed');

    // Capture Screenshot 6: Learn Center
    await page.screenshot({ path: path.join(screenshotsDir, '06-learn-center-home.png') });

    // 5. Test Category Filtering in Learn Center
    await page.locator('.learn-tab:has-text("Editor & Views")').click();
    await expect(page.locator('.learn-chapter-card')).toHaveCount(3);

    await page.locator('.learn-tab:has-text("All Chapters")').click();
    await expect(page.locator('.learn-chapter-card')).toHaveCount(11);

    // 6. Test Starting a Chapter from Learn Center
    const startChapterBtn = page.locator(
      '.learn-chapter-card:has-text("Writing & Markdown") .learn-card-action'
    );
    await startChapterBtn.click();

    // Verify Chapter Spotlight begins
    await expect(page.locator('.tour-overlay-root')).toBeVisible();
    await expect(page.locator('.tour-chapter-name')).toHaveText('Writing & Markdown Formatting');
    await expect(page.locator('.tour-step-counter')).toHaveText('1 / 4');

    // Press Escape to dismiss tour
    await page.keyboard.press('Escape');
    await expect(page.locator('.tour-overlay-root')).not.toBeVisible();

    // 7. Verify Keyboard Shortcuts Cheat Sheet Modal
    await moreMenuBtn.click();
    const shortcutsMenuItem = page.locator('.more-menu-item:has-text("Keyboard Shortcuts")');
    await expect(shortcutsMenuItem).toBeVisible();
    await shortcutsMenuItem.click();

    const shortcutsModal = page.locator('.shortcuts-modal-overlay');
    await expect(shortcutsModal).toBeVisible();
    await expect(page.locator('#shortcuts-title')).toHaveText('Keyboard Shortcuts');
    await page.screenshot({ path: path.join(screenshotsDir, '07-keyboard-shortcuts.png') });

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(shortcutsModal).not.toBeVisible();

    // 8. Test Runtime Keyboard Shortcuts (B-2)
    // Test Ctrl+B: Toggle Sidebar
    await expect(page.locator('.workspace-sidebar')).toBeVisible();
    await page.keyboard.press('Control+b');
    await expect(page.locator('.workspace-sidebar')).not.toBeVisible();
    await page.keyboard.press('Control+b');
    await expect(page.locator('.workspace-sidebar')).toBeVisible();

    // Test Ctrl+P / Ctrl+Shift+P: Command Palette / Quick Open
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.command-palette')).not.toBeVisible();

    await page.keyboard.press('Control+p');
    await expect(page.locator('.command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.command-palette')).not.toBeVisible();

    // Test Ctrl+N: Create Note
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(500);
    // Editor should be mounted/focused
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // Test Ctrl+\: Toggle Split View
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-editor')).toBeVisible();

    await app.close();
    await fs.rm(tempUserDataDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Modal Pointer Interception Regression: Welcome blocks interaction until dismissed', async () => {
    const testUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openob-intercept-e2e-'));
    const mainScript = path.resolve('apps/desktop/dist/main.cjs');

    const app = await electron.launch({
      args: [mainScript, `--user-data-dir=${testUserDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });

    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-container', { timeout: 15000 });

    // Welcome overlay is active
    const welcomeOverlay = page.locator('.welcome-modal-overlay');
    await expect(welcomeOverlay).toBeVisible({ timeout: 10000 });

    // Attempting to click underlying logo or button should be intercepted by the overlay
    let clickIntercepted = false;
    try {
      await page.locator('.app-logo').click({ timeout: 1500 });
    } catch (err: any) {
      clickIntercepted =
        err.message.includes('intercepts pointer events') || err.name === 'TimeoutError';
    }
    expect(clickIntercepted).toBe(true);

    // Skip welcome
    await page.locator('.welcome-skip-btn').click();
    await expect(welcomeOverlay).not.toBeVisible();

    // Workspace is now fully interactive
    await page.locator('.app-logo').click();
    expect(await page.locator('.app-logo').isVisible()).toBe(true);

    await app.close();
    await fs.rm(testUserDataDir, { recursive: true, force: true }).catch(() => {});
  });
});
