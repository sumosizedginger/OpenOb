/**
 * apps/web/src/components/onboarding/TourOverlay.tsx
 * Interactive spotlight tour overlay and anchored guidance card.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TourChapter, TourStep } from '../../onboarding/types.js';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

interface TourOverlayProps {
  chapter: TourChapter | null;
  stepIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const TourOverlay: React.FC<TourOverlayProps> = ({
  chapter,
  stepIndex,
  onNext,
  onPrev,
  onSkip,
  onFinish,
}) => {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step: TourStep | undefined = chapter?.steps[stepIndex];
  const totalSteps = chapter?.steps.length ?? 0;
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1 || Boolean(step?.isFinalStep);

  // Update target bounding box
  const updateTargetRect = useCallback(() => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    const element = document.querySelector(step.target);
    if (element && element instanceof HTMLElement) {
      // Scroll into view if needed
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    } else {
      // Graceful fallback to centered modal
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    updateTargetRect();

    // Re-check after a brief animation frame to catch layout settled state
    const timer = setTimeout(updateTargetRect, 80);
    window.addEventListener('resize', updateTargetRect);
    window.addEventListener('scroll', updateTargetRect, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [updateTargetRect]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not steal keys if user is currently typing in an input or CodeMirror
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInput =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.classList.contains('cm-content');

      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
        return;
      }

      if (!isInput) {
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
          e.preventDefault();
          if (isLastStep) {
            onFinish();
          } else {
            onNext();
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (!isFirstStep) {
            onPrev();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFirstStep, isLastStep, onNext, onPrev, onSkip, onFinish]);

  if (!chapter || !step) return null;

  // Compute card positioning styles relative to target
  const getCardStyle = (): React.CSSProperties => {
    const cardWidth = 360;
    const padding = 16;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!targetRect) {
      // Centered fallback
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${cardWidth}px`,
        zIndex: 9999,
      };
    }

    const placement = step.placement ?? 'bottom';
    let top = 0;
    let left = 0;

    if (placement === 'bottom') {
      top = targetRect.top + targetRect.height + 12;
      left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    } else if (placement === 'top') {
      top = targetRect.top - 240;
      left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    } else if (placement === 'right') {
      top = targetRect.top + 10;
      left = targetRect.left + targetRect.width + 16;
    } else if (placement === 'left') {
      top = targetRect.top + 10;
      left = targetRect.left - cardWidth - 16;
    } else {
      // Center
      top = viewportHeight / 2 - 120;
      left = viewportWidth / 2 - cardWidth / 2;
    }

    // Viewport containment bounding
    if (left < padding) left = padding;
    if (left + cardWidth > viewportWidth - padding) {
      left = viewportWidth - cardWidth - padding;
    }
    if (top < padding) top = padding;
    if (top + 260 > viewportHeight - padding) {
      top = Math.max(padding, viewportHeight - 280);
    }

    return {
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${cardWidth}px`,
      zIndex: 9999,
    };
  };

  return (
    <div className="tour-overlay-root" role="dialog" aria-modal="true">
      {/* Background Dimmer */}
      <div className="tour-backdrop" onClick={onSkip} />

      {/* Target Cutout Spotlight */}
      {targetRect && (
        <div
          className="tour-spotlight"
          style={{
            top: `${Math.max(0, targetRect.top - 4)}px`,
            left: `${Math.max(0, targetRect.left - 4)}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
          }}
        />
      )}

      {/* Anchored Guidance Card */}
      <div ref={cardRef} className="tour-card" style={getCardStyle()}>
        <div className="tour-card-header">
          <div className="tour-badge-row">
            <span className="tour-chapter-name">{chapter.title}</span>
            <span className="tour-step-counter">
              {stepIndex + 1} / {totalSteps}
            </span>
          </div>
          <button
            className="tour-card-close"
            onClick={onSkip}
            aria-label="Close tour"
            title="Skip Tour (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        <div className="tour-card-body">
          <h3 className="tour-step-title">{step.title}</h3>
          <p className="tour-step-content">{step.content}</p>

          {step.shortcut && (
            <div className="tour-shortcut-pill">
              <span>Shortcut:</span>
              <kbd>{step.shortcut}</kbd>
            </div>
          )}
        </div>

        <div className="tour-card-footer">
          <button
            className="btn btn-secondary btn-sm"
            onClick={onPrev}
            disabled={isFirstStep}
            title="Previous Step (Left Arrow)"
          >
            <ArrowLeft size={13} />
            <span>Back</span>
          </button>

          <div className="tour-footer-right">
            <button className="tour-skip-link" onClick={onSkip}>
              Skip
            </button>

            {isLastStep ? (
              <button className="btn btn-primary btn-sm" onClick={onFinish} autoFocus>
                <span>Finish</span>
                <Check size={13} />
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={onNext} autoFocus>
                <span>Next</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
