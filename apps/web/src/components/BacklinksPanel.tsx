import React, { useState } from 'react';
import { Backlink, DocumentIndex, ParsedDocument, VaultPath } from '@okw/core';
import { Link2, FileText, ArrowUpRight, Plus, ExternalLink } from 'lucide-react';

interface BacklinksPanelProps {
  backlinks: Backlink[];
  parsedDoc?: ParsedDocument | null;
  index?: DocumentIndex;
  onNavigate: (path: VaultPath) => void;
  onCreateNote?: (name: string) => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  backlinks,
  parsedDoc,
  index,
  onNavigate,
  onCreateNote,
}) => {
  const [tab, setTab] = useState<'backlinks' | 'outgoing'>('backlinks');

  // Compute outgoing links and unresolved targets from active document
  const outgoingLinks: Array<{
    raw: string;
    target: string;
    resolved: boolean;
    targetPath?: string;
  }> = [];
  const seenTargets = new Set<string>();

  if (parsedDoc && index) {
    for (const link of parsedDoc.links) {
      if (!seenTargets.has(link.target)) {
        seenTargets.add(link.target);
        const res = index.resolveLink(parsedDoc.path, link.target);
        outgoingLinks.push({
          raw: link.raw,
          target: link.target,
          resolved: res.resolved,
          targetPath: res.targetPath,
        });
      }
    }
  }

  const resolvedOutgoing = outgoingLinks.filter((l) => l.resolved);
  const unresolvedOutgoing = outgoingLinks.filter((l) => !l.resolved);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', userSelect: 'none' }}>
      <div style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="view-mode-group" style={{ width: '100%' }}>
          <button
            className={`view-mode-btn ${tab === 'backlinks' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => setTab('backlinks')}
          >
            <Link2 size={12} />
            <span>Backlinks ({backlinks.length})</span>
          </button>
          <button
            className={`view-mode-btn ${tab === 'outgoing' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => setTab('outgoing')}
          >
            <ArrowUpRight size={12} />
            <span>Outgoing ({outgoingLinks.length})</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: '8px' }}>
        {tab === 'backlinks' ? (
          backlinks.length === 0 ? (
            <div
              style={{
                padding: '24px 8px',
                color: 'var(--text-muted)',
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              No incoming links to this note
            </div>
          ) : (
            backlinks.map((b, i) => (
              <div
                key={`${b.sourceDocumentId}-${i}`}
                className="tree-item"
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '8px 10px',
                  gap: '4px',
                  marginBottom: '4px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--surface-canvas)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
                onClick={() => onNavigate(b.sourcePath)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  <FileText size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.sourceTitle || b.sourcePath.split('/').pop()?.replace(/\.md$/, '')}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 5px',
                      backgroundColor: 'var(--surface-sidebar)',
                      color: 'var(--text-muted)',
                      borderRadius: 'var(--radius-sm)',
                      marginLeft: 'auto',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    L{b.line}
                  </span>
                </div>
                {b.excerpt && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%',
                      paddingLeft: '4px',
                      borderLeft: '2px solid var(--border-subtle)',
                    }}
                  >
                    {b.excerpt}
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          <div>
            {/* Connected Notes */}
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: '6px',
                letterSpacing: '0.02em',
              }}
            >
              CONNECTED NOTES ({resolvedOutgoing.length})
            </div>
            {resolvedOutgoing.length === 0 ? (
              <div
                style={{
                  padding: '12px 8px',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textAlign: 'center',
                }}
              >
                No connected outgoing links
              </div>
            ) : (
              resolvedOutgoing.map((l, i) => (
                <div
                  key={`out-${i}`}
                  className="tree-item"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '2px',
                  }}
                  onClick={() => l.targetPath && onNavigate(l.targetPath)}
                >
                  <ExternalLink
                    size={12}
                    style={{ color: 'var(--accent-primary)', opacity: 0.8 }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {l.targetPath?.split('/').pop()?.replace(/\.md$/, '') || l.target}
                  </span>
                </div>
              ))
            )}

            {/* Unresolved Links */}
            {unresolvedOutgoing.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--status-warning)',
                    marginBottom: '6px',
                    letterSpacing: '0.02em',
                  }}
                >
                  UNRESOLVED LINKS ({unresolvedOutgoing.length})
                </div>
                {unresolvedOutgoing.map((l, i) => (
                  <div
                    key={`unres-${i}`}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface-canvas)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      [[{l.target}]]
                    </span>
                    {onCreateNote && (
                      <button
                        className="btn-icon"
                        title={`Create "${l.target}.md"`}
                        style={{ width: '20px', height: '20px' }}
                        onClick={() => onCreateNote(l.target)}
                      >
                        <Plus size={11} style={{ color: 'var(--accent-primary)' }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
