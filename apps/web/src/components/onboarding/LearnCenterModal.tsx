/**
 * apps/web/src/components/onboarding/LearnCenterModal.tsx
 * Comprehensive Learn Center modal listing all OpenOb tutorial chapters and progress.
 */

import React, { useState } from 'react';
import { TourChapter } from '../../onboarding/types.js';
import { LEARN_CHAPTERS, QUICK_TOUR_CHAPTER } from '../../onboarding/chapters.js';
import { CheckCircle, Clock, RotateCcw, Sparkles, X, Play, ArrowRight } from 'lucide-react';

interface LearnCenterModalProps {
  isOpen: boolean;
  completedChapters: string[];
  quickTourCompleted: boolean;
  onStartChapter: (chapter: TourChapter) => void;
  onResetProgress: () => void;
  onClose: () => void;
}

export const LearnCenterModal: React.FC<LearnCenterModalProps> = ({
  isOpen,
  completedChapters,
  quickTourCompleted,
  onStartChapter,
  onResetProgress,
  onClose,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<
    'all' | 'getting-started' | 'editor-views' | 'advanced'
  >('all');

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredChapters = LEARN_CHAPTERS.filter((chapter) => {
    if (selectedCategory === 'all') return true;
    return chapter.category === selectedCategory;
  });

  const totalChapters = LEARN_CHAPTERS.length;
  const completedCount = completedChapters.length;

  return (
    <div
      className="modal-overlay learn-center-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="learn-center-title"
    >
      <div className="modal-container learn-center-modal-container">
        {/* Header */}
        <div className="learn-center-header">
          <div className="learn-center-brand">
            <img
              src="/brand/openob-mark.png"
              alt="OpenOb Brand Mark"
              className="learn-center-logo"
              width={36}
              height={36}
            />
            <div>
              <h2 id="learn-center-title" className="learn-center-title">
                Learn OpenOb
              </h2>
              <p className="learn-center-subtitle">
                Interactive walkthroughs and guides for the local-first Markdown workspace.
              </p>
            </div>
          </div>
          <button
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close Learn Center"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Hero: Quick Tour */}
        <div className="learn-hero-card">
          <div className="learn-hero-left">
            <div className="learn-hero-badge">
              <Sparkles size={13} />
              <span>Recommended First</span>
            </div>
            <h3 className="learn-hero-title">Quick Tour</h3>
            <p className="learn-hero-desc">
              5-minute interactive walkthrough covering vault fundamentals, the CodeMirror editor,
              layout modes, inspector panels, and database views.
            </p>
            <div className="learn-hero-meta">
              <span className="learn-meta-item">
                <Clock size={13} /> 5 min
              </span>
              {quickTourCompleted && (
                <span className="learn-completed-badge">
                  <CheckCircle size={13} /> Completed
                </span>
              )}
            </div>
          </div>
          <div className="learn-hero-right">
            <button
              className="btn btn-primary learn-hero-btn"
              onClick={() => onStartChapter(QUICK_TOUR_CHAPTER)}
            >
              <Play size={14} />
              <span>{quickTourCompleted ? 'Replay Quick Tour' : 'Start Quick Tour'}</span>
            </button>
          </div>
        </div>

        {/* Category Tabs & Stats */}
        <div className="learn-nav-bar">
          <div className="learn-category-tabs">
            <button
              className={`learn-tab ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              All Chapters ({totalChapters})
            </button>
            <button
              className={`learn-tab ${selectedCategory === 'getting-started' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('getting-started')}
            >
              Getting Started
            </button>
            <button
              className={`learn-tab ${selectedCategory === 'editor-views' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('editor-views')}
            >
              Editor & Views
            </button>
            <button
              className={`learn-tab ${selectedCategory === 'advanced' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('advanced')}
            >
              Advanced
            </button>
          </div>

          <div className="learn-progress-stat">
            <span>
              {completedCount} of {totalChapters} chapters completed
            </span>
          </div>
        </div>

        {/* Chapter Grid */}
        <div className="learn-chapter-grid">
          {filteredChapters.map((chapter) => {
            const isCompleted = completedChapters.includes(chapter.id);
            return (
              <div
                key={chapter.id}
                className={`learn-chapter-card ${isCompleted ? 'completed' : ''}`}
              >
                <div className="learn-card-content">
                  <div className="learn-card-header">
                    <h4 className="learn-card-title">{chapter.title}</h4>
                    {isCompleted ? (
                      <span className="learn-badge-done">
                        <CheckCircle size={13} />
                        <span>Completed</span>
                      </span>
                    ) : (
                      <span className="learn-badge-time">
                        <Clock size={12} />
                        <span>{chapter.estimatedMinutes} min</span>
                      </span>
                    )}
                  </div>
                  <p className="learn-card-desc">{chapter.description}</p>
                </div>
                <div className="learn-card-footer">
                  <button
                    className="btn btn-secondary btn-sm learn-card-action"
                    onClick={() => onStartChapter(chapter)}
                  >
                    <span>{isCompleted ? 'Replay Chapter' : 'Start Chapter'}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="learn-center-footer">
          <button
            className="btn-link learn-reset-btn"
            onClick={onResetProgress}
            title="Reset all tutorial and tour progress"
          >
            <RotateCcw size={13} />
            <span>Reset Progress</span>
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
