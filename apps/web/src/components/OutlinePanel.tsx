import React from 'react';
import { ParsedHeading } from '@okw/core';
import { ListTree, Hash } from 'lucide-react';

interface OutlinePanelProps {
  headings: ParsedHeading[];
  onSelectHeading: (heading: ParsedHeading) => void;
}

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  headings,
  onSelectHeading,
}) => {
  return (
    <div
      style={{
        width: '220px',
        minWidth: '180px',
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      <div className="sidebar-header">
        <span className="sidebar-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ListTree size={13} /> Outline ({headings.length})
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {headings.length === 0 ? (
          <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            No headings in document
          </div>
        ) : (
          headings.map((h, i) => (
            <div
              key={`${h.slug}-${i}`}
              className="tree-item"
              style={{
                paddingLeft: `${(h.level - 1) * 12 + 8}px`,
                fontSize: h.level === 1 ? '13px' : '12px',
                fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
                color: h.level === 1 ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onClick={() => onSelectHeading(h)}
              title={`Jump to line ${h.line}`}
            >
              <Hash size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
              <span className="tree-label">{h.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
