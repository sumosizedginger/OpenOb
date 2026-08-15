import { ParsedHeading } from '@okw/core';

export interface OutlineNode {
  readonly heading: ParsedHeading;
  readonly children: OutlineNode[];
}

/**
 * Builds a nested hierarchical tree from a flat list of headings.
 */
export function buildOutlineTree(headings: ParsedHeading[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];

  for (const h of headings) {
    const node: OutlineNode = {
      heading: h,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, level: h.level });
  }

  return root;
}
