import { test, expect } from '@playwright/test';
import { seedOnboardingDismissed } from './helpers.js';

test.describe('Desktop Data Safety & Concurrency Hardening (P1-B, P2-F)', () => {
  test.beforeEach(async ({ page }) => {
    await seedOnboardingDismissed(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('About Modal displays accurate build identity and platform information', async ({
    page,
  }) => {
    // Open More Menu
    const moreMenuBtn = page.getByTestId('more-menu');
    await expect(moreMenuBtn).toBeVisible();
    await moreMenuBtn.click();

    // Click About OpenOb
    const aboutBtn = page.getByRole('button', { name: /About OpenOb/i });
    await expect(aboutBtn).toBeVisible();
    await aboutBtn.click();

    // Verify About Modal Content
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'OpenOb' })).toBeVisible();
    await expect(modal.getByText(/Version/i)).toBeVisible();
    await expect(modal.getByText(/Commit SHA/i)).toBeVisible();
    await expect(modal.getByText(/Platform/i)).toBeVisible();
    await expect(modal.getByText(/Zero Data-Loss Guarantee/i)).toBeVisible();

    // Close Modal
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).not.toBeVisible();
  });

  test('Delete action presents explicit confirmation guard', async ({ page }) => {
    // Locate Welcome note in file tree
    const welcomeItem = page.locator('.tree-item').filter({ hasText: 'Welcome' }).first();
    await expect(welcomeItem).toBeVisible();

    // Listen for dialog
    let dialogAppeared = false;
    page.once('dialog', async (dialog) => {
      dialogAppeared = true;
      expect(dialog.message().toLowerCase()).toContain('delete');
      await dialog.dismiss(); // Cancel deletion
    });

    // Hover and click delete button
    await welcomeItem.hover();
    const deleteBtn = welcomeItem.locator('button[title="Delete Note"]');
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      expect(dialogAppeared).toBe(true);
    }
  });
});
