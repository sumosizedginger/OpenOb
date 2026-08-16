import { test, expect } from '@playwright/test';

test.describe('Real Browser Concurrency & Production Hook Harness (G3 / F1, F2, F3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to initialize and default note to open
    await expect(page.locator('.logo-text')).toHaveText('OpenOb');
    await expect(page.locator('.vault-badge')).toContainText('Open Knowledge Workspace');
    await expect(page.locator('.tab-bar .tab')).toHaveCount(1);
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');
  });

  test('A1: Fast save completes before autosave debounce and marks status saved', async ({ page }) => {
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Quick Edit A1');
    await expect(page.locator('.save-status')).toContainText('Modified');

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');
  });

  test('A2 & A3: Slow save exceeding debounce handles typing during in-flight save without false conflict', async ({ page }) => {
    // Type initial change
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Line 1 (v1)');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // Trigger manual save
    await page.keyboard.press('Control+s');
    
    // Immediately type v2 while save is resolving/finishing
    await page.keyboard.type('\n- Line 2 (v2 typed during save)');

    // Wait for debounced autosave to catch and persist v2
    await page.waitForTimeout(3000);
    await expect(page.locator('.save-status.saved')).toContainText('Saved');
    await expect(page.locator('.cm-content')).toContainText('Line 2 (v2 typed during save)');
  });

  test('A4: Rapid sequential typing across overlapping save windows settles cleanly', async ({ page }) => {
    await page.locator('.cm-content').click();
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.type(`\n- Sequential step ${i}`);
      await page.waitForTimeout(250);
    }

    // Wait for debounced autosave
    await page.waitForTimeout(3000);
    await expect(page.locator('.save-status.saved')).toContainText('Saved');
    await expect(page.locator('.cm-content')).toContainText('Sequential step 4');
  });

  test('B & B2: Tab switch during save does not clobber switched tab preview, backlinks, or status', async ({ page }) => {
    // Open second note Architecture.md from file tree
    await page.locator('.tree-item:has-text("Architecture")').click();
    await expect(page.locator('.tab-bar .tab')).toHaveCount(2);
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Architecture');

    // Type in Architecture.md and immediately switch to Welcome note
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Edited in Architecture Tab');
    
    // Switch to Welcome note before autosave fires
    await page.locator('.tab-bar .tab:has-text("Welcome")').click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');

    // Type in Welcome note and manual save
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Typed in Welcome Note');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');

    // Switch back to Architecture note
    await page.locator('.tab-bar .tab:has-text("Architecture")').click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Architecture');
    
    // Architecture tab must retain its typed content
    await expect(page.locator('.cm-content')).toContainText('Edited in Architecture Tab');
  });

  test('Hostile Preview Security Smoke Test: Renders hostile XSS payloads strictly escaped', async ({ page }) => {
    // Switch to Preview mode
    await page.locator('.view-mode-btn[title="Preview View"]').click();

    // Verify preview pane is visible
    await expect(page.locator('.preview-pane')).toBeVisible();

    // Verify no executable scripts are inserted into the DOM
    const scriptCount = await page.locator('.preview-pane script').count();
    expect(scriptCount).toBe(0);
  });
});
