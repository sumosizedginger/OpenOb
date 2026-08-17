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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-header">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="search-modal-input"
            placeholder={
              selectedTag
                ? `Searching tag #${selectedTag}...`
                : 'Search note titles, content, or #tags...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {selectedTag && (
            <div className="search-tag-chip">
              <Tag size={12} />
              <span>#{selectedTag}</span>
              <button className="btn-icon" onClick={() => setSelectedTag(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="search-results-list">
          {results.length === 0 && (query.trim() || selectedTag) && (
            <div className="search-empty-state">No matching notes found.</div>
          )}

          {results.map((result, idx) => (
            <div
              key={result.path}
              className={`search-result-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                onSelectResult(result.path);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div className="result-header">
                <FileText size={14} className="result-icon" />
                <span className="result-title">{result.title || result.path}</span>
                <span className="result-path">{result.path}</span>
              </div>

              {result.excerpt && (
                <div className="result-snippet">
                  <div className="result-match-line">
                    <span className="match-line-text">{result.excerpt}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
