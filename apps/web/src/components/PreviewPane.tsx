import React from 'react';
import { ParsedDocument } from '@okw/core';
import { matchCalloutHeader, matchTaskLine } from '@okw/markdown';
import { Callout } from './Callout.js';

interface PreviewPaneProps {
  document: ParsedDocument | null;
  onNavigateWikilink: (target: string) => void;
  onToggleTask?: (lineNumber: number, text?: string) => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  document,
  onNavigateWikilink,
  onToggleTask,
}) => {
  if (!document) {
    return (
      <div className="preview-pane" style={{ color: 'var(--text-muted)' }}>
        No document open
      </div>
    );
  }

  const lines = document.textContent.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  let inFrontmatter = false;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  let inCallout = false;
  let currentCallout: { type: any; title: string; lines: string[] } | null = null;

  const flushCallout = (keyIndex: number) => {
    if (currentCallout) {
      elements.push(
        <Callout key={`callout-${keyIndex}`} type={currentCallout.type} title={currentCallout.title}>
          {currentCallout.lines.map((l, li) => (
            <p key={`cl-${li}`} style={{ margin: '4px 0' }}>
              {renderInlineFormatting(l, onNavigateWikilink)}
            </p>
          ))}
        </Callout>
      );
      currentCallout = null;
      inCallout = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

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
      flushCallout(i);
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

    // Callout handling (> [!NOTE] ...)
    const calloutHeader = matchCalloutHeader(line);
    if (calloutHeader) {
      flushCallout(i);
      inCallout = true;
      currentCallout = {
        type: calloutHeader.type,
        title: calloutHeader.title,
        lines: [],
      };
      continue;
    }

    if (inCallout) {
      if (line.startsWith('>')) {
        currentCallout?.lines.push(line.replace(/^>\s?/, ''));
        continue;
      } else {
        flushCallout(i);
      }
    }

    // Task checkbox item (- [ ] Task or - [x] Task)
    const taskItem = matchTaskLine(line, lineNumber);
    if (taskItem) {
      elements.push(
        <div
          key={`task-${lineNumber}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            margin: '6px 0',
            marginLeft: `${taskItem.indent * 12 + 16}px`,
          }}
        >
          <input
            type="checkbox"
            checked={taskItem.checked}
            onChange={() => onToggleTask?.(lineNumber, taskItem.text)}
            style={{ marginTop: '4px', cursor: 'pointer' }}
          />
          <span
            style={{
              color: taskItem.checked ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: taskItem.checked ? 'line-through' : 'none',
            }}
          >
            {renderInlineFormatting(taskItem.text, onNavigateWikilink)}
          </span>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      const headingText = line.slice(2);
      elements.push(<h1 key={`h1-${i}`} id={`heading-${lineNumber}`}>{headingText}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      const headingText = line.slice(3);
      elements.push(<h2 key={`h2-${i}`} id={`heading-${lineNumber}`}>{headingText}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      const headingText = line.slice(4);
      elements.push(<h3 key={`h3-${i}`} id={`heading-${lineNumber}`}>{headingText}</h3>);
      continue;
    }

    // Regular list items
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <li key={`li-${i}`} style={{ marginLeft: '16px', color: 'var(--text-secondary)' }}>
          {renderInlineFormatting(line.trim().slice(2), onNavigateWikilink)}
        </li>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      elements.push(
        <blockquote
          key={`quote-${i}`}
          style={{
            borderLeft: '3px solid var(--border-medium)',
            paddingLeft: '12px',
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            margin: '10px 0',
          }}
        >
          {renderInlineFormatting(line.replace(/^>\s?/, ''), onNavigateWikilink)}
        </blockquote>
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

  flushCallout(lines.length);

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
