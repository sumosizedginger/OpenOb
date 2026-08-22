import React from 'react';
import { VaultPath } from '@okw/core';
import { QueryRowDTO } from '@okw/workspace';
import { FileText, Tag, Hash } from 'lucide-react';

interface ListViewProps {
  rows: QueryRowDTO[];
  onNavigate: (path: VaultPath) => void;
}

export const ListView: React.FC<ListViewProps> = ({ rows, onNavigate }) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        backgroundColor: 'var(--surface-canvas)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        userSelect: 'none',
      }}
    >
      {rows.map((row) => (
        <div
          key={row.path}
          onClick={() => onNavigate(row.path)}
          style={{
            backgroundColor: 'var(--surface-sidebar)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            cursor: 'pointer',
            transition: 'all var(--duration-fast) ease',
          }}
          className="tree-item"
        >
          {/* Left info: Icon, Title, Path */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                padding: '6px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-canvas)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FileText size={15} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.title || row.path}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.path}
              </div>
            </div>
          </div>

          {/* Right info: Tags, properties badges, word count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {/* Tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {row.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '10px',
                    backgroundColor: 'var(--surface-selected)',
                    color: 'var(--accent-primary)',
                    fontFamily: 'var(--font-mono)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <Tag size={8} />
                  {tag}
                </span>
              ))}
            </div>

            {/* Custom Frontmatter Properties summary */}
            {row.properties && Object.keys(row.properties).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {Object.entries(row.properties)
                  .filter(([k]) => k !== 'tags' && k !== 'tag' && k !== 'title')
                  .slice(0, 2)
                  .map(([k, v]) => {
                    const strVal =
                      typeof v === 'object' && v !== null
                        ? Array.isArray(v)
                          ? v.join(', ')
                          : JSON.stringify(v)
                        : String(v);
                    return (
                      <span
                        key={k}
                        style={{
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '10px',
                          backgroundColor: 'var(--surface-canvas)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{k}:</span>{' '}
                        {strVal}
                      </span>
                    );
                  })}
              </div>
            )}

            {/* Word count */}
            {row.wordCount !== undefined && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Hash size={11} />
                {row.wordCount} words
              </span>
            )}
          </div>
        </div>
      ))}

      {rows.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0',
            color: 'var(--text-muted)',
            gap: '8px',
          }}
        >
          <FileText size={32} style={{ opacity: 0.3 }} />
          <p>No documents match this query</p>
        </div>
      )}
    </div>
  );
};
