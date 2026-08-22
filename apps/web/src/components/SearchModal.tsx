import React, { useEffect, useState } from 'react';
import { DocumentIndex, SearchResult, VaultPath } from '@okw/core';
import { Search, FileText, X, Tag } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  index?: DocumentIndex;
  searchFn?: (query: string, tag?: string | null) => Promise<SearchResult[]>;
  initialTag?: string | null;
  onClose: () => void;
  onSelectResult: (path: VaultPath) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  index,
  searchFn,
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
        if (searchFn) {
          try {
            const res = await searchFn(query.trim(), selectedTag);
            setResults(res);
            setSelectedIndex(0);
          } catch (err) {
            console.error('Search failed:', err);
            setResults([]);
          }
        } else if (index) {
          const scope = selectedTag ? { tags: [selectedTag] } : undefined;
          const res = await index.query({
            query: query.trim() || selectedTag || '',
            scope,
            limit: 20,
          });
          setResults(res);
          setSelectedIndex(0);
        }
      } else {
        setResults([]);
        setSelectedIndex(0);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, selectedTag, isOpen, index, searchFn]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0)
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (results[selectedIndex]) {
        onSelectResult(results[selectedIndex].path);
        onClose();
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px' }}
      >
        <div className="command-input-wrapper">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="command-input"
            placeholder={
              selectedTag
                ? `Searching #${selectedTag}...`
                : 'Search notes by title, text, or tags...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {selectedTag && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--surface-selected)',
                color: 'var(--accent-primary)',
                fontSize: '11px',
              }}
            >
              <Tag size={10} />
              <span>#{selectedTag}</span>
              <button
                className="btn-icon"
                style={{ width: '14px', height: '14px' }}
                onClick={() => setSelectedTag(null)}
              >
                <X size={9} />
              </button>
            </div>
          )}
          <button className="btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="command-list" style={{ maxHeight: '420px' }}>
          {results.length === 0 && (query.trim() || selectedTag) && (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px',
              }}
            >
              No matching notes found.
            </div>
          )}

          {results.map((result, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={result.path}
                className={`command-item ${isSelected ? 'selected' : ''}`}
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '4px',
                  padding: '8px 12px',
                }}
                onClick={() => {
                  onSelectResult(result.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  <FileText
                    size={13}
                    style={{ color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                  />
                  <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                    {result.title || result.path}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      marginLeft: 'auto',
                    }}
                  >
                    {result.path}
                  </span>
                </div>

                {result.excerpt && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      paddingLeft: '6px',
                      borderLeft: '2px solid var(--border-subtle)',
                      lineHeight: '1.4',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {result.excerpt}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
