import { useEffect, useState, useCallback } from 'react';
import {
  FileSnapshot,
  normalizeVaultPath,
  ParsedDocument,
  VaultEntry,
  VaultPath,
  VaultStorage,
} from '@okw/core';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { MemoryVaultStorage, SafeWriter, BrowserFSAVaultStorage } from '@okw/vault';

export interface OpenTab {
  path: VaultPath;
  title: string;
  isDirty: boolean;
  content: string;
  initialSnapshot: FileSnapshot | null;
}

const DEFAULT_VAULT_SEED: Record<string, string> = {
  'Welcome.md': `---
title: Welcome to Open Knowledge Workspace
tags: [getting-started, welcome]
aliases: [Home, Getting Started]
---

# Welcome to Open Knowledge Workspace

An open-source, local-first knowledge workspace where **your Markdown files remain canonical truth**.

## Key Concepts

- **Local Ownership**: Notes live as ordinary files on your disk.
- **Wikilinks**: Connect notes seamlessly with \`[[Architecture]]\` or \`[[Daily/2026-08-15|Daily Log]]\`.
- **Backlinks**: Automatically discover all incoming connections in the backlinks panel.
- **Safe Save**: Built-in concurrency control prevents silent overwrites and protects against data loss.
- **Disposable Derived State**: If the index or app database is ever wiped, 100% of your knowledge is reconstructed instantly from your files.

Explore the sample notes:
- [[Architecture]]
- [[Daily/2026-08-15]]
- [[Projects/Quantum Computing]]
`,
  'Architecture.md': `---
title: System Architecture
tags: [architecture, core]
aliases: [OKW Architecture, Design Doc]
---

# System Architecture

The application is structured as a modular monolith adhering to the laws of \`CONSTITUTION.md\`.

## Architectural Layers

1. **VaultStorage**: Abstract storage interface (\`MemoryVaultStorage\`, \`NodeFsVaultStorage\`, \`BrowserFSAVaultStorage\`).
2. **SafeWriter**: Concurrency-checked atomic save engine using content hashes and version tokens.
3. **DocumentParser**: High-performance Markdown, Frontmatter, Wikilink, and Tag parser.
4. **Derived Index**: Disposable in-memory / SQLite full-text search and backlink index.

Refer back to [[Welcome]] or see [[Projects/Quantum Computing]].
`,
  'Daily/2026-08-15.md': `---
title: Daily Log 2026-08-15
tags: [daily, log, sprint]
---

# Daily Log · August 15, 2026

## Focus Items
- [x] Initialized Open Knowledge Workspace
- [x] Established Phase 0 (Foundation) and Phase 1 (Trustworthy Vault)
- [x] Verified zero data-loss safe save pipeline
- [ ] Review with [[Architecture]] specifications
`,
  'Projects/Quantum Computing.md': `---
title: Quantum Computing Project
tags: [project/quantum, science]
---

# Quantum Computing Project

Exploring algorithms and hardware implementations.
Related references:
- [[Architecture]]
- [[Welcome]]
`,
};

export function useVault() {
  const [storage, setStorage] = useState<VaultStorage>(() => new MemoryVaultStorage('Open Knowledge Workspace'));
  const [safeWriter, setSafeWriter] = useState<SafeWriter>(() => new SafeWriter(storage));
  const [index] = useState<MemoryDocumentIndex>(() => new MemoryDocumentIndex());
  const [parser] = useState<DefaultDocumentParser>(() => new DefaultDocumentParser());

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<VaultPath | null>(null);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'modified' | 'conflict'>('saved');
  const [conflictData, setConflictData] = useState<{ path: VaultPath; diskContent?: string } | null>(null);

  const activeTab = openTabs.find((t) => t.path === activeTabPath) || null;

  // Refresh directory list & derived index
  const refreshVault = useCallback(async (currentStorage: VaultStorage = storage) => {
    try {
      const list = await currentStorage.list('', true);
      setEntries(list);
      await rebuildVaultIndex(currentStorage, index, parser);
      if (activeTabPath) {
        const bl = await index.getBacklinks(activeTabPath);
        setBacklinks(bl);
      }
    } catch (err) {
      console.error('Error refreshing vault:', err);
    }
  }, [storage, index, parser, activeTabPath]);

  // Seed default vault on mount
  useEffect(() => {
    (async () => {
      if (storage instanceof MemoryVaultStorage) {
        await storage.seed(DEFAULT_VAULT_SEED);
        await refreshVault(storage);
        await openNote('Welcome.md');
      }
    })();
  }, []);

  // Open / Pick a native local directory via File System Access API
  const openDirectoryVault = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        const fsaStorage = new BrowserFSAVaultStorage(handle, handle.name);
        setStorage(fsaStorage);
        setSafeWriter(new SafeWriter(fsaStorage));
        setOpenTabs([]);
        setActiveTabPath(null);
        await refreshVault(fsaStorage);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Error opening directory:', err);
        }
      }
    } else {
      alert('Browser File System Access API is not supported in this browser.');
    }
  };

  // Open a note into tabs
  const openNote = async (rawPath: VaultPath) => {
    const path = normalizeVaultPath(rawPath);
    const existing = openTabs.find((t) => t.path === path);
    if (existing) {
      setActiveTabPath(path);
      return;
    }

    try {
      const snapshot = await storage.read(path);
      const content = snapshot.textContent || new TextDecoder().decode(snapshot.content);
      const parsed = await parser.parse(path, content, snapshot.version.hash);

      const newTab: OpenTab = {
        path,
        title: parsed.title,
        isDirty: false,
        content,
        initialSnapshot: snapshot,
      };

      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabPath(path);
      setParsedDoc(parsed);

      const bl = await index.getBacklinks(path);
      setBacklinks(bl);
      setSaveStatus('saved');
    } catch (err) {
      console.error(`Failed to open note "${path}":`, err);
    }
  };

  // Close a tab
  const closeTab = (path: VaultPath) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        setActiveTabPath(next.length > 0 ? next[next.length - 1].path : null);
      }
      return next;
    });
  };

  // Update active tab content
  const updateContent = (newContent: string) => {
    if (!activeTabPath) return;

    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path === activeTabPath) {
          const isDirty = tab.initialSnapshot
            ? (tab.initialSnapshot.textContent || new TextDecoder().decode(tab.initialSnapshot.content)) !== newContent
            : true;
          return { ...tab, content: newContent, isDirty };
        }
        return tab;
      })
    );
    setSaveStatus('modified');
  };

  // Safe Save active note
  const saveActiveNote = async (force = false) => {
    if (!activeTab || !activeTabPath) return;

    setSaveStatus('saving');
    try {
      const expectedVersion = force ? undefined : activeTab.initialSnapshot?.version || null;
      const res = await safeWriter.safeSave(activeTabPath, activeTab.content, {
        expectedVersion,
        force,
      });

      // Update tab snapshot
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.path === activeTabPath
            ? { ...tab, isDirty: false, initialSnapshot: res.snapshot }
            : tab
        )
      );

      const parsed = await parser.parse(activeTabPath, activeTab.content, res.snapshot.version.hash);
      await index.upsert(parsed);
      setParsedDoc(parsed);

      const bl = await index.getBacklinks(activeTabPath);
      setBacklinks(bl);
      setSaveStatus('saved');
      setConflictData(null);
    } catch (err: any) {
      if (err.code === 'CONFLICT' || err.name === 'ConflictError') {
        setSaveStatus('conflict');
        try {
          const diskText = await storage.readText(activeTabPath);
          setConflictData({ path: activeTabPath, diskContent: diskText });
        } catch {
          setConflictData({ path: activeTabPath });
        }
      } else {
        console.error('Save failed:', err);
        setSaveStatus('modified');
      }
    }
  };

  // Create a new note
  const createNote = async (folder: string = '') => {
    let name = 'Untitled.md';
    let counter = 1;
    let targetPath = folder ? `${folder}/${name}` : name;

    while (await storage.exists(targetPath)) {
      name = `Untitled ${counter}.md`;
      targetPath = folder ? `${folder}/${name}` : name;
      counter++;
    }

    const defaultContent = `# ${name.replace(/\.md$/, '')}\n\n`;
    await storage.write(targetPath, null, defaultContent);
    await refreshVault();
    await openNote(targetPath);
  };

  // Create a new folder
  const createFolder = async (parent: string = '') => {
    let name = 'New Folder';
    let counter = 1;
    let targetPath = parent ? `${parent}/${name}` : name;

    while (await storage.exists(targetPath)) {
      name = `New Folder ${counter}`;
      targetPath = parent ? `${parent}/${name}` : name;
      counter++;
    }

    await storage.createFolder(targetPath);
    await refreshVault();
  };

  // Rename a note
  const renameNote = async (from: VaultPath, to: VaultPath) => {
    const normTo = to.endsWith('.md') ? to : `${to}.md`;
    await storage.move(from, normTo);
    setOpenTabs((prev) =>
      prev.map((tab) => (tab.path === from ? { ...tab, path: normTo, title: normTo.replace(/\.md$/, '') } : tab))
    );
    if (activeTabPath === from) {
      setActiveTabPath(normTo);
    }
    await refreshVault();
  };

  // Delete a note / folder
  const deletePath = async (path: VaultPath) => {
    if (confirm(`Are you sure you want to delete "${path}"?`)) {
      closeTab(path);
      await storage.remove(path);
      await refreshVault();
    }
  };

  // Update parsed doc when switching active tab
  useEffect(() => {
    if (activeTab) {
      (async () => {
        const parsed = await parser.parse(activeTab.path, activeTab.content);
        setParsedDoc(parsed);
        const bl = await index.getBacklinks(activeTab.path);
        setBacklinks(bl);
      })();
    } else {
      setParsedDoc(null);
      setBacklinks([]);
    }
  }, [activeTabPath, activeTab?.content]);

  return {
    vaultName: storage.name,
    storage,
    entries,
    openTabs,
    activeTab,
    activeTabPath,
    parsedDoc,
    backlinks,
    saveStatus,
    conflictData,
    index,
    openNote,
    closeTab,
    updateContent,
    saveActiveNote,
    createNote,
    createFolder,
    renameNote,
    deletePath,
    openDirectoryVault,
    refreshVault,
    dismissConflict: () => setConflictData(null),
    resolveConflictReload: async () => {
      if (activeTabPath) {
        closeTab(activeTabPath);
        await openNote(activeTabPath);
        setConflictData(null);
      }
    },
  };
}
