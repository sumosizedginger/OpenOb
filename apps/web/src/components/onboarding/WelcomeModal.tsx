/**
 * apps/web/src/components/onboarding/WelcomeModal.tsx
 * First-launch welcome dialog for OpenOb.
 */

import React from 'react';
import { ArrowRight, X } from 'lucide-react';

interface WelcomeModalProps {
  isOpen: boolean;
  onStartTour: () => void;
  onSkip: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ isOpen, onStartTour, onSkip }) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onSkip]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay welcome-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="modal-container welcome-modal-container">
        <button
          className="modal-close-btn"
          onClick={onSkip}
          aria-label="Skip onboarding"
          title="Skip (Esc)"
        >
          <X size={16} />
        </button>

        <div className="welcome-modal-content">
          <div className="welcome-brand-header">
            <img
              src="/brand/openob-mark.png"
              alt="OpenOb logo — jackass skull within a broken gold sigil"
              className="welcome-brand-mark"
              width={56}
              height={56}
            />
            <h1 id="welcome-title" className="welcome-title">
              Welcome to OpenOb
            </h1>
          </div>

          <p className="welcome-description">
            Your notes are ordinary Markdown files stored directly on your computer. OpenOb helps
            you connect, search, organize, query, and work with them without locking them away.
          </p>

          <div className="welcome-modal-actions">
            <button className="btn btn-primary welcome-start-btn" onClick={onStartTour} autoFocus>
              <span>Start the 5-Minute Tour</span>
              <ArrowRight size={15} />
            </button>
            <button className="btn btn-secondary welcome-skip-btn" onClick={onSkip}>
              Skip
            </button>
          </div>

          <p className="welcome-helper-text">
            You can replay this interactive tour anytime from <strong>More → Learn OpenOb</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};
