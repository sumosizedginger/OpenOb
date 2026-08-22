/**
 * apps/web/src/onboarding/storage.ts
 * Adapter for persisting OnboardingState across Desktop (Electron userData) and Standalone Web (localStorage).
 */

import { DEFAULT_ONBOARDING_STATE, OnboardingState, TUTORIAL_VERSION } from './types.js';

const STORAGE_KEY = 'openob:onboarding:v1';

export async function loadOnboardingState(): Promise<OnboardingState> {
  try {
    // 1. Try Desktop preload bridge first
    if (typeof window !== 'undefined' && window.openobDesktop?.getOnboardingState) {
      const desktopState = await window.openobDesktop.getOnboardingState();
      if (desktopState && desktopState.version === TUTORIAL_VERSION) {
        return {
          version: TUTORIAL_VERSION,
          dismissedFirstRun: Boolean(desktopState.dismissedFirstRun),
          quickTourCompleted: Boolean(desktopState.quickTourCompleted),
          completedChapters: Array.isArray(desktopState.completedChapters)
            ? desktopState.completedChapters.map(String)
            : [],
        };
      }
    }

    // 2. Fallback to localStorage
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.version === TUTORIAL_VERSION) {
          return {
            version: TUTORIAL_VERSION,
            dismissedFirstRun: Boolean(parsed.dismissedFirstRun),
            quickTourCompleted: Boolean(parsed.quickTourCompleted),
            completedChapters: Array.isArray(parsed.completedChapters)
              ? parsed.completedChapters.map(String)
              : [],
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to load onboarding state:', err);
  }

  return { ...DEFAULT_ONBOARDING_STATE };
}

export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  const normalizedState: OnboardingState = {
    version: TUTORIAL_VERSION,
    dismissedFirstRun: Boolean(state.dismissedFirstRun),
    quickTourCompleted: Boolean(state.quickTourCompleted),
    completedChapters: Array.isArray(state.completedChapters)
      ? Array.from(new Set(state.completedChapters.map(String)))
      : [],
  };

  try {
    // 1. Save to Desktop bridge if present
    if (typeof window !== 'undefined' && window.openobDesktop?.setOnboardingState) {
      await window.openobDesktop.setOnboardingState(normalizedState);
    }

    // 2. Always persist to localStorage as backup/web state
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to save onboarding state:', err);
  }
}
