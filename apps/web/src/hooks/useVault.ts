import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FileSnapshot,
  normalizeVaultPath,
  ParsedDocument,
  VaultEntry,
  VaultPath,
  VaultStorage,
} from '@okw/core';
import { DefaultDocumentParser, toggleTaskAtLine, updateDocumentFrontmatter } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex, renameDocument } from '@okw/index';
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

  const isSavingRef = useRef(false);
  const parseDebounceTimerRef = useRef<any>(null);

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

  // Close a tab (with dirty-state confirmation, H-02)
  const closeTab = (path: VaultPath, force = false) => {
    const tabToClose = openTabs.find((t) => t.path === path);
    if (tabToClose?.isDirty && !force) {
      if (!confirm(`"${tabToClose.title || path}" has unsaved changes. Discard and close?`)) {
        return;
      }
    }

    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        setActiveTabPath(next.length > 0 ? next[next.length - 1].path : null);
      }
      return next;
    });
  };

  // Update specific tab content (C-01 fix: explicit path parameter)
  const updateContent = (targetPath: VaultPath, newContent: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path === targetPath) {
          const isDirty = tab.initialSnapshot
            ? (tab.initialSnapshot.textContent || new TextDecoder().decode(tab.initialSnapshot.content)) !== newContent
            : true;
          return { ...tab, content: newContent, isDirty };
        }
        return tab;
      })
    );
    if (targetPath === activeTabPath) {
      setSaveStatus('modified');
    }
  };

  // Toggle Markdown checkbox task at line with content-aware verification (P2-1)
  const toggleTask = (lineNumber: number, targetText?: string) => {
    if (!activeTab || !activeTabPath) return;
    const newContent = toggleTaskAtLine(activeTab.content, lineNumber, targetText);
    updateContent(activeTabPath, newContent);
  };

  // Safe Save active note (C-02 in-flight lock)
  const saveActiveNote = async (force = false) => {
    if (!activeTab || !activeTabPath || isSavingRef.current) return;

    isSavingRef.current = true;
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
    } finally {
      isSavingRef.current = false;
    }
  };

  // Create a new note (L-02 fix: handles explicit note name or folder)
  const createNote = async (nameOrFolder: string = '') => {
    let targetPath: string;

    if (nameOrFolder && nameOrFolder.endsWith('.md')) {
      targetPath = normalizeVaultPath(nameOrFolder);
    } else if (nameOrFolder && !nameOrFolder.includes('/')) {
      targetPath = `${nameOrFolder}.md`;
    } else {
      const folder = nameOrFolder;
      let name = 'Untitled.md';
      let counter = 1;
      targetPath = folder ? `${folder}/${name}` : name;

      while (await storage.exists(targetPath)) {
        name = `Untitled ${counter}.md`;
        targetPath = folder ? `${folder}/${name}` : name;
        counter++;
      }
    }

    if (!(await storage.exists(targetPath))) {
      const noteTitle = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
      const defaultContent = `# ${noteTitle}\n\n`;
      await storage.write(targetPath, null, defaultContent);
    }

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

  // Rename a note safely with automatic incoming link refactoring (F-010 / F-011, P4-1, P4-5, P4-7)
  const renameNote = async (from: VaultPath, to: VaultPath) => {
    const normTo = to.endsWith('.md') ? to : `${to}.md`;
    try {
      // 1. Save any dirty open tabs first to avoid data loss (P4-5)
      for (const tab of openTabs) {
        if (tab.isDirty) {
          const res = await safeWriter.safeSave(tab.path, tab.content, {
            expectedVersion: tab.initialSnapshot?.version,
          });
          tab.isDirty = false;
          tab.initialSnapshot = res.snapshot;
        }
      }

      // 2. Perform safe rename refactoring
      const res = await renameDocument(storage, index, parser, from, normTo, { updateLinks: true });

      // 3. Update tab paths and refresh snapshots to avoid phantom conflicts (P4-7)
      const updatedOpenTabs = await Promise.all(
        openTabs.map(async (tab) => {
          if (tab.path === from) {
            const snap = await storage.read(normTo);
            const content = typeof snap.content === 'string' ? snap.content : new TextDecoder().decode(snap.content);
            return {
              ...tab,
              path: normTo,
              title: normTo.replace(/\.md$/, ''),
              content,
              isDirty: false,
              initialSnapshot: snap,
            };
          }
          if (res.updatedFiles.includes(tab.path)) {
            const snap = await storage.read(tab.path);
            const content = typeof snap.content === 'string' ? snap.content : new TextDecoder().decode(snap.content);
            return {
              ...tab,
              content,
              isDirty: false,
              initialSnapshot: snap,
            };
          }
          return tab;
        })
      );
      setOpenTabs(updatedOpenTabs);

      if (activeTabPath === from) {
        setActiveTabPath(normTo);
      }
      await refreshVault();
    } catch (err: any) {
      console.error('Rename failed:', err);
      alert(`Rename failed: ${err.message}`);
    }
  };

  // Delete a note / folder
  const deletePath = async (path: VaultPath) => {
    if (confirm(`Are you sure you want to delete "${path}"?`)) {
      closeTab(path, true);
      await storage.remove(path);
      await refreshVault();
    }
  };

  // Debounced parse & backlink update effect (M-04 fix)
  useEffect(() => {
    if (parseDebounceTimerRef.current) {
      clearTimeout(parseDebounceTimerRef.current);
    }

    if (activeTab) {
      parseDebounceTimerRef.current = setTimeout(async () => {
        const parsed = await parser.parse(activeTab.path, activeTab.content);
        setParsedDoc(parsed);
        const bl = await index.getBacklinks(activeTab.path);
        setBacklinks(bl);
      }, 250);
    } else {
      setParsedDoc(null);
      setBacklinks([]);
    }

    return () => {
      if (parseDebounceTimerRef.current) {
        clearTimeout(parseDebounceTimerRef.current);
      }
    };
  }, [activeTabPath, activeTab?.content]);

  // Debounced Autosave Hook (H-02 fix)
  useEffect(() => {
    if (!activeTab || !activeTab.isDirty) return;

    const autosaveTimer = setTimeout(() => {
      saveActiveNote();
    }, 2000); // 2-second debounced autosave

    return () => clearTimeout(autosaveTimer);
  }, [activeTab?.content, activeTab?.isDirty]);

  // Update a note's frontmatter property (Phase 6 Notion views, P6-3 / P6-4)
  const updateNoteProperty = async (path: VaultPath, key: string, value: any) => {
    try {
      const openTab = openTabs.find((t) => t.path === path);
      if (openTab) {
        const snap = openTab.initialSnapshot || (await storage.read(path));
        const parsed = await parser.parse(path, openTab.content);
        const currentProps = parsed.properties || {};
        const newProps = { ...currentProps };
        if (value === null || value === undefined) {
          delete newProps[key];
        } else {
          newProps[key] = value;
        }
        const updated = updateDocumentFrontmatter(openTab.content, newProps);

        // Perform version-checked save first before mutating buffer
        const saveRes = await safeWriter.safeSave(path, updated, { expectedVersion: snap.version });

        // Reconcile tab state (P6-3 & P6-4)
        openTab.content = updated;
        openTab.isDirty = false;
        openTab.initialSnapshot = saveRes.snapshot;
        setOpenTabs([...openTabs]);

        const newParsed = await parser.parse(path, updated);
        await index.upsert(newParsed);
        return;
      }

      const snap = await storage.read(path);
      const text = typeof snap.content === 'string' ? snap.content : new TextDecoder().decode(snap.content);
      const parsed = await parser.parse(path, text);
      const currentProps = parsed.properties || {};
      const newProps = { ...currentProps };
      if (value === null || value === undefined) {
        delete newProps[key];
      } else {
        newProps[key] = value;
      }
      const updated = updateDocumentFrontmatter(text, newProps);
      await safeWriter.safeSave(path, updated, { expectedVersion: snap.version });
      const newParsed = await parser.parse(path, updated);
      await index.upsert(newParsed);
    } catch (err: any) {
      if (err?.name === 'ConflictError' || err?.message?.includes('Conflict')) {
        const freshSnap = await storage.read(path);
        const diskContent = typeof freshSnap.content === 'string' ? freshSnap.content : new TextDecoder().decode(freshSnap.content);
        setConflictData({
          path,
          diskContent,
        });
      } else {
        console.error('Failed to update note property:', err);
      }
    }
  };

  // Create a note with predefined frontmatter properties
  const createNoteWithProperties = async (name: string, initialProps: Record<string, any>) => {
    const cleanName = name.trim();
    const noteTitle = cleanName.replace(/\.md$/, '');
    const targetPath = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;

    const body = `# ${noteTitle}\n\n`;
    const fullContent = updateDocumentFrontmatter(body, initialProps);

    await storage.write(targetPath, null, fullContent);
    await refreshVault();
    await openNote(targetPath);
  };

  // Safely apply AI proposed edit with divergence detection and buffer/index reconciliation (F-028, P7-1, P7-3)
  const applyAIProposedEdit = async (proposal: any): Promise<{ success: boolean; error?: string }> => {
    try {
      const openTab = openTabs.find((t) => t.path === proposal.path);
      if (openTab) {
        // Divergence check: Has the user edited the active tab buffer since proposal generation?
        if (openTab.content.trim() !== proposal.originalContent.trim()) {
          setConflictData({
            path: proposal.path,
            diskContent: openTab.content,
          });
          return {
            success: false,
            error: 'Conflict: Note buffer was modified after AI proposal was generated.',
          };
        }

        const snap = openTab.initialSnapshot || (await storage.read(proposal.path));
        const saveRes = await safeWriter.safeSave(proposal.path, proposal.proposedContent, {
          expectedVersion: snap.version,
        });

        // Reconcile tab state
        openTab.content = proposal.proposedContent;
        openTab.isDirty = false;
        openTab.initialSnapshot = saveRes.snapshot;
        setOpenTabs([...openTabs]);

        // Re-parse and upsert to index
        const parsed = await parser.parse(proposal.path, proposal.proposedContent);
        await index.upsert(parsed);
        return { success: true };
      }

      // Non-active tab case: verify disk content
      const snap = await storage.read(proposal.path);
      const diskText =
        typeof snap.content === 'string'
          ? snap.content
          : new TextDecoder().decode(snap.content);

      if (diskText.trim() !== proposal.originalContent.trim()) {
        setConflictData({
          path: proposal.path,
          diskContent: diskText,
        });
        return {
          success: false,
          error: 'Conflict: Note on disk was modified after AI proposal was generated.',
        };
      }

      await safeWriter.safeSave(proposal.path, proposal.proposedContent, {
        expectedVersion: snap.version,
      });
      const parsed = await parser.parse(proposal.path, proposal.proposedContent);
      await index.upsert(parsed);
      return { success: true };
    } catch (err: any) {
      if (err?.name === 'ConflictError' || err?.message?.includes('Conflict')) {
        const freshSnap = await storage.read(proposal.path);
        const diskContent =
          typeof freshSnap.content === 'string'
            ? freshSnap.content
            : new TextDecoder().decode(freshSnap.content);
        setConflictData({
          path: proposal.path,
          diskContent,
        });
      }
      return { success: false, error: err.message };
    }
  };

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
    toggleTask,
    saveActiveNote,
    createNote,
    createFolder,
    renameNote,
    deletePath,
    openDirectoryVault,
    refreshVault,
    updateNoteProperty,
    createNoteWithProperties,
    applyAIProposedEdit,
    dismissConflict: () => setConflictData(null),
    resolveConflictReload: async () => {
      if (activeTabPath) {
        closeTab(activeTabPath, true);
        await openNote(activeTabPath);
        setConflictData(null);
      }
    },
  };
}
