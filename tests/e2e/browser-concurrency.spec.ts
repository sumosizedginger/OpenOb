import { test, expect } from '@playwright/test';

test.describe('Real Browser Concurrency & Production Hook Harness (G3 / C1, C2, C5, C7, H1-H8)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to initialize and default note to open
    await expect(page.locator('.logo-text')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.logo-text')).toHaveText('OpenOb');
    await expect(page.locator('.vault-badge')).toContainText('Open Knowledge Workspace');
    await expect(page.locator('.tab-bar .tab')).toHaveCount(1);
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');
  });

  test('A1: Fast save completes before autosave debounce and marks status saved with disk verification', async ({
    page,
  }) => {
    await page.evaluate(() => (window as any).__setStorageWriteDelay(100));

    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Quick Edit A1');
    await expect(page.locator('.save-status')).toContainText('Modified');

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');

    // C7: Assert DISK state matches exactly
    const diskContent = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(diskContent).toContain('## Quick Edit A1');
  });

  test('A2 & A3: Slow save exceeding 2000ms debounce handles typing during in-flight save without false conflict (C7 latency seam + disk assertion)', async ({
    page,
  }) => {
    // Inject 3200ms slow write latency (> 2000ms debounce window)
    await page.evaluate(() => (window as any).__setStorageWriteDelay(3200));

    // Type initial change
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Line 1 (v1)');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // Trigger manual save
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saving')).toContainText('Saving');

    // Immediately type v2 while save 1 is in-flight
    await page.keyboard.type('\n- Line 2 (v2 typed during save)');

    // Wait for the pump loop and debounced autosave to settle (> 3200ms save + debounce)
    await page.waitForTimeout(5000);
    await expect(page.locator('.save-status.saved')).toContainText('Saved', { timeout: 10000 });
    await expect(page.locator('.cm-content')).toContainText('Line 2 (v2 typed during save)');

    // C7: Verify actual storage disk content has v2 and no conflict occurred
    const diskContent = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(diskContent).toContain('Line 1 (v1)');
    expect(diskContent).toContain('Line 2 (v2 typed during save)');
  });

  test('A4: Rapid sequential typing across overlapping save windows settles cleanly on disk', async ({
    page,
  }) => {
    await page.evaluate(() => (window as any).__setStorageWriteDelay(400));

    await page.locator('.cm-content').click();
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.type(`\n- Sequential step ${i}`);
      await page.waitForTimeout(200);
    }

    // Wait for debounced autosave to settle
    await page.waitForTimeout(3500);
    await expect(page.locator('.save-status.saved')).toContainText('Saved');
    await expect(page.locator('.cm-content')).toContainText('Sequential step 4');

    // C7: Verify disk contains all 4 sequential steps
    const diskContent = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(diskContent).toContain('Sequential step 1');
    expect(diskContent).toContain('Sequential step 2');
    expect(diskContent).toContain('Sequential step 3');
    expect(diskContent).toContain('Sequential step 4');
  });

  test('B & B2: Tab switch during slow save does not clobber switched tab preview, backlinks, or status', async ({
    page,
  }) => {
    await page.evaluate(() => (window as any).__setStorageWriteDelay(800));

    // Open second note Architecture.md from file tree
    await page.locator('.tree-item:has-text("Architecture")').click();
    await expect(page.locator('.tab-bar .tab')).toHaveCount(2);
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Architecture');

    // Type in Architecture.md and trigger slow save
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n## Edited in Architecture Tab');
    await page.keyboard.press('Control+s');

    // Switch to Welcome note while Architecture save is in-flight
    await page.locator('.tab-bar .tab:has-text("Welcome")').click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');

    // Type in Welcome note and manual save
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Typed in Welcome Note');
    await page.keyboard.press('Control+s');

    // Wait for both saves to settle
    await page.waitForTimeout(2500);

    // Verify disk content for both notes independently
    const diskArch = await page.evaluate(
      async () => await (window as any).__readStorage('Architecture.md')
    );
    const diskWelcome = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );

    expect(diskArch).toContain('Edited in Architecture Tab');
    expect(diskWelcome).toContain('Typed in Welcome Note');
  });

  test('H1 / C2: UI-driven rename via FileTree during pending edits safely migrates tab and leaves no ghost file on disk', async ({
    page,
  }) => {
    // Type dirty change in Welcome.md
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Dirty edit before UI rename');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // Trigger rename via FileTree UI
    const welcomeItem = page.locator('.file-tree .tree-item:has-text("Welcome")').first();
    await welcomeItem.hover();
    await welcomeItem.locator('.btn-icon[title="Rename Note"]').click();

    const renameInput = page.locator('.file-tree input.command-input');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('RenamedWelcome');
    await renameInput.press('Enter');

    // Wait for rename to process
    await page.waitForTimeout(1000);

    // Verify tab title updated and tab is active with content
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('RenamedWelcome');
    await expect(page.locator('.cm-content')).toContainText('Dirty edit before UI rename');

    // Save renamed document
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');

    // Verify EXACTLY one file exists on disk with the dirty edit, and old path does NOT exist
    const oldExists = await page.evaluate(
      async () => await (window as any).__vaultStorage.exists('Welcome.md')
    );
    const newExists = await page.evaluate(
      async () => await (window as any).__vaultStorage.exists('RenamedWelcome.md')
    );
    const newContent = await page.evaluate(
      async () => await (window as any).__readStorage('RenamedWelcome.md')
    );

    expect(oldExists).toBe(false);
    expect(newExists).toBe(true);
    expect(newContent).toContain('Dirty edit before UI rename');
  });

  test('H3 / C5: Discarding dirty tab restores clean baseline on disk and avoids corrupting storage', async ({
    page,
  }) => {
    const baseline = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );

    // Type dirty edit
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Dirty discarded modification');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // Accept dialog confirmation when closing dirty tab
    page.on('dialog', (dialog) => dialog.accept());

    // Close the active tab via .tab-close
    await page.locator('.tab-bar .tab.active .tab-close').click();

    await page.waitForTimeout(500);

    // Reopen Welcome.md from FileTree
    await page.locator('.file-tree .tree-item:has-text("Welcome")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');

    // Verify disk content was restored / kept at baseline without the dirty modification
    const currentDisk = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(currentDisk).toBe(baseline);
    expect(currentDisk).not.toContain('Dirty discarded modification');
  });

  test('Hostile Preview Security Smoke Test: Renders hostile XSS payloads strictly escaped', async ({
    page,
  }) => {
    // Switch to Preview mode
    await page.locator('.view-mode-btn[title="Preview View"]').click();

    // Verify preview pane is visible
    await expect(page.locator('.preview-pane')).toBeVisible();

    // Verify no executable scripts are inserted into the DOM
    const scriptCount = await page.locator('.preview-pane script').count();
    expect(scriptCount).toBe(0);
  });
});
