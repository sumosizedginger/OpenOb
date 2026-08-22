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
import {
  GatewayWorkspaceBackend,
  LocalWorkspaceBackend,
  OpenObGatewayClient,
  OpenObWorkspace,
  WorkspaceBackend,
  GatewayUnavailableError,
  WorkspaceChangeEvent,
} from '@okw/workspace';

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
  const [vaultMode, setVaultMode] = useState<'memory' | 'fsa' | 'gateway'>('memory');
  const [vaultName, setVaultName] = useState<string>('Open Knowledge Workspace');
  const [gatewayUrl, setGatewayUrl] = useState<string>('http://127.0.0.1:4200');
  const [gatewayToken, setGatewayToken] = useState<string | undefined>(undefined);
  const [gatewayConnected, setGatewayConnected] = useState<boolean>(false);
  const [eventRefreshCounter, setEventRefreshCounter] = useState<number>(0);

  // Local storage instances (used exclusively in local/standalone mode)
  const [storage, setStorage] = useState<VaultStorage>(
    () => new MemoryVaultStorage('Open Knowledge Workspace')
  );
  const [safeWriter, setSafeWriter] = useState<SafeWriter>(() => new SafeWriter(storage));
  const [index] = useState<MemoryDocumentIndex>(() => new MemoryDocumentIndex());
  const [parser] = useState<DefaultDocumentParser>(() => new DefaultDocumentParser());

  const coordinatorRef = useRef<NoteWriteCoordinator>(
    new NoteWriteCoordinator(storage, safeWriter)
  );

  // Authoritative workspace backend abstraction
  const [backend, setBackend] = useState<WorkspaceBackend>(() => {
    const ws = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      coordinator: coordinatorRef.current,
      vaultName: 'Open Knowledge Workspace',
      readOnly: false,
    });
    return new LocalWorkspaceBackend(ws);
  });

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<VaultPath | null>(null);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'saving' | 'modified' | 'conflict' | 'disconnected'
  >('saved');
  const [gatewayReachable, setGatewayReachable] = useState<boolean>(true);
  const [conflictData, setConflictData] = useState<{
    path: VaultPath;
    diskContent?: string;
  } | null>(null);

  const parseDebounceTimerRef = useRef<any>(null);
  const saveSequenceRef = useRef<number>(0);
  const pathEpochMapRef = useRef<Map<VaultPath, number>>(new Map());
  const pathSeqMapRef = useRef<Map<VaultPath, number>>(new Map());
  const vaultRebuildEpochRef = useRef<number>(0);
  const activeTabPathRef = useRef<VaultPath | null>(activeTabPath);
  activeTabPathRef.current = activeTabPath;
  const openTabsRef = useRef<OpenTab[]>(openTabs);
  openTabsRef.current = openTabs;
  const backendRef = useRef<WorkspaceBackend>(backend);
  backendRef.current = backend;
  const vaultModeRef = useRef<'memory' | 'fsa' | 'gateway'>(vaultMode);
  vaultModeRef.current = vaultMode;

  const activeTab = openTabs.find((t) => t.path === activeTabPath) || null;

  // Periodic gateway health check when in Gateway Mode (R3B-3)
  useEffect(() => {
    if (vaultMode !== 'gateway' || !gatewayConnected || !gatewayUrl) {
      setGatewayReachable(true);
      return;
    }

    let isMounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch(`${gatewayUrl}/health`, { method: 'GET' });
        if (res.ok) {
          if (isMounted) {
            setGatewayReachable(true);
            setSaveStatus((prev) => {
              if (prev === 'disconnected') {
                const active = openTabsRef.current.find((t) => t.path === activeTabPathRef.current);
                return active?.isDirty ? 'modified' : 'saved';
              }
              return prev;
            });
          }
        } else {
          if (isMounted) {
            setGatewayReachable(false);
            setSaveStatus('disconnected');
          }
        }
      } catch {
        if (isMounted) {
          setGatewayReachable(false);
          setSaveStatus('disconnected');
        }
      }
    };

    const timer = setInterval(checkHealth, 2000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [vaultMode, gatewayConnected, gatewayUrl]);

  // Expose test and introspection hooks on window only in DEV/TEST environments
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      ((import.meta as any).env?.DEV || (import.meta as any).env?.MODE === 'test')
    ) {
      (window as any).__vaultMode = vaultMode;
      (window as any).__backend = backend;
      (window as any).__vaultStorage = storage;
      (window as any).__coordinator = coordinatorRef.current;
      (window as any).__BrowserFSAVaultStorage = BrowserFSAVaultStorage;
      (window as any).__connectToGateway = connectToGateway;
      (window as any).__disconnectGateway = disconnectGateway;
      (window as any).__refreshVault = refreshVault;
      (window as any).__openNote = openNote;
      (window as any).__gatewayReachable = gatewayReachable;
      (window as any).__readStorage = async (p: string) => {
        return storage.readText(p);
      };

      let delayMs = 0;
      const uninstrumentedWrite = (storage as any).__origWrite || storage.write.bind(storage);
      (storage as any).__origWrite = uninstrumentedWrite;

      storage.write = async (...args: any[]) => {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        return (uninstrumentedWrite as any)(...args);
      };

      (window as any).__setStorageWriteDelay = (newDelay: number) => {
        delayMs = newDelay;
      };
    }
  }, [storage, backend, vaultMode, gatewayReachable]);

  // Coordinator listener (active ONLY in local mode)
  useEffect(() => {
    const unsubscribe = coordinatorRef.current.addListener((noteState: NoteState) => {
      if (vaultModeRef.current === 'gateway') return; // Strictly ignore coordinator in gateway mode

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
    async (
      currentStorage: VaultStorage = storage,
      currentIndex: MemoryDocumentIndex = index,
      currentBackend: WorkspaceBackend = backendRef.current
    ) => {
      try {
        if (vaultModeRef.current === 'gateway') {
          const list = await currentBackend.listEntries('');
          setEntries(list);
          if (activeTabPathRef.current) {
            const bl = await currentBackend.getBacklinks(activeTabPathRef.current);
            setBacklinks(bl);
          }
        } else {
          const list = await currentStorage.list('', true);
          setEntries(list);
          await rebuildVaultIndex(currentStorage, currentIndex, parser);
          vaultRebuildEpochRef.current++;
          if (activeTabPathRef.current) {
            const bl = await currentIndex.getBacklinks(activeTabPathRef.current);
            setBacklinks(bl);
          }
        }
      } catch (err) {
        console.error('Error refreshing vault:', err);
      }
    },
    [storage, index, parser]
  );

  // Open note via Gateway backend
  const openGatewayNote = async (
    rawPath: VaultPath,
    currentBackend: WorkspaceBackend = backendRef.current
  ) => {
    const path = normalizeVaultPath(rawPath);
    try {
      const note = await currentBackend.readNote(path);
      const snapshot: FileSnapshot = {
        path: note.path,
        content: new TextEncoder().encode(note.textContent),
        textContent: note.textContent,
        size: note.version.size ?? note.textContent.length,
        modifiedAt: note.version.modifiedAt ?? Date.now(),
        version: {
          token: note.version.token,
          hash: note.version.hash,
          modifiedAt: note.version.modifiedAt ?? Date.now(),
          size: note.version.size ?? note.textContent.length,
        },
      };

      const parsed = await parser.parse(note.path, note.textContent, note.version.hash);
      await index.upsert(parsed);
      const newTab: OpenTab = {
        path: note.path,
        title: parsed.title || note.path.replace(/\.md$/, '').split('/').pop() || note.path,
        isDirty: false,
        content: note.textContent,
        initialSnapshot: snapshot,
      };

      setOpenTabs((prev) => {
        if (prev.some((t) => t.path === note.path)) {
          return prev.map((t) => (t.path === note.path ? newTab : t));
        }
        return [...prev, newTab];
      });

      activeTabPathRef.current = note.path;
      setActiveTabPath(note.path);
      setParsedDoc(parsed);

      const bl = await currentBackend.getBacklinks(note.path);
      setBacklinks(bl);
      setSaveStatus('saved');
      setConflictData(null);
    } catch (err: any) {
      console.error(`Failed to open gateway note "${path}":`, err);
    }
  };

  // Live Gateway Change Stream SSE Subscription (Phase 3C)
  useEffect(() => {
    if (
      vaultMode !== 'gateway' ||
      !gatewayConnected ||
      !(backend instanceof GatewayWorkspaceBackend)
    ) {
      return;
    }

    const client = backend.getClient();
    let isSubscribed = true;

    const handleEvent = async (event: WorkspaceChangeEvent) => {
      if (!isSubscribed) return;
      setEventRefreshCounter((prev) => prev + 1);

      // 1. Reset event -> full refresh
      if (event.type === 'stream.reset') {
        await refreshVault();
        return;
      }

      // 2. Index degraded / recovered events
      if (event.type === 'index.degraded' || event.type === 'index.recovered') {
        return;
      }

      // 3. Structural & note mutations
      const affectedPath = event.path;
      const oldPath = event.oldPath;
      const newPath = event.newPath;

      // Invalidate directory entries for file creation, deletion, or renaming
      if (
        event.type === 'note.created' ||
        event.type === 'note.deleted' ||
        event.type === 'note.renamed'
      ) {
        try {
          const list = await backendRef.current.listEntries('');
          setEntries(list);
        } catch {}
      }

      // Handle DELETE
      if (event.type === 'note.deleted' && affectedPath) {
        setOpenTabs((prev) => {
          const targetTab = prev.find((t) => t.path === affectedPath);
          if (!targetTab) return prev;
          if (targetTab.isDirty) {
            // Keep dirty buffer, mark as deleted externally
            return prev;
          }
          // Clean tab -> close or remove
          return prev.filter((t) => t.path !== affectedPath);
        });

        if (activeTabPathRef.current === affectedPath) {
          const currentActive = openTabsRef.current.find((t) => t.path === affectedPath);
          if (currentActive?.isDirty) {
            setSaveStatus('conflict');
            setConflictData({ path: affectedPath, diskContent: undefined });
          } else {
            setActiveTabPath(null);
            activeTabPathRef.current = null;
            setParsedDoc(null);
            setBacklinks([]);
            setSaveStatus('saved');
          }
        }
        return;
      }

      // Handle RENAME
      if (event.type === 'note.renamed' && oldPath && newPath) {
        setOpenTabs((prev) =>
          prev.map((t) => {
            if (t.path !== oldPath) return t;
            if (t.isDirty) {
              // Keep dirty buffer intact
              return t;
            }
            return {
              ...t,
              path: newPath,
              title: newPath.replace(/\.md$/, '').split('/').pop() || newPath,
            };
          })
        );

        if (activeTabPathRef.current === oldPath) {
          const currentActive = openTabsRef.current.find((t) => t.path === oldPath);
          if (currentActive?.isDirty) {
            setSaveStatus('conflict');
            setConflictData({ path: oldPath, diskContent: undefined });
          } else {
            setActiveTabPath(newPath);
            activeTabPathRef.current = newPath;
            // Refetch authoritative renamed note content
            try {
              const note = await backendRef.current.readNote(newPath);
              const snapshot: FileSnapshot = {
                path: note.path,
                content: new TextEncoder().encode(note.textContent),
                textContent: note.textContent,
                size: note.version.size ?? note.textContent.length,
                modifiedAt: note.version.modifiedAt ?? Date.now(),
                version: {
                  token: note.version.token,
                  hash: note.version.hash,
                  modifiedAt: note.version.modifiedAt ?? Date.now(),
                  size: note.version.size ?? note.textContent.length,
                },
              };
              const parsed = await parser.parse(note.path, note.textContent, note.version.hash);
              setOpenTabs((prev) =>
                prev.map((t) =>
                  t.path === newPath
                    ? {
                        ...t,
                        content: note.textContent,
                        initialSnapshot: snapshot,
                        title: parsed.title,
                      }
                    : t
                )
              );
              setParsedDoc(parsed);
              const bl = await backendRef.current.getBacklinks(newPath);
              setBacklinks(bl);
              setSaveStatus('saved');
            } catch {}
          }
        }
        return;
      }

      // Handle CREATE
      if (event.type === 'note.created') {
        return;
      }

      // Handle MODIFY & PROPERTY_CHANGED
      if (
        (event.type === 'note.modified' || event.type === 'note.property_changed') &&
        affectedPath
      ) {
        const currentTab = openTabsRef.current.find((t) => t.path === affectedPath);
        if (!currentTab) return;

        // If self-event that we already applied:
        if (
          event.version?.token &&
          currentTab.initialSnapshot?.version.token === event.version.token &&
          !currentTab.isDirty
        ) {
          return;
        }

        if (currentTab.isDirty) {
          // DIRTY TAB: MUST PRESERVE HUMAN BUFFER!
          if (activeTabPathRef.current === affectedPath) {
            setSaveStatus('conflict');
            try {
              const latest = await backendRef.current.readNote(affectedPath);
              setConflictData({ path: affectedPath, diskContent: latest.textContent });
            } catch {
              setConflictData({ path: affectedPath });
            }
          }
        } else {
          // CLEAN TAB: Auto-update to authoritative latest version V2!
          try {
            const note = await backendRef.current.readNote(affectedPath);
            const snapshot: FileSnapshot = {
              path: note.path,
              content: new TextEncoder().encode(note.textContent),
              textContent: note.textContent,
              size: note.version.size ?? note.textContent.length,
              modifiedAt: note.version.modifiedAt ?? Date.now(),
              version: {
                token: note.version.token,
                hash: note.version.hash,
                modifiedAt: note.version.modifiedAt ?? Date.now(),
                size: note.version.size ?? note.textContent.length,
              },
            };
            const parsed = await parser.parse(note.path, note.textContent, note.version.hash);
            setOpenTabs((prev) =>
              prev.map((t) =>
                t.path === affectedPath
                  ? {
                      ...t,
                      content: note.textContent,
                      initialSnapshot: snapshot,
                      title: parsed.title || t.title,
                      isDirty: false,
                    }
                  : t
              )
            );

            if (activeTabPathRef.current === affectedPath) {
              setParsedDoc(parsed);
              const bl = await backendRef.current.getBacklinks(affectedPath);
              setBacklinks(bl);
              setSaveStatus('saved');
              setConflictData(null);
            }
          } catch (readErr) {
            console.error(`Failed to auto-update note "${affectedPath}":`, readErr);
          }
        }
      }
    };

    const subscription = client.subscribeToEvents({
      onEvent: handleEvent,
      onConnect: () => {
        setGatewayReachable(true);
      },
      onDisconnect: () => {
        setGatewayReachable(false);
        setSaveStatus('disconnected');
      },
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, [vaultMode, gatewayConnected, backend, parser, refreshVault]);

  // Connect to Gateway Flow
  const connectToGateway = useCallback(
    async (url: string, token?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const client = new OpenObGatewayClient({ url, token, clientId: 'openob-web' });
        const gatewayBackend = new GatewayWorkspaceBackend(client);
        const info = await gatewayBackend.getWorkspaceInfo();

        setBackend(gatewayBackend);
        backendRef.current = gatewayBackend;
        setGatewayUrl(url);
        setGatewayToken(token);
        setGatewayConnected(true);
        setVaultMode('gateway');
        vaultModeRef.current = 'gateway';
        setVaultName(info.name);

        // In desktop mode, token is delivered in-memory only via preload bridge; never persist to sessionStorage
        if (typeof window === 'undefined' || !(window as any).openobDesktop) {
          try {
            sessionStorage.setItem('openob_gateway_url', url);
            if (token) {
              sessionStorage.setItem('openob_gateway_token', token);
            } else {
              sessionStorage.removeItem('openob_gateway_token');
            }
          } catch {}
        }

        setOpenTabs([]);
        setActiveTabPath(null);
        setParsedDoc(null);
        setBacklinks([]);
        setConflictData(null);

        const list = await gatewayBackend.listEntries('');
        setEntries(list);

        const welcome = list.find((e) => e.path === 'Welcome.md' || e.name === 'Welcome.md');
        if (welcome) {
          await openGatewayNote('Welcome.md', gatewayBackend);
        } else {
          const first = list.find((e) => !e.isDirectory && e.path.endsWith('.md'));
          if (first) {
            await openGatewayNote(first.path, gatewayBackend);
          }
        }

        return { success: true };
      } catch (err: any) {
        console.error('Failed to connect to gateway:', err);
        return { success: false, error: err.message || String(err) };
      }
    },
    []
  );

  // Disconnect from Gateway -> Switch to Local Memory Vault
  const disconnectGateway = useCallback(
    async (options?: { force?: boolean }): Promise<{ success: boolean; cancelled?: boolean }> => {
      const hasDirtyTabs = openTabsRef.current.some((t) => t.isDirty);
      if (hasDirtyTabs && !options?.force) {
        const confirmDiscard =
          typeof window !== 'undefined'
            ? window.confirm('You have unsaved changes. Discard them and switch to local mode?')
            : true;
        if (!confirmDiscard) {
          return { success: false, cancelled: true };
        }
      }

      try {
        sessionStorage.removeItem('openob_gateway_url');
        sessionStorage.removeItem('openob_gateway_token');
      } catch {}

      setGatewayConnected(false);
      setGatewayReachable(true);
      setGatewayToken(undefined);
      setVaultMode('memory');
      vaultModeRef.current = 'memory';
      const memStorage = new MemoryVaultStorage('Open Knowledge Workspace');
      const newWriter = new SafeWriter(memStorage);
      const newIndex = new MemoryDocumentIndex();
      const newWorkspace = new OpenObWorkspace({
        storage: memStorage,
        index: newIndex,
        parser,
        safeWriter: newWriter,
        vaultName: 'Open Knowledge Workspace',
        readOnly: false,
      });
      setStorage(memStorage);
      setSafeWriter(newWriter);
      coordinatorRef.current.setStorage(memStorage, newWriter);
      const localBackend = new LocalWorkspaceBackend(newWorkspace);
      setBackend(localBackend);
      backendRef.current = localBackend;
      setVaultName('Open Knowledge Workspace');
      setOpenTabs([]);
      setActiveTabPath(null);
      setParsedDoc(null);
      setBacklinks([]);
      setConflictData(null);
      setSaveStatus('saved');

      await memStorage.seed(DEFAULT_VAULT_SEED);
      await refreshVault(memStorage, newIndex, localBackend);
      await openNote('Welcome.md');
      return { success: true };
    },
    [parser]
  );

  // Auto-connect or seed initial vault on mount
  useEffect(() => {
    void (async () => {
      // 1. Electron Desktop Bootstrap integration (in-memory token delivery)
      if (typeof window !== 'undefined' && window.openobDesktop) {
        try {
          const bootstrap = await window.openobDesktop.getBootstrapConfig();
          if (bootstrap && bootstrap.gatewayUrl) {
            const res = await connectToGateway(bootstrap.gatewayUrl, bootstrap.token);
            if (res.success) {
              window.openobDesktop.onLifecycleEvent(async (event) => {
                if (event.type === 'vault-switched' && event.payload) {
                  await connectToGateway(event.payload.gatewayUrl, event.payload.token);
                }
              });
              return;
            }
          }
        } catch (err) {
          console.warn('[useVault] Failed to connect to desktop gateway bootstrap:', err);
        }
        // In desktop mode, if embedded gateway is unreachable, fail truthfully without ghost state (P3-5)
        setGatewayConnected(false);
        setSaveStatus('disconnected');
        setGatewayReachable(false);
        return;
      }

      // 2. Browser session restoration
      let restored = false;
      try {
        const savedUrl = sessionStorage.getItem('openob_gateway_url');
        const savedToken = sessionStorage.getItem('openob_gateway_token') || undefined;
        if (savedUrl) {
          const res = await connectToGateway(savedUrl, savedToken);
          if (res.success) {
            restored = true;
          }
        }
      } catch {}

      if (!restored) {
        if (storage instanceof MemoryVaultStorage) {
          await storage.seed(DEFAULT_VAULT_SEED);
          await refreshVault(storage, index, backendRef.current);
          await openNote('Welcome.md');
        }
      }
    })();
  }, []);

  // Open directory via Native Picker (Desktop) or File System Access API (Browser)
  const openDirectoryVault = async () => {
    // 1. Electron Desktop native directory picker
    if (typeof window !== 'undefined' && window.openobDesktop) {
      try {
        const newBootstrap = await window.openobDesktop.chooseVault();
        if (newBootstrap && newBootstrap.gatewayUrl) {
          await connectToGateway(newBootstrap.gatewayUrl, newBootstrap.token);
        }
        return;
      } catch (err) {
        console.error('[useVault] Error choosing desktop vault:', err);
      }
    }

    // 2. Browser File System Access API
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        const fsaStorage = new BrowserFSAVaultStorage(handle, handle.name);
        const newWriter = new SafeWriter(fsaStorage);
        const newWorkspace = new OpenObWorkspace({
          storage: fsaStorage,
          index,
          parser,
          safeWriter: newWriter,
          vaultName: handle.name,
          readOnly: false,
        });

        setStorage(fsaStorage);
        setSafeWriter(newWriter);
        coordinatorRef.current.setStorage(fsaStorage, newWriter);
        const localBackend = new LocalWorkspaceBackend(newWorkspace);
        setBackend(localBackend);
        backendRef.current = localBackend;
        setVaultMode('fsa');
        vaultModeRef.current = 'fsa';
        setVaultName(handle.name);

        pathEpochMapRef.current.clear();
        pathSeqMapRef.current.clear();
        vaultRebuildEpochRef.current++;
        setOpenTabs([]);
        setActiveTabPath(null);
        await refreshVault(fsaStorage, index, localBackend);
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

    if (vaultModeRef.current === 'gateway') {
      await openGatewayNote(path);
      return;
    }

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

      pathEpochMapRef.current.set(path, (pathEpochMapRef.current.get(path) ?? 0) + 1);
      pathSeqMapRef.current.set(path, 0);

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

    if (vaultModeRef.current !== 'gateway') {
      coordinatorRef.current.removeNote(path, discarded);
    }

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
    if (vaultModeRef.current === 'gateway') {
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.path === targetPath) {
            const diskText = tab.initialSnapshot?.textContent ?? '';
            const isDirty = diskText !== newContent;
            return { ...tab, content: newContent, isDirty };
          }
          return tab;
        })
      );
      if (targetPath === activeTabPathRef.current) {
        const active = openTabsRef.current.find((t) => t.path === targetPath);
        const diskText = active?.initialSnapshot?.textContent ?? '';
        setSaveStatus(diskText !== newContent ? 'modified' : 'saved');
      }
      return;
    }

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

    const currentTab = openTabsRef.current.find((t) => t.path === currentPath);
    if (!currentTab) return;
    if (!currentTab.isDirty && !force) return;

    if (vaultModeRef.current === 'gateway') {
      setSaveStatus('saving');
      try {
        const expectedToken = currentTab.initialSnapshot?.version.token || '';
        const res = await backendRef.current.updateNote({
          path: currentPath,
          content: currentTab.content,
          expectedVersion: {
            token: expectedToken,
            hash: currentTab.initialSnapshot?.version.hash,
          },
        });

        // Update tab with new authoritative version
        const newSnapshot: FileSnapshot = {
          path: currentPath,
          content: new TextEncoder().encode(currentTab.content),
          textContent: currentTab.content,
          size: res.currentVersion.size ?? currentTab.content.length,
          modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
          version: {
            token: res.currentVersion.token,
            hash: res.currentVersion.hash ?? '',
            modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
            size: res.currentVersion.size ?? currentTab.content.length,
          },
        };

        setOpenTabs((prev) =>
          prev.map((t) => {
            if (t.path !== currentPath) return t;
            return {
              ...t,
              isDirty: false,
              initialSnapshot: newSnapshot,
            };
          })
        );

        const parsed = await parser.parse(
          currentPath,
          currentTab.content,
          res.currentVersion.hash || ''
        );
        await index.upsert(parsed);
        if (activeTabPathRef.current === currentPath) {
          setParsedDoc(parsed);
          const bl = await backendRef.current.getBacklinks(currentPath);
          if (activeTabPathRef.current === currentPath) {
            setBacklinks(bl);
          }
          setSaveStatus('saved');
          setConflictData(null);
        }
      } catch (err: any) {
        if (err.status === 401 || err.code === 'UNAUTHORIZED') {
          setSaveStatus('modified');
          alert('Gateway authentication failed (HTTP 401). Please check your authorization token.');
        } else if (err.status === 403 || err.code === 'FORBIDDEN') {
          setSaveStatus('modified');
          alert('Read-only gateway: mutations are not permitted.');
        } else if (err.status === 404 || err.code === 'NOT_FOUND') {
          setSaveStatus('conflict');
          setConflictData({ path: currentPath });
        } else if (err.status === 413 || err.code === 'PAYLOAD_TOO_LARGE') {
          setSaveStatus('modified');
          alert('Payload too large (HTTP 413): note exceeds gateway maximum body size.');
        } else if (err.status === 409 || err.code === 'CONFLICT') {
          setSaveStatus('conflict');
          try {
            const latest = await backendRef.current.readNote(currentPath);
            setConflictData({ path: currentPath, diskContent: latest.textContent });
          } catch {
            setConflictData({ path: currentPath });
          }
        } else if (
          err instanceof GatewayUnavailableError ||
          err.status === 503 ||
          err.code === 'GATEWAY_UNAVAILABLE' ||
          err.name === 'TypeError'
        ) {
          setGatewayReachable(false);
          setSaveStatus('disconnected');
          console.error('Gateway unreachable:', err);
        } else {
          setSaveStatus('modified');
          console.error('Gateway save failed:', err);
        }
      }
      return;
    }

    try {
      const startEpoch = pathEpochMapRef.current.get(currentPath) ?? 0;
      const startRebuildEpoch = vaultRebuildEpochRef.current;
      const currentSeq = ++saveSequenceRef.current;

      const snapshot = await coordinatorRef.current.save(currentPath, force);
      if (snapshot) {
        const savedText =
          snapshot.textContent ??
          new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.content);
        const parsed = await parser.parse(currentPath, savedText, snapshot.version.hash);

        const currentPathEpoch = pathEpochMapRef.current.get(currentPath) ?? 0;
        const lastIndexed = pathSeqMapRef.current.get(currentPath) ?? 0;

        if (
          startRebuildEpoch === vaultRebuildEpochRef.current &&
          startEpoch === currentPathEpoch &&
          currentSeq > lastIndexed
        ) {
          pathSeqMapRef.current.set(currentPath, currentSeq);
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

      if (vaultModeRef.current === 'gateway') {
        const existingEntries = await backendRef.current.listEntries('');
        while (existingEntries.some((e) => e.path === targetPath)) {
          name = `Untitled ${counter}.md`;
          targetPath = folder ? `${folder}/${name}` : name;
          counter++;
        }
      } else {
        while (await storage.exists(targetPath)) {
          name = `Untitled ${counter}.md`;
          targetPath = folder ? `${folder}/${name}` : name;
          counter++;
        }
      }
    }

    let candidate = targetPath;
    let counter = 1;
    while (openTabs.some((t) => t.path === candidate)) {
      const base = targetPath.replace(/\.md$/, '');
      candidate = `${base}-${counter}.md`;
      counter++;
    }

    const initialContent = `# ${candidate.replace(/\.md$/, '').split('/').pop()}\n\n`;

    if (vaultModeRef.current === 'gateway') {
      try {
        const res = await backendRef.current.createNote({
          path: candidate,
          content: initialContent,
        });

        const snapshot: FileSnapshot = {
          path: candidate,
          content: new TextEncoder().encode(initialContent),
          textContent: initialContent,
          size: res.currentVersion.size ?? initialContent.length,
          modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
          version: {
            token: res.currentVersion.token,
            hash: res.currentVersion.hash ?? '',
            modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
            size: res.currentVersion.size ?? initialContent.length,
          },
        };

        const parsed = await parser.parse(candidate, initialContent, res.currentVersion.hash || '');
        const newTab: OpenTab = {
          path: candidate,
          title: parsed.title,
          isDirty: false,
          content: initialContent,
          initialSnapshot: snapshot,
        };

        setOpenTabs((prev) => [...prev, newTab]);
        setActiveTabPath(candidate);
        activeTabPathRef.current = candidate;
        setParsedDoc(parsed);
        setBacklinks([]);
        setSaveStatus('saved');
        await refreshVault();
      } catch (err: any) {
        console.error(`Failed to create gateway note "${candidate}":`, err);
        alert(`Create note failed: ${err.message || String(err)}`);
      }
      return;
    }

    try {
      const res = await safeWriter.safeSave(candidate, initialContent, { expectedVersion: null });
      const parsed = await parser.parse(candidate, initialContent, res.snapshot.version.hash);
      await index.upsert(parsed);

      coordinatorRef.current.initNote(candidate, res.snapshot, initialContent);

      pathEpochMapRef.current.set(candidate, (pathEpochMapRef.current.get(candidate) ?? 0) + 1);
      pathSeqMapRef.current.set(candidate, 0);

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
      if (vaultModeRef.current === 'gateway') {
        const existing = await backendRef.current.listEntries('');
        while (existing.some((e) => e.path === candidate)) {
          candidate = `New Folder ${counter}`;
          counter++;
        }
      } else {
        while (await storage.exists(candidate)) {
          candidate = `New Folder ${counter}`;
          counter++;
        }
      }
      targetPath = candidate;
    }
    if (!targetPath) return;

    if (vaultModeRef.current === 'gateway') {
      // In Gateway Mode, folder creation is implicit through note creation or subpaths
      await refreshVault();
      return;
    }

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

      if (vaultModeRef.current === 'gateway') {
        const tab = openTabsRef.current.find((t) => t.path === normalizedOld || t.path === oldPath);
        const expectedToken = tab?.initialSnapshot?.version.token || '';

        const res = await backendRef.current.renameNote({
          oldPath: normalizedOld,
          newPath: normalizedNew,
          expectedVersion: {
            token: expectedToken,
            hash: tab?.initialSnapshot?.version.hash,
          },
          updateLinks: true,
        });

        setOpenTabs((prev) =>
          prev.map((t) => {
            if (t.path === normalizedOld || t.path === oldPath) {
              const updatedSnapshot: FileSnapshot | null = t.initialSnapshot
                ? {
                    ...t.initialSnapshot,
                    path: normalizedNew,
                    version: {
                      token: res.currentVersion.token,
                      hash: res.currentVersion.hash ?? '',
                      modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
                      size: res.currentVersion.size ?? t.initialSnapshot.size,
                    },
                  }
                : null;
              return {
                ...t,
                path: normalizedNew,
                title: normalizedNew.replace(/\.md$/, '').split('/').pop() || normalizedNew,
                initialSnapshot: updatedSnapshot,
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
        return;
      }

      await coordinatorRef.current.waitForIdle(normalizedOld);
      await renameDocument(storage, index, parser, normalizedOld, normalizedNew);
      const newSnap = await storage.read(normalizedNew);
      coordinatorRef.current.renameNote(normalizedOld, normalizedNew, newSnap);

      pathEpochMapRef.current.set(
        normalizedOld,
        (pathEpochMapRef.current.get(normalizedOld) ?? 0) + 1
      );
      pathSeqMapRef.current.delete(normalizedOld);
      pathEpochMapRef.current.set(
        normalizedNew,
        (pathEpochMapRef.current.get(normalizedNew) ?? 0) + 1
      );
      pathSeqMapRef.current.set(normalizedNew, ++saveSequenceRef.current);

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
      if (vaultModeRef.current === 'gateway') {
        const tab = openTabsRef.current.find((t) => t.path === path);
        const expectedToken = tab?.initialSnapshot?.version.token || '';

        await backendRef.current.deleteNote({
          path,
          expectedVersion: {
            token: expectedToken,
            hash: tab?.initialSnapshot?.version.hash,
          },
        });

        closeTab(path, true);
        await refreshVault();
        return;
      }

      await coordinatorRef.current.waitForIdle(path);
      coordinatorRef.current.removeNote(path);

      pathEpochMapRef.current.set(path, (pathEpochMapRef.current.get(path) ?? 0) + 1);
      pathSeqMapRef.current.delete(path);

      await storage.remove(path);
      await index.remove(path);
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
          if (vaultModeRef.current === 'gateway') {
            const bl = await backendRef.current.getBacklinks(activeTabPath);
            if (activeTabPathRef.current === activeTabPath) {
              setBacklinks(bl);
            }
          } else {
            const bl = await index.getBacklinks(activeTabPath);
            if (activeTabPathRef.current === activeTabPath) {
              setBacklinks(bl);
            }
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
      if (vaultModeRef.current === 'gateway') {
        const tab = openTabsRef.current.find((t) => t.path === path);
        const expectedToken = tab?.initialSnapshot?.version.token || '';

        const res = await backendRef.current.setProperty({
          path,
          key,
          value,
          expectedVersion: {
            token: expectedToken,
            hash: tab?.initialSnapshot?.version.hash,
          },
        });

        // Read updated note to reflect updated frontmatter
        const updated = await backendRef.current.readNote(path);
        const snapshot: FileSnapshot = {
          path: updated.path,
          content: new TextEncoder().encode(updated.textContent),
          textContent: updated.textContent,
          size: updated.version.size ?? updated.textContent.length,
          modifiedAt: updated.version.modifiedAt ?? Date.now(),
          version: {
            token: res.currentVersion.token,
            hash: res.currentVersion.hash ?? updated.version.hash,
            modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
            size: res.currentVersion.size ?? updated.textContent.length,
          },
        };

        const parsed = await parser.parse(updated.path, updated.textContent, snapshot.version.hash);

        setOpenTabs((prev) =>
          prev.map((t) => {
            if (t.path !== path) return t;
            return {
              ...t,
              content: updated.textContent,
              isDirty: false,
              initialSnapshot: snapshot,
            };
          })
        );

        if (activeTabPathRef.current === path) {
          setParsedDoc(parsed);
          const bl = await backendRef.current.getBacklinks(path);
          setBacklinks(bl);
        }
        return;
      }

      const startEpoch = pathEpochMapRef.current.get(path) ?? 0;
      const startRebuildEpoch = vaultRebuildEpochRef.current;
      const currentSeq = ++saveSequenceRef.current;

      await coordinatorRef.current.updateProperty(path, key, value, parser);
      const state = coordinatorRef.current.getNoteState(path);
      if (state && state.committedSnapshot) {
        const parsed = await parser.parse(
          path,
          state.bufferContent,
          state.committedSnapshot.version.hash
        );
        const currentPathEpoch = pathEpochMapRef.current.get(path) ?? 0;
        const lastIndexed = pathSeqMapRef.current.get(path) ?? 0;

        if (
          startRebuildEpoch === vaultRebuildEpochRef.current &&
          startEpoch === currentPathEpoch &&
          currentSeq > lastIndexed
        ) {
          pathSeqMapRef.current.set(path, currentSeq);
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

    if (vaultModeRef.current === 'gateway') {
      try {
        await backendRef.current.createNote({
          path: targetPath,
          content: fullContent,
          properties: initialProps,
        });
        await refreshVault();
        await openNote(targetPath);
      } catch (err: any) {
        console.error('Failed to create note with properties in gateway:', err);
      }
      return;
    }

    await storage.write(targetPath, null, fullContent);
    pathEpochMapRef.current.set(targetPath, (pathEpochMapRef.current.get(targetPath) ?? 0) + 1);
    pathSeqMapRef.current.set(targetPath, 0);

    await refreshVault();
    await openNote(targetPath);
  };

  const applyAIProposedEdit = async (
    proposal: any
  ): Promise<{ success: boolean; error?: string }> => {
    const targetPath = proposal.path;
    const nextContent = proposal.proposedContent ?? proposal.newContent;

    if (vaultModeRef.current === 'gateway') {
      try {
        const tab = openTabsRef.current.find((t) => t.path === targetPath);
        const expectedVersion =
          proposal.expectedVersion ??
          (tab?.initialSnapshot
            ? {
                token: tab.initialSnapshot.version.token,
                hash: tab.initialSnapshot.version.hash,
                modifiedAt: tab.initialSnapshot.version.modifiedAt,
                size: tab.initialSnapshot.version.size,
              }
            : undefined);

        const res = await backendRef.current.updateNote({
          path: targetPath,
          content: nextContent,
          expectedVersion,
        });

        const snapshot: FileSnapshot = {
          path: targetPath,
          content: new TextEncoder().encode(nextContent),
          textContent: nextContent,
          size: res.currentVersion.size ?? nextContent.length,
          modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
          version: {
            token: res.currentVersion.token,
            hash: res.currentVersion.hash ?? '',
            modifiedAt: res.currentVersion.modifiedAt ?? Date.now(),
            size: res.currentVersion.size ?? nextContent.length,
          },
        };

        setOpenTabs((prev) =>
          prev.map((t) => {
            if (t.path !== targetPath) return t;
            return {
              ...t,
              content: nextContent,
              isDirty: false,
              initialSnapshot: snapshot,
            };
          })
        );

        if (activeTabPathRef.current === targetPath) {
          const parsed = await parser.parse(targetPath, nextContent, res.currentVersion.hash || '');
          setParsedDoc(parsed);
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    }

    const startEpoch = pathEpochMapRef.current.get(targetPath) ?? 0;
    const startRebuildEpoch = vaultRebuildEpochRef.current;
    const currentSeq = ++saveSequenceRef.current;

    const res = await coordinatorRef.current.applyAI({
      ...proposal,
      newContent: nextContent,
    });
    if (res.success) {
      const state = coordinatorRef.current.getNoteState(targetPath);
      if (state && state.committedSnapshot) {
        const parsed = await parser.parse(
          targetPath,
          state.bufferContent,
          state.committedSnapshot.version.hash
        );
        const currentPathEpoch = pathEpochMapRef.current.get(targetPath) ?? 0;
        const lastIndexed = pathSeqMapRef.current.get(targetPath) ?? 0;

        if (
          startRebuildEpoch === vaultRebuildEpochRef.current &&
          startEpoch === currentPathEpoch &&
          currentSeq > lastIndexed
        ) {
          pathSeqMapRef.current.set(targetPath, currentSeq);
          await index.upsert(parsed);
          if (activeTabPathRef.current === targetPath) {
            setParsedDoc(parsed);
            const bl = await index.getBacklinks(targetPath);
            if (activeTabPathRef.current === targetPath) {
              setBacklinks(bl);
            }
          }
        }
      }
    }
    return res;
  };

  return {
    vaultName,
    vaultMode,
    mode: vaultMode === 'gateway' ? ('gateway' as const) : ('local' as const),
    isReadOnly: backend.isReadOnly,
    gatewayUrl,
    gatewayToken,
    gatewayConnected,
    gatewayReachable,
    eventRefreshCounter,
    backend,
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
    connectToGateway,
    disconnectGateway,
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
