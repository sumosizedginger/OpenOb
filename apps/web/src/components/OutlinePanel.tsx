import React from 'react';
import { ParsedHeading } from '@okw/core';
import { Hash } from 'lucide-react';

interface OutlinePanelProps {
  headings: ParsedHeading[];
  onSelectHeading: (heading: ParsedHeading) => void;
}

export const OutlinePanel: React.FC<OutlinePanelProps> = ({ headings, onSelectHeading }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', userSelect: 'none' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {headings.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            No headings in this note
          </div>
        ) : (
          headings.map((h, i) => (
            <div
              key={`${h.slug}-${i}`}
              className="tree-item"
              style={{
                paddingLeft: `${(h.level - 1) * 12 + 6}px`,
                fontSize: h.level === 1 ? '13px' : '12px',
                fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
                color: h.level === 1 ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onClick={() => onSelectHeading(h)}
              title={`Jump to line ${h.line}`}
            >
              <Hash size={11} style={{ opacity: 0.45, flexShrink: 0 }} />
              <span className="tree-label">{h.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
