import React, { useState } from 'react';
import { VaultEntry, VaultPath } from '@okw/core';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit2,
  Plus,
} from 'lucide-react';

interface FileTreeProps {
  entries: VaultEntry[];
  activePath: VaultPath | null;
  onSelect: (path: VaultPath) => void;
  onCreateNote: (folder?: string) => void;
  onCreateFolder?: (parent?: string) => void;
  onRename: (from: VaultPath, to: VaultPath) => void;
  onDelete: (path: VaultPath) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

function buildTree(entries: VaultEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  // Pass 1: register all nodes
  for (const entry of entries) {
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      children: [],
    };
    map.set(entry.path, node);
  }

  // Ensure all parent directories exist even if implicit
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

  // Pass 2: attach to parent or root
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

  // Deterministic sort: directories first (A-Z), then files (A-Z)
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

export const FileTree: React.FC<FileTreeProps> = ({
  entries,
  activePath,
  onSelect,
  onCreateNote,
  onRename,
  onDelete,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const tree = buildTree(entries);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const startRename = (path: string, currentName: string) => {
    setEditingPath(path);
    setRenameValue(currentName.replace(/\.md$/, ''));
  };

  const submitRename = (from: string) => {
    if (renameValue.trim()) {
      const parts = from.split('/');
      parts.pop();
      const parent = parts.join('/');
      const newPath = parent ? `${parent}/${renameValue.trim()}` : renameValue.trim();
      onRename(from, newPath);
    }
    setEditingPath(null);
  };

  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = !collapsed[node.path];
    const isActive = activePath === node.path;
    const isEditing = editingPath === node.path;

    if (node.isDirectory) {
      return (
        <div key={node.path}>
          <div
            className={`tree-item ${isActive ? 'active' : ''}`}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className="tree-icon" style={{ opacity: 0.5 }}>
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span className="tree-icon" style={{ color: '#d97706', opacity: 0.85 }}>
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="tree-label">{node.name}</span>
            <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn-icon"
                style={{ width: '22px', height: '22px' }}
                title="New Note in Folder"
                onClick={() => onCreateNote(node.path)}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
          {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`tree-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 24}px` }}
        onClick={() => onSelect(node.path)}
      >
        <span className="tree-icon">
          <FileText size={13} />
        </span>
        {isEditing ? (
          <input
            type="text"
            className="command-input"
            style={{
              fontSize: '13px',
              padding: '1px 6px',
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-focus)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename(node.path);
              if (e.key === 'Escape') setEditingPath(null);
            }}
            onBlur={() => submitRename(node.path)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-label">{node.name.replace(/\.md$/, '')}</span>
        )}
        <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-icon"
            style={{ width: '22px', height: '22px' }}
            title="Rename Note"
            onClick={() => startRename(node.path, node.name)}
          >
            <Edit2 size={11} />
          </button>
          <button
            className="btn-icon"
            style={{ width: '22px', height: '22px' }}
            title="Delete Note"
            onClick={() => onDelete(node.path)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="file-tree">
      {tree.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            color: 'var(--text-muted)',
            fontSize: '12px',
            textAlign: 'center',
          }}
        >
          No notes in vault
        </div>
      ) : (
        tree.map((n) => renderNode(n))
      )}
    </div>
  );
};
