import { describe, expect, it } from 'vitest';
import { matchCalloutHeader } from '../callouts.js';
import { buildOutlineTree } from '../outline.js';
import { matchTaskLine, toggleTaskAtLine } from '../tasks.js';
import { ParsedHeading } from '@okw/core';

describe('Phase 2 Markdown Capabilities: Callouts, Tasks, Outline', () => {
  it('parses callout header types and custom titles', () => {
    const c1 = matchCalloutHeader('> [!NOTE] This is a note');
    expect(c1).toEqual({ type: 'note', title: 'This is a note' });

    const c2 = matchCalloutHeader('> [!WARNING]');
    expect(c2).toEqual({ type: 'warning', title: 'WARNING' });

    const c3 = matchCalloutHeader('> [!TIP] Pro Tip');
    expect(c3).toEqual({ type: 'tip', title: 'Pro Tip' });

    const notCallout = matchCalloutHeader('> Just a quote');
    expect(notCallout).toBeNull();
  });

  it('parses and toggles task list checkboxes at exact line', () => {
    const doc = `# Project Tasks
- [ ] Task 1: Initialize database
- [x] Task 2: Build frontend UI
* [ ] Task 3: Write tests
`;

    expect(matchTaskLine('- [ ] Task 1: Initialize database', 2)).toEqual({
      line: 2,
      text: 'Task 1: Initialize database',
      checked: false,
      indent: 0,
    });

    expect(matchTaskLine('- [x] Task 2: Build frontend UI', 3)).toEqual({
      line: 3,
      text: 'Task 2: Build frontend UI',
      checked: true,
      indent: 0,
    });

    // Toggle line 2 from unchecked to checked
    const updated1 = toggleTaskAtLine(doc, 2);
    expect(updated1).toContain('- [x] Task 1: Initialize database');

    // Toggle line 3 from checked to unchecked
    const updated2 = toggleTaskAtLine(doc, 3);
    expect(updated2).toContain('- [ ] Task 2: Build frontend UI');
  });

  it('builds nested outline tree from heading hierarchy', () => {
    const headings: ParsedHeading[] = [
      { level: 1, text: 'H1 Title', slug: 'h1-title', line: 1 },
      { level: 2, text: 'H2 Subtitle A', slug: 'h2-subtitle-a', line: 5 },
      { level: 3, text: 'H3 Deep A1', slug: 'h3-deep-a1', line: 8 },
      { level: 2, text: 'H2 Subtitle B', slug: 'h2-subtitle-b', line: 12 },
    ];

    const tree = buildOutlineTree(headings);
    expect(tree).toHaveLength(1); // H1 is root
    expect(tree[0].heading.text).toBe('H1 Title');
    expect(tree[0].children).toHaveLength(2); // Two H2s
    expect(tree[0].children[0].heading.text).toBe('H2 Subtitle A');
    expect(tree[0].children[0].children).toHaveLength(1); // One H3
    expect(tree[0].children[0].children[0].heading.text).toBe('H3 Deep A1');
    expect(tree[0].children[1].heading.text).toBe('H2 Subtitle B');
  });
});
