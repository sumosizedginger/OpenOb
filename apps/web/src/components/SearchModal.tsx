import React, { useEffect, useState } from 'react';
import { DocumentIndex, SearchResult, VaultPath } from '@okw/core';
import { Search, FileText, X, Tag } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  index: DocumentIndex;
  initialTag?: string | null;
  onClose: () => void;
  onSelectResult: (path: VaultPath) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  index,
  initialTag = null,
  onClose,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setSelectedTag(initialTag || null);
    }
  }, [isOpen, initialTag]);

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
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px' }}
      >
        <div className="command-input-wrapper">
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            className="command-input"
            placeholder={
              selectedTag
                ? `Searching in #${selectedTag}...`
                : 'Search all notes (FTS, headings, tags)...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
              } else if (e.key === 'Enter' && results[selectedIndex]) {
                e.preventDefault();
                onSelectResult(results[selectedIndex].path);
                onClose();
              }
            }}
          />
          {selectedTag && (
            <div
              className="tag-pill"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'var(--accent-glow)',
                color: 'var(--accent)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
              }}
            >
              <Tag size={12} />
              <span>#{selectedTag}</span>
              <X size={12} style={{ cursor: 'pointer' }} onClick={() => setSelectedTag(null)} />
            </div>
          )}
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="command-list" style={{ maxHeight: '380px' }}>
          {results.length === 0 ? (
            <div className="empty-state">
              {query || selectedTag
                ? 'No matching documents found'
                : 'Type to search across whole vault...'}
            </div>
          ) : (
            results.map((result, idx) => (
              <div
                key={result.documentId}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  onSelectResult(result.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '4px',
                  padding: '8px 12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={14} color="var(--accent)" />
                    <span style={{ fontWeight: 500 }}>{result.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {result.path}
                    </span>
                  </div>
                  <span
                    className="badge"
                    style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.8 }}
                  >
                    {result.source}
                  </span>
                </div>
                {result.excerpt && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: '100%',
                      paddingLeft: '22px',
                    }}
                  >
                    {result.excerpt}
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
