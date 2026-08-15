import React, { useEffect, useState } from 'react';
import { DocumentIndex, SearchResult, VaultPath } from '@okw/core';
import { Search, FileText, X } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  index: DocumentIndex;
  onClose: () => void;
  onSelectResult: (path: VaultPath) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  index,
  onClose,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setSelectedTag(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(async () => {
      if (query.trim() || selectedTag) {
        const scope = selectedTag ? { tags: [selectedTag] } : undefined;
        const res = await index.query({
          query: query.trim() || selectedTag || '',
          scope,
          limit: 20,
        });
        setResults(res);
        setSelectedIndex(0);
      } else {
        setResults([]);
        setSelectedIndex(0);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, selectedTag, isOpen, index]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="command-input-wrapper">
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            className="command-input"
            placeholder="Search all notes, text, headings, and tags..."
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1 < results.length ? prev + 1 : prev));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
              }
              if (e.key === 'Enter' && results.length > 0) {
                const targetResult = results[selectedIndex] || results[0];
                onSelectResult(targetResult.path);
                onClose();
              }
            }}
          />
          {selectedTag && (
            <span
              className="tag-pill"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={() => setSelectedTag(null)}
              title="Click to clear tag filter"
            >
              #{selectedTag} <X size={10} />
            </span>
          )}
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="command-list" style={{ maxHeight: '420px' }}>
          {results.length === 0 ? (
            <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
              {query.trim() ? 'No matching notes found' : 'Type a query to search across the entire vault'}
            </div>
          ) : (
            results.map((r, idx) => (
              <div
                key={r.documentId}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}
                onClick={() => {
                  onSelectResult(r.path);
                  onClose();
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={14} color="var(--accent-primary)" />
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {r.title}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.path}</span>
                  </div>
                  <span className="command-badge" style={{ fontSize: '9px', textTransform: 'uppercase' }}>
                    {r.source}
                  </span>
                </div>
                {r.excerpt && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      paddingLeft: '22px',
                      lineHeight: '1.4',
                    }}
                  >
                    {r.excerpt}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
