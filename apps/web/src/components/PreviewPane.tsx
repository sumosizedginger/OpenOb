import React from 'react';
import { ParsedDocument } from '@okw/core';

interface PreviewPaneProps {
  document: ParsedDocument | null;
  onNavigateWikilink: (target: string) => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  document,
  onNavigateWikilink,
}) => {
  if (!document) {
    return (
      <div className="preview-pane" style={{ color: 'var(--text-muted)' }}>
        No document open
      </div>
    );
  }

  // Render markdown lines with interactive wikilinks and tags
  const lines = document.textContent.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  let inFrontmatter = false;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Frontmatter toggle
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false;
      }
      continue;
    }

    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`}>
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={`h1-${i}`}>{line.slice(2)}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={`h2-${i}`}>{line.slice(3)}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={`h3-${i}`}>{line.slice(4)}</h3>);
      continue;
    }

    // List items
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <li key={`li-${i}`} style={{ marginLeft: '16px', color: 'var(--text-secondary)' }}>
          {renderInlineFormatting(line.trim().slice(2), onNavigateWikilink)}
        </li>
      );
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      elements.push(
        <p key={`p-${i}`}>
          {renderInlineFormatting(line, onNavigateWikilink)}
        </p>
      );
    }
  }

  return (
    <div className="preview-pane">
      {document.tags.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          {document.tags.map((tag) => (
            <span key={tag} className="tag-pill">
              #{tag}
            </span>
          ))}
        </div>
      )}
      {elements}
    </div>
  );
};

function renderInlineFormatting(text: string, onNavigate: (target: string) => void): React.ReactNode {
  // Replace [[Target|Alias]] with interactive links
  const parts: React.ReactNode[] = [];
  const regex = /(!?)\[\[([^\]\n]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const inner = match[2].trim();
    const pipeIndex = inner.indexOf('|');
    const target = pipeIndex !== -1 ? inner.slice(0, pipeIndex).trim() : inner;
    const display = pipeIndex !== -1 ? inner.slice(pipeIndex + 1).trim() : target;

    parts.push(
      <span
        key={`link-${match.index}`}
        className="wikilink"
        onClick={() => onNavigate(target)}
      >
        {display}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
