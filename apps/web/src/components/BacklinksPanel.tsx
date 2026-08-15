import React from 'react';
import { Backlink, VaultPath } from '@okw/core';
import { Link2, FileText, ChevronRight } from 'lucide-react';

interface BacklinksPanelProps {
  backlinks: Backlink[];
  onNavigate: (path: VaultPath) => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  backlinks,
  onNavigate,
}) => {
  return (
    <div
      style={{
        width: '240px',
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
          <Link2 size={13} /> Backlinks ({backlinks.length})
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {backlinks.length === 0 ? (
          <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            No incoming links
          </div>
        ) : (
          backlinks.map((b, i) => (
            <div
              key={`${b.sourceDocumentId}-${i}`}
              className="tree-item"
              style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '8px 10px', gap: '4px' }}
              onClick={() => onNavigate(b.sourcePath)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                <FileText size={13} color="var(--accent-primary)" />
                <span style={{ fontWeight: 500, fontSize: '12px', color: 'var(--text-primary)' }}>
                  {b.sourceTitle || b.sourcePath.split('/').pop()}
                </span>
                <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
              </div>
              {b.excerpt && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%',
                  }}
                >
                  {b.excerpt}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
