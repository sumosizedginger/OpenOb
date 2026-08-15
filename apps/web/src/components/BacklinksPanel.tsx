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
  const outgoingLinks: Array<{ raw: string; target: string; resolved: boolean; targetPath?: string }> = [];
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
    <div
      style={{
        width: '260px',
        minWidth: '200px',
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      <div className="sidebar-header" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
          <button
            className="btn"
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '11px',
              fontWeight: tab === 'backlinks' ? 600 : 400,
              backgroundColor: tab === 'backlinks' ? 'var(--bg-tertiary)' : 'transparent',
              color: tab === 'backlinks' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
            onClick={() => setTab('backlinks')}
          >
            <Link2 size={12} /> Backlinks ({backlinks.length})
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '11px',
              fontWeight: tab === 'outgoing' ? 600 : 400,
              backgroundColor: tab === 'outgoing' ? 'var(--bg-tertiary)' : 'transparent',
              color: tab === 'outgoing' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
            onClick={() => setTab('outgoing')}
          >
            <ArrowUpRight size={12} /> Outgoing ({outgoingLinks.length})
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {tab === 'backlinks' ? (
          backlinks.length === 0 ? (
            <div style={{ padding: '24px 8px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
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
                  marginBottom: '6px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-tertiary)',
                  cursor: 'pointer',
                }}
                onClick={() => onNavigate(b.sourcePath)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  <FileText size={13} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 500, fontSize: '12px', color: 'var(--text-primary)' }}>
                    {b.sourceTitle || b.sourcePath.split('/').pop()?.replace(/\.md$/, '')}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 4px',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-muted)',
                      borderRadius: '3px',
                      marginLeft: 'auto',
                    }}
                  >
                    L{b.line}
                  </span>
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
          )
        ) : (
          <div>
            {/* Resolved Outgoing Links */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Connected Notes ({resolvedOutgoing.length})
            </div>
            {resolvedOutgoing.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>
                No connected outgoing links
              </div>
            ) : (
              resolvedOutgoing.map((l, i) => (
                <div
                  key={`out-${i}`}
                  className="tree-item"
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '4px',
                  }}
                  onClick={() => l.targetPath && onNavigate(l.targetPath)}
                >
                  <ExternalLink size={12} color="var(--accent-primary)" />
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {l.targetPath?.split('/').pop()?.replace(/\.md$/, '') || l.target}
                  </span>
                </div>
              ))
            )}

            {/* Unresolved / Dangling Links */}
            {unresolvedOutgoing.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--status-warning, #eab308)', marginBottom: '6px' }}>
                  Unresolved Links ({unresolvedOutgoing.length})
                </div>
                {unresolvedOutgoing.map((l, i) => (
                  <div
                    key={`unres-${i}`}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      [[{l.target}]]
                    </span>
                    {onCreateNote && (
                      <button
                        className="btn-icon"
                        title={`Create "${l.target}.md"`}
                        style={{ padding: '2px 4px', height: 'auto' }}
                        onClick={() => onCreateNote(l.target)}
                      >
                        <Plus size={12} color="var(--accent-primary)" />
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
