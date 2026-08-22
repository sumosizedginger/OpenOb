/**
 * apps/web/src/onboarding/types.ts
 * Type contracts for OpenOb Guided Onboarding & Learn Center.
 */

export const TUTORIAL_VERSION = 1;

export interface OnboardingState {
  version: number;
  dismissedFirstRun: boolean;
  quickTourCompleted: boolean;
  completedChapters: string[];
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  version: TUTORIAL_VERSION,
  dismissedFirstRun: false,
  quickTourCompleted: false,
  completedChapters: [],
};

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  readonly id: string;
  readonly target?: string; // Query selector or TOUR_TARGETS key
  readonly title: string;
  readonly content: string;
  readonly shortcut?: string;
  readonly placement?: TourPlacement;
  readonly prepareActionId?: string; // Safe UI state prep action (e.g. 'open-sidebar', 'view-split', etc.)
  readonly interactiveActionText?: string;
  readonly isFinalStep?: boolean;
}

export type ChapterCategory = 'getting-started' | 'editor-views' | 'advanced';

export interface TourChapter {
  readonly id: string;
  readonly title: string;
  readonly category: ChapterCategory;
  readonly description: string;
  readonly estimatedMinutes: number;
  readonly steps: readonly TourStep[];
}
