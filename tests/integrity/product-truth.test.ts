import { describe, it, expect } from 'vitest';
import type { VaultEntry } from '@okw/core';

describe('Product Truth & Data Contracts (P2-D, P2-F, P2-H)', () => {
  describe('FileTree Deterministic 2-Pass Hierarchy', () => {
    interface TreeNode {
      name: string;
      path: string;
      isDirectory: boolean;
      children: TreeNode[];
    }

    function buildTree(entries: VaultEntry[]): TreeNode[] {
      const root: TreeNode[] = [];
      const map = new Map<string, TreeNode>();

      for (const entry of entries) {
        const node: TreeNode = {
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          children: [],
        };
        map.set(entry.path, node);
      }

      for (const entry of entries) {
        const parts = entry.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          const dirPath = parts.slice(0, i).join('/');
          if (!map.has(dirPath)) {
            map.set(dirPath, {
              name: parts[i - 1],
              path: dirPath,
              isDirectory: true,
              children: [],
            });
          }
        }
      }

      for (const [path, node] of map.entries()) {
        const parts = path.split('/');
        if (parts.length === 1) {
          root.push(node);
        } else {
          parts.pop();
          const parentPath = parts.join('/');
          const parentNode = map.get(parentPath);
          if (parentNode) {
            parentNode.children.push(node);
          } else {
            root.push(node);
          }
        }
      }

      const sortNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        for (const n of nodes) {
          if (n.children.length > 0) {
            sortNodes(n.children);
          }
        }
      };

      sortNodes(root);
      return root;
    }

    it('creates implicit parent folders and places directories before files in alphabetical order', () => {
      const entries: VaultEntry[] = [
        { name: 'Zebra.md', path: 'Zebra.md', isDirectory: false, size: 10, modifiedAt: 100 },
        { name: 'Apple.md', path: 'Apple.md', isDirectory: false, size: 10, modifiedAt: 100 },
        {
          name: 'Deep.md',
          path: 'Projects/Sub/Deep.md',
          isDirectory: false,
          size: 10,
          modifiedAt: 100,
        },
        {
          name: 'Overview.md',
          path: 'Projects/Overview.md',
          isDirectory: false,
          size: 10,
          modifiedAt: 100,
        },
        { name: 'Alpha.md', path: 'Daily/Alpha.md', isDirectory: false, size: 10, modifiedAt: 100 },
      ];

      const tree = buildTree(entries);

      // Top level: Daily (dir), Projects (dir), Apple.md (file), Zebra.md (file)
      expect(tree.length).toBe(4);
      expect(tree[0].name).toBe('Daily');
      expect(tree[0].isDirectory).toBe(true);
      expect(tree[1].name).toBe('Projects');
      expect(tree[1].isDirectory).toBe(true);
      expect(tree[2].name).toBe('Apple.md');
      expect(tree[2].isDirectory).toBe(false);
      expect(tree[3].name).toBe('Zebra.md');
      expect(tree[3].isDirectory).toBe(false);

      // Subtree for Projects: Sub (dir), Overview.md (file)
      const projectsNode = tree[1];
      expect(projectsNode.children.length).toBe(2);
      expect(projectsNode.children[0].name).toBe('Sub');
      expect(projectsNode.children[0].isDirectory).toBe(true);
      expect(projectsNode.children[1].name).toBe('Overview.md');
      expect(projectsNode.children[1].isDirectory).toBe(false);
    });
  });

  describe('Plugin State IPC Validation', () => {
    function sanitizePluginStates(states: any): Record<string, boolean> {
      if (!states || typeof states !== 'object' || Array.isArray(states)) {
        throw new Error('Invalid plugin states payload');
      }
      const keys = Object.keys(states);
      if (keys.length > 100) {
        throw new Error('Plugin states payload exceeds limit');
      }
      const cleanStates: Record<string, boolean> = {};
      for (const key of keys) {
        if (typeof key === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
          cleanStates[key] = Boolean(states[key]);
        }
      }
      return cleanStates;
    }

    it('sanitizes valid plugin IDs and booleans', () => {
      const raw = {
        'word-count': true,
        'daily-notes': false,
        templates: true,
      };
      const clean = sanitizePluginStates(raw);
      expect(clean).toEqual({
        'word-count': true,
        'daily-notes': false,
        templates: true,
      });
    });

    it('rejects malicious keys or invalid types', () => {
      const raw = {
        'word-count': true,
        __proto__: true,
        'bad;injection': true,
        ['too-long-'.repeat(20)]: true,
      };
      const clean = sanitizePluginStates(raw);
      expect(clean['word-count']).toBe(true);
      expect(clean['bad;injection']).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
      expect(clean['__proto__']).not.toBe(true);
    });
  });
});
