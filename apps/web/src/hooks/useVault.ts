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
import {
  MemoryVaultStorage,
  SafeWriter,
  BrowserFSAVaultStorage,
  NoteWriteCoordinator,
  NoteState,
} from '@okw/vault';

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
- [x] Established Phase 0 through Phase 10 architectural foundations
- [x] Verified zero data-loss safe save pipeline
- [ ] Review [[Characters/Kaelen]] and [[Manuscript/Chapter_01]]
`,
  'Characters/Kaelen.md': `---
title: Kaelen
type: character
role: protagonist
status: active
affiliations: [Aegis, Vanguard]
aliases: [The Wanderer]
tags: [character, worldbuilding]
---

# Kaelen

## Overview
A skilled tactician navigating the fractured realms. Relies on instinct and deep lore.

## Key Relationships
- [[Characters/Seraphine]]: Trusted ally in [[Manuscript/Chapter_01]].
- Connected to [[Projects/Alpha Roadmap]].
`,
  'Manuscript/Chapter_01.md': `---
title: Chapter 1: The First Step
type: chapter
word_count: 1250
status: draft
tags: [manuscript, novel]
---

# Chapter 1: The First Step

The mist hung thick over the valley as dawn broke across the jagged horizon. Kaelen adjusted the straps of his worn leather pack, feeling the quiet weight of the artifacts within.

For seven years, the rumors had spoken of the lost archives beneath the Spire. Few who ventured into the ruins ever returned with their minds intact, but Kaelen possessed the cartographer's cipher.

He glanced back one last time at the frontier outpost, where lanterns flickered faintly against the morning cold. There would be no retreat now. The path ahead led directly through the forgotten gorge.
`,
  'Projects/Alpha Roadmap.md': `---
title: Alpha Release Roadmap
type: project
status: in_progress
priority: high
due: 2026-09-01
tags: [project, roadmap]
---

# Alpha Release Roadmap

Tracking delivery milestones across the workspace engine.

## Milestones
- [x] Storage & SafeWriter Core
- [x] Disposable Relational Index & SQLite Engine
- [x] 2D Graph Engine with Provenance Edges
- [x] Notion-Like Views & Property Queries
- [x] Local & BYOK Cloud AI
- [x] Sandboxed Plugin SDK & First-Party Extensions
`,
  'Characters/Seraphine.md': `---
title: Seraphine
type: character
role: ally
status: active
affiliations: [Aegis]
aliases: [The Scholar]
tags: [character, worldbuilding]
---

# Seraphine

## Overview
A brilliant researcher deciphering ancient cartographic symbols. Close confidante of [[Characters/Kaelen]].

## Research Topics
- Connected to [[Projects/Quantum Computing]].
`,
  'Projects/Quantum Computing.md': `---
title: Quantum Computing
type: project
status: research
priority: medium
tags: [project, science]
---

# Quantum Computing

Exploration of quantum state simulation and topological computing.

## References
- [[Welcome]]
- [[Architecture]]
`,
  'Templates/Meeting.md': `---
title: {{title}}
date: {{date}}
tags: [meeting, notes]
---

# {{title}}

**Date:** {{date}} · **Time:** {{time}}

## Attendees
- 

## Agenda & Discussion

## Action Items
- [ ] 
`,
};

export function useVault() {
  const [storage, setStorage] = useState<VaultStorage>(
    () => new MemoryVaultStorage('Open Knowledge Workspace')
  );
  const [safeWriter, setSafeWriter] = useState<SafeWriter>(() => new SafeWriter(storage));
  const [index] = useState<MemoryDocumentIndex>(() => new MemoryDocumentIndex());
  const [parser] = useState<DefaultDocumentParser>(() => new DefaultDocumentParser());

  const coordinatorRef = useRef<NoteWriteCoordinator>(
    new NoteWriteCoordinator(storage, safeWriter)
  );

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<VaultPath | null>(null);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'modified' | 'conflict'>(
    'saved'
  );
  const [conflictData, setConflictData] = useState<{
    path: VaultPath;
    diskContent?: string;
  } | null>(null);

  const parseDebounceTimerRef = useRef<any>(null);
  const saveSequenceRef = useRef<number>(0);
  const indexGenerationMapRef = useRef<Map<VaultPath, number>>(new Map());
  const activeTabPathRef = useRef<VaultPath | null>(activeTabPath);
  activeTabPathRef.current = activeTabPath;
  const openTabsRef = useRef<OpenTab[]>(openTabs);
  openTabsRef.current = openTabs;

  const activeTab = openTabs.find((t) => t.path === activeTabPath) || null;

  // Expose test and introspection hooks on window only in DEV/TEST environments (H6)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      ((import.meta as any).env?.DEV || (import.meta as any).env?.MODE === 'test')
    ) {
      (window as any).__vaultStorage = storage;
      (window as any).__coordinator = coordinatorRef.current;
      (window as any).__readStorage = async (p: string) => {
        return storage.readText(p);
      };
      (window as any).__setStorageWriteDelay = (delayMs: number) => {
        const origWrite = storage.write.bind(storage);
        storage.write = async (...args: any[]) => {
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          return (origWrite as any)(...args);
        };
      };
    }
  }, [storage]);

  // Listen to authoritative coordinator state updates and reflect in React state (G1, G2)
  useEffect(() => {
    const unsubscribe = coordinatorRef.current.addListener((noteState: NoteState) => {
      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.path !== noteState.path) return t;
          const diskText = noteState.committedSnapshot?.textContent ?? '';
          const isDirty = diskText !== noteState.bufferContent;
          return {
            ...t,
            content: noteState.bufferContent,
            isDirty,
            initialSnapshot: noteState.committedSnapshot ?? t.initialSnapshot,
          };
        })
      );

      if (activeTabPathRef.current === noteState.path) {
        setSaveStatus(noteState.saveStatus);
        setConflictData(noteState.conflictData);
      }
    });
    return unsubscribe;
  }, []);

  // Refresh directory list & derived index
  const refreshVault = useCallback(
    async (currentStorage: VaultStorage = storage) => {
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
    },
    [storage, index, parser, activeTabPath]
  );

  // Seed default vault on mount
  useEffect(() => {
    void (async () => {
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
        const newWriter = new SafeWriter(fsaStorage);
        setStorage(fsaStorage);
        setSafeWriter(newWriter);
        coordinatorRef.current.setStorage(fsaStorage, newWriter);
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

  const openNote = async (rawPath: VaultPath) => {
    const path = normalizeVaultPath(rawPath);
    if (coordinatorRef.current.getNoteState(path)) {
      activeTabPathRef.current = path;
      setActiveTabPath(path);
      return;
    }

    try {
      await coordinatorRef.current.waitForIdle(path);
      const snapshot = await storage.read(path);
      const content =
        snapshot.textContent ||
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.content);
      const parsed = await parser.parse(path, content, snapshot.version.hash);
      coordinatorRef.current.initNote(path, snapshot, content);

      const newTab: OpenTab = {
        path,
        title: parsed.title,
        isDirty: false,
        content,
        initialSnapshot: snapshot,
      };

      setOpenTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, newTab];
      });
      activeTabPathRef.current = path;
      setActiveTabPath(path);
      setParsedDoc(parsed);

      const bl = await index.getBacklinks(path);
      setBacklinks(bl);
      setSaveStatus('saved');
    } catch (err) {
      console.error(`Failed to open note "${path}":`, err);
    }
  };

  const closeTab = (path: VaultPath, force = false) => {
    const tabToClose = openTabs.find((t) => t.path === path);
    let discarded = false;
    if (tabToClose?.isDirty && !force) {
      if (!confirm(`"${tabToClose.title || path}" has unsaved changes. Discard and close?`)) {
        return;
      }
      discarded = true;
    }

    coordinatorRef.current.removeNote(path, discarded);
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        const nextActive = next.length > 0 ? next[next.length - 1].path : null;
        activeTabPathRef.current = nextActive;
        setActiveTabPath(nextActive);
      }
      return next;
    });
  };

  const updateContent = (targetPath: VaultPath, newContent: string) => {
    coordinatorRef.current.setBuffer(targetPath, newContent);
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path === targetPath) {
          const state = coordinatorRef.current.getNoteState(targetPath);
          const isDirty = state
            ? (state.committedSnapshot?.textContent ?? '') !== newContent
            : true;
          return { ...tab, content: newContent, isDirty };
        }
        return tab;
      })
    );
    if (targetPath === activeTabPathRef.current) {
      setSaveStatus('modified');
    }
  };

  const toggleTask = (lineNumber: number, targetText?: string) => {
    if (!activeTab || !activeTabPath) return;
    const newContent = toggleTaskAtLine(activeTab.content, lineNumber, targetText);
    updateContent(activeTabPath, newContent);
  };

  const saveActiveNote = async (force = false) => {
    const currentPath = activeTabPathRef.current;
    if (!currentPath) return;

    try {
      const currentSeq = ++saveSequenceRef.current;
      const snapshot = await coordinatorRef.current.save(currentPath, force);
      if (snapshot) {
        const savedText =
          snapshot.textContent ??
          new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.content);
        const parsed = await parser.parse(currentPath, savedText, snapshot.version.hash);

        // H15 & H16: Strictly monotonic sequence guard; drops stale out-of-order parses & tombstoned paths
        const lastIndexed = indexGenerationMapRef.current.get(currentPath) || 0;
        if (currentSeq > lastIndexed) {
          indexGenerationMapRef.current.set(currentPath, currentSeq);
          await index.upsert(parsed);
          if (activeTabPathRef.current === currentPath) {
            setParsedDoc(parsed);
            const bl = await index.getBacklinks(currentPath);
            if (activeTabPathRef.current === currentPath) {
              setBacklinks(bl);
            }
          }
        }
      }
    } catch (err: any) {}
  };

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

    let candidate = targetPath;
    let counter = 1;
    while (openTabs.some((t) => t.path === candidate)) {
      const base = targetPath.replace(/\.md$/, '');
      candidate = `${base}-${counter}.md`;
      counter++;
    }

    try {
      const initialContent = `# ${candidate.replace(/\.md$/, '').split('/').pop()}\n\n`;
      const res = await safeWriter.safeSave(candidate, initialContent, { expectedVersion: null });
      const parsed = await parser.parse(candidate, initialContent, res.snapshot.version.hash);
      await index.upsert(parsed);

      coordinatorRef.current.initNote(candidate, res.snapshot, initialContent);

      const newTab: OpenTab = {
        path: candidate,
        title: parsed.title,
        isDirty: false,
        content: initialContent,
        initialSnapshot: res.snapshot,
      };

      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabPath(candidate);
      setParsedDoc(parsed);
      setBacklinks([]);
      setSaveStatus('saved');
      await refreshVault();
    } catch (err) {
      console.error(`Failed to create note "${candidate}":`, err);
    }
  };

  const createFolder = async (folderPath?: string) => {
    let targetPath: string;
    if (folderPath && folderPath.trim().length > 0) {
      targetPath = normalizeVaultPath(folderPath);
    } else {
      let counter = 1;
      let candidate = 'New Folder';
      while (await storage.exists(candidate)) {
        candidate = `New Folder ${counter}`;
        counter++;
      }
      targetPath = candidate;
    }
    if (!targetPath) return;
    try {
      await storage.createFolder(targetPath);
      await refreshVault();
    } catch (err) {
      console.error(`Failed to create folder "${targetPath}":`, err);
    }
  };

  const renameNote = async (oldPath: VaultPath, rawNewPath: VaultPath) => {
    try {
      const cleanOld = oldPath.trim();
      const cleanNew = rawNewPath.trim();
      const normalizedOld = normalizeVaultPath(
        cleanOld.endsWith('.md') ? cleanOld : `${cleanOld}.md`
      );
      const normalizedNew = normalizeVaultPath(
        cleanNew.endsWith('.md') ? cleanNew : `${cleanNew}.md`
      );
      if (normalizedOld === normalizedNew) return;

      await coordinatorRef.current.waitForIdle(normalizedOld);
      await renameDocument(storage, index, parser, normalizedOld, normalizedNew);
      const newSnap = await storage.read(normalizedNew);
      coordinatorRef.current.renameNote(normalizedOld, normalizedNew, newSnap);

      // H16: Tombstone old path so delayed old-path upserts are permanently dropped
      indexGenerationMapRef.current.set(normalizedOld, Infinity);
      indexGenerationMapRef.current.set(normalizedNew, ++saveSequenceRef.current);

      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.path === normalizedOld || t.path === oldPath) {
            return {
              ...t,
              path: normalizedNew,
              title: normalizedNew.replace(/\.md$/, '').split('/').pop() || normalizedNew,
            };
          }
          return t;
        })
      );

      if (activeTabPathRef.current === normalizedOld || activeTabPathRef.current === oldPath) {
        activeTabPathRef.current = normalizedNew;
        setActiveTabPath(normalizedNew);
      }

      await refreshVault();
    } catch (err: any) {
      console.error(`Failed to rename "${oldPath}" to "${rawNewPath}":`, err);
      alert(`Rename failed: ${err.message || String(err)}`);
    }
  };

  const deletePath = async (path: VaultPath) => {
    try {
      // H16: Tombstone path so any in-flight delayed upsert is permanently dropped
      indexGenerationMapRef.current.set(path, Infinity);
      await storage.remove(path);
      await index.remove(path);
      coordinatorRef.current.removeNote(path);
      closeTab(path, true);
      await refreshVault();
    } catch (err) {
      console.error(`Failed to delete "${path}":`, err);
    }
  };

  useEffect(() => {
    if (!activeTab || !activeTabPath) {
      setParsedDoc(null);
      setBacklinks([]);
      return;
    }

    if (parseDebounceTimerRef.current) {
      clearTimeout(parseDebounceTimerRef.current);
    }

    parseDebounceTimerRef.current = setTimeout(async () => {
      try {
        const parsed = await parser.parse(
          activeTabPath,
          activeTab.content,
          activeTab.initialSnapshot?.version.hash || ''
        );
        if (activeTabPathRef.current === activeTabPath) {
          setParsedDoc(parsed);
          const bl = await index.getBacklinks(activeTabPath);
          if (activeTabPathRef.current === activeTabPath) {
            setBacklinks(bl);
          }
        }
      } catch (err) {
        console.error('Error parsing document:', err);
      }
    }, 150);

    return () => {
      if (parseDebounceTimerRef.current) {
        clearTimeout(parseDebounceTimerRef.current);
      }
    };
  }, [activeTabPath, activeTab?.content]);

  useEffect(() => {
    if (!activeTab || !activeTab.isDirty) return;

    const autosaveTimer = setTimeout(() => {
      void saveActiveNote();
    }, 2000);

    return () => clearTimeout(autosaveTimer);
  }, [activeTabPath, activeTab?.content, activeTab?.isDirty]);

  const updateNoteProperty = async (path: VaultPath, key: string, value: any) => {
    try {
      const currentSeq = ++saveSequenceRef.current;
      await coordinatorRef.current.updateProperty(path, key, value, parser);
      const state = coordinatorRef.current.getNoteState(path);
      if (state && state.committedSnapshot) {
        const parsed = await parser.parse(
          path,
          state.bufferContent,
          state.committedSnapshot.version.hash
        );
        const lastIndexed = indexGenerationMapRef.current.get(path) || 0;
        if (currentSeq > lastIndexed) {
          indexGenerationMapRef.current.set(path, currentSeq);
          await index.upsert(parsed);
          if (activeTabPathRef.current === path) {
            setParsedDoc(parsed);
            const bl = await index.getBacklinks(path);
            if (activeTabPathRef.current === path) {
              setBacklinks(bl);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to update note property:', err);
    }
  };

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

  const applyAIProposedEdit = async (
    proposal: any
  ): Promise<{ success: boolean; error?: string }> => {
    const currentSeq = ++saveSequenceRef.current;
    const res = await coordinatorRef.current.applyAI(proposal);
    if (res.success) {
      const state = coordinatorRef.current.getNoteState(proposal.path);
      if (state && state.committedSnapshot) {
        const parsed = await parser.parse(
          proposal.path,
          state.bufferContent,
          state.committedSnapshot.version.hash
        );
        const lastIndexed = indexGenerationMapRef.current.get(proposal.path) || 0;
        if (currentSeq > lastIndexed) {
          indexGenerationMapRef.current.set(proposal.path, currentSeq);
          await index.upsert(parsed);
          if (activeTabPathRef.current === proposal.path) {
            setParsedDoc(parsed);
            const bl = await index.getBacklinks(proposal.path);
            if (activeTabPathRef.current === proposal.path) {
              setBacklinks(bl);
            }
          }
        }
      }
    }
    return res;
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
    atomicWrites: (storage as any).atomicWrites ?? true,
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
