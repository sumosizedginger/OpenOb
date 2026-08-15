import React from 'react';
import { OpenTab } from '../hooks/useVault.js';
import { VaultPath } from '@okw/core';
import { X, FileText } from 'lucide-react';

interface TabBarProps {
  tabs: OpenTab[];
  activePath: VaultPath | null;
  onSelect: (path: VaultPath) => void;
  onClose: (path: VaultPath) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activePath,
  onSelect,
  onClose,
}) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isActive = tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(tab.path)}
          >
            <FileText size={13} style={{ opacity: 0.7 }} />
            <span className="tab-title">{tab.title || tab.path.split('/').pop()}</span>
            {tab.isDirty && <span className="tab-dirty-indicator" title="Unsaved changes" />}
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
            >
              <X size={12} />
            </span>
          </div>
        );
      })}
    </div>
  );
};
