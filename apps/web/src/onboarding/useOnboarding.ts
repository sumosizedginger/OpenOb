/**
 * apps/web/src/onboarding/useOnboarding.ts
 * React hook managing OpenOb onboarding state, tour transitions, and prepare actions.
 */

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_ONBOARDING_STATE, OnboardingState, TourChapter, TourStep } from './types.js';
import { loadOnboardingState, saveOnboardingState } from './storage.js';
import { QUICK_TOUR_CHAPTER } from './chapters.js';

export interface UseOnboardingOptions {
  onPrepareAction?: (actionId: string) => void | Promise<void>;
  isAppReady?: boolean;
}

export function useOnboarding({ onPrepareAction, isAppReady = true }: UseOnboardingOptions = {}) {
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(DEFAULT_ONBOARDING_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isLearnCenterOpen, setIsLearnCenterOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [activeChapter, setActiveChapter] = useState<TourChapter | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // 1. Initial State Load
  useEffect(() => {
    let isMounted = true;
    void loadOnboardingState().then((state) => {
      if (isMounted) {
        setOnboardingState(state);
        setIsLoaded(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Trigger Welcome Dialog on first run once app is ready
  useEffect(() => {
    if (isLoaded && isAppReady) {
      if (!onboardingState.dismissedFirstRun && !onboardingState.quickTourCompleted) {
        setIsWelcomeOpen(true);
      }
    }
  }, [isLoaded, isAppReady, onboardingState.dismissedFirstRun, onboardingState.quickTourCompleted]);

  // Execute safe prepare action on step change
  const executePrepareAction = useCallback(
    async (step: TourStep | undefined) => {
      if (step?.prepareActionId && onPrepareAction) {
        try {
          await onPrepareAction(step.prepareActionId);
        } catch (err) {
          console.warn('[Onboarding] Error in step prepare action:', err);
        }
      }
    },
    [onPrepareAction]
  );

  const startChapter = useCallback(
    async (chapter: TourChapter) => {
      setIsWelcomeOpen(false);
      setIsLearnCenterOpen(false);
      setActiveChapter(chapter);
      setCurrentStepIndex(0);

      const firstStep = chapter.steps[0];
      await executePrepareAction(firstStep);
    },
    [executePrepareAction]
  );

  const startQuickTour = useCallback(async () => {
    await startChapter(QUICK_TOUR_CHAPTER);
  }, [startChapter]);

  const skipFirstRun = useCallback(async () => {
    setIsWelcomeOpen(false);
    const updated: OnboardingState = {
      ...onboardingState,
      dismissedFirstRun: true,
    };
    setOnboardingState(updated);
    await saveOnboardingState(updated);
  }, [onboardingState]);

  const nextStep = useCallback(async () => {
    if (!activeChapter) return;
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < activeChapter.steps.length) {
      setCurrentStepIndex(nextIdx);
      const nextStep = activeChapter.steps[nextIdx];
      await executePrepareAction(nextStep);
    }
  }, [activeChapter, currentStepIndex, executePrepareAction]);

  const prevStep = useCallback(async () => {
    if (!activeChapter) return;
    const prevIdx = currentStepIndex - 1;
    if (prevIdx >= 0) {
      setCurrentStepIndex(prevIdx);
      const prevStep = activeChapter.steps[prevIdx];
      await executePrepareAction(prevStep);
    }
  }, [activeChapter, currentStepIndex, executePrepareAction]);

  const skipTour = useCallback(() => {
    setActiveChapter(null);
    setCurrentStepIndex(0);
  }, []);

  const finishTour = useCallback(async () => {
    if (!activeChapter) return;

    const isQuickTour = activeChapter.id === QUICK_TOUR_CHAPTER.id;
    const updatedChapters = Array.from(
      new Set([...onboardingState.completedChapters, activeChapter.id])
    );

    const updated: OnboardingState = {
      ...onboardingState,
      dismissedFirstRun: true,
      quickTourCompleted: isQuickTour ? true : onboardingState.quickTourCompleted,
      completedChapters: updatedChapters,
    };

    setOnboardingState(updated);
    await saveOnboardingState(updated);
    setActiveChapter(null);
    setCurrentStepIndex(0);
  }, [activeChapter, onboardingState]);

  const resetProgress = useCallback(async () => {
    const resetState = { ...DEFAULT_ONBOARDING_STATE };
    setOnboardingState(resetState);
    await saveOnboardingState(resetState);
  }, []);

  return {
    isLoaded,
    onboardingState,
    isWelcomeOpen,
    isLearnCenterOpen,
    isShortcutsOpen,
    activeChapter,
    currentStepIndex,
    startQuickTour,
    skipFirstRun,
    startChapter,
    nextStep,
    prevStep,
    skipTour,
    finishTour,
    resetProgress,
    openLearnCenter: () => setIsLearnCenterOpen(true),
    closeLearnCenter: () => setIsLearnCenterOpen(false),
    openShortcuts: () => setIsShortcutsOpen(true),
    closeShortcuts: () => setIsShortcutsOpen(false),
  };
}
