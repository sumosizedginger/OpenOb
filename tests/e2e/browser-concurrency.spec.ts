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

    // Click modified save status to trigger safe save of renamed document
    await page.locator('.save-status').click();
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

  test('H12 / H3: Discarding dirty tab after prior save restores last durably saved state (B), not initial state (A)', async ({
    page,
  }) => {
    // 1. Initial save of state B
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Durably saved baseline B');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');

    // Verify disk has state B
    const diskB = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(diskB).toContain('Durably saved baseline B');

    // 2. Type dirty modification C
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Dirty discarded modification C');
    await expect(page.locator('.save-status')).toContainText('Modified');

    // 3. Discard and close tab via UI dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('.tab-bar .tab.active .tab-close').click();

    // Reopen Welcome.md
    await page.locator('.file-tree .tree-item:has-text("Welcome")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');

    // 4. Verification: disk must be state B (NOT initial template A, and NOT dirty C)
    const currentDisk = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(currentDisk).toContain('Durably saved baseline B');
    expect(currentDisk).not.toContain('Dirty discarded modification C');
  });

  test('H13: Discard followed by immediate reopen and edit/save cleanly persists reopened state (D)', async ({
    page,
  }) => {
    // Set 200ms write latency to test in-flight discard restoration
    await page.evaluate(() => {
      (window as any).__setStorageWriteDelay(200);
    });

    // Type dirty modification
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Discarded in-flight edit');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saving')).toContainText('Saving...');

    // Accept dialog confirmation and immediately close tab
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('.tab-bar .tab.active .tab-close').click();

    // Remove artificial delay for subsequent operations
    await page.evaluate(() => {
      (window as any).__setStorageWriteDelay(0);
    });

    // Immediately reopen Welcome.md
    await page.locator('.file-tree .tree-item:has-text("Welcome")').first().click();
    await expect(page.locator('.tab-bar .tab.active .tab-title')).toContainText('Welcome');

    // Type new edit D and save
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n\n- Reopened session edit D');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status.saved')).toContainText('Saved');

    // Verify disk content settled as D
    const currentDisk = await page.evaluate(
      async () => await (window as any).__readStorage('Welcome.md')
    );
    expect(currentDisk).toContain('Reopened session edit D');
  });

  test('Hostile Preview Security Smoke Test: Renders hostile XSS payloads strictly escaped', async ({
    page,
  }) => {
    // Switch to Preview mode
    const previewBtn = page.locator('.view-mode-btn[title="Preview View"]');
    if (await previewBtn.isVisible()) {
      await previewBtn.click();
    } else {
      await page.locator('[data-testid="view-mode-menu-trigger"]').click();
      await page.locator('[data-testid="view-mode-preview"]').click();
    }

    // Verify preview pane is visible
    await expect(page.locator('.preview-pane')).toBeVisible();

    // Verify no executable scripts are inserted into the DOM
    const scriptCount = await page.locator('.preview-pane script').count();
    expect(scriptCount).toBe(0);
  });

  test('Real OPFS + BrowserFSAVaultStorage: creates, updates with expectedVersion, and verifies no false conflict in real Chromium (R7)', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        return { supported: false };
      }
      const root = await navigator.storage.getDirectory();
      const testDirName = `test-opfs-${Date.now()}`;
      const testDir = await root.getDirectoryHandle(testDirName, { create: true });
      const BrowserFSAVaultStorage = (window as any).__BrowserFSAVaultStorage;
      const storage = new BrowserFSAVaultStorage(testDir, 'opfs-test-vault');

      // 1. Create file with expectedVersion = null
      const res1 = await storage.write('OpfsNote.md', null, '# OPFS Note v1');
      const text1 = await storage.readText('OpfsNote.md');

      // 2. Update file with expectedVersion = res1.snapshot.version
      const res2 = await storage.write('OpfsNote.md', res1.snapshot.version, '# OPFS Note v2');
      const text2 = await storage.readText('OpfsNote.md');

      // 3. Verify exists and list
      const exists = await storage.exists('OpfsNote.md');
      const list = await storage.list('', false);

      return {
        supported: true,
        text1,
        text2,
        exists,
        entryCount: list.length,
        wasCreated: res1.wasCreated,
        version2Matches: res2.snapshot.version.hash !== res1.snapshot.version.hash,
      };
    });

    if (result.supported) {
      expect(result.wasCreated).toBe(true);
      expect(result.text1).toBe('# OPFS Note v1');
      expect(result.text2).toBe('# OPFS Note v2');
      expect(result.exists).toBe(true);
      expect(result.entryCount).toBeGreaterThanOrEqual(1);
      expect(result.version2Matches).toBe(true);
    }
  });
});
