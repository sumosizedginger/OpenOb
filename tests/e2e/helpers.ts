/**
 * tests/e2e/helpers.ts
 * Shared Playwright E2E helpers for OpenOb tests.
 */

import { Page } from '@playwright/test';

/**
 * Seeds a dismissed onboarding state into the page's localStorage before React initializes.
 * Used exclusively by non-onboarding test suites (e.g. AI, Views, Plugins) to prevent
 * the first-run WelcomeModal overlay from intercepting workspace interactions.
 */
export async function seedOnboardingDismissed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'openob:onboarding:v1',
        JSON.stringify({
          version: 1,
          dismissedFirstRun: true,
          quickTourCompleted: true,
          completedChapters: [],
        })
      );
    } catch {}
  });
}
