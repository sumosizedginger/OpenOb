import React, { useState } from 'react';
import { VaultEntry, VaultPath } from '@okw/core';
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Trash2, Edit2, Plus } from 'lucide-react';

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

  for (const entry of entries) {
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      children: [],
    };
    map.set(entry.path, node);

    const parts = entry.path.split('/');
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
            style={{ paddingLeft: `${depth * 14 + 12}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className="tree-icon">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="tree-icon">
              {isExpanded ? <FolderOpen size={15} color="#fbbf24" /> : <Folder size={15} color="#fbbf24" />}
            </span>
            <span className="tree-label">{node.name}</span>
            <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn-icon"
                title="New Note in Folder"
                onClick={() => onCreateNote(node.path)}
              >
                <Plus size={13} />
              </button>
              <button
                className="btn-icon"
                title="Delete Folder"
                onClick={() => onDelete(node.path)}
              >
                <Trash2 size={13} />
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
        style={{ paddingLeft: `${depth * 14 + 26}px` }}
        onClick={() => onSelect(node.path)}
      >
        <span className="tree-icon">
          <FileText size={15} color="#94a3b8" />
        </span>
        {isEditing ? (
          <input
            type="text"
            className="command-input"
            style={{ fontSize: '13px', padding: '2px 4px', background: 'var(--bg-tertiary)' }}
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
            title="Rename Note"
            onClick={() => startRename(node.path, node.name)}
          >
            <Edit2 size={12} />
          </button>
          <button
            className="btn-icon"
            title="Delete Note"
            onClick={() => onDelete(node.path)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="file-tree">
      {tree.length === 0 ? (
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
          Vault is empty
        </div>
      ) : (
        tree.map((n) => renderNode(n))
      )}
    </div>
  );
};
