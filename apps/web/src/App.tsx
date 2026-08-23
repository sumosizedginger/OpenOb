import React, { useState, useEffect, useRef } from 'react';
import { useVault } from './hooks/useVault.js';
import { FileTree } from './components/FileTree.js';
import { Editor } from './components/Editor.js';
import { TabBar } from './components/TabBar.js';
import { PreviewPane } from './components/PreviewPane.js';
import { BacklinksPanel } from './components/BacklinksPanel.js';
import { OutlinePanel } from './components/OutlinePanel.js';
import { GraphView } from './components/GraphView.js';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { ViewContainer } from './components/views/ViewContainer.js';
import { AIChatDrawer } from './components/ai/AIChatDrawer.js';
import { SearchModal } from './components/SearchModal.js';
import { StatusBar } from './components/StatusBar.js';
import { ConflictModal } from './components/ConflictModal.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ParsedHeading, VaultPath } from '@okw/core';
import { updateDocumentFrontmatter } from '@okw/markdown';
import { ProposedEdit } from '@okw/ai';
import {
  GatewayAIBackend,
  LocalAIBackend,
  createWorkspacePluginHostServices,
} from '@okw/workspace';
import {
  PluginHost,
  wordCountManifest,
  WordCountPlugin,
  dailyNotesManifest,
  DailyNotesPlugin,
  templatesManifest,
  TemplatesPlugin,
  characterBibleManifest,
  CharacterBiblePlugin,
  manuscriptToolsManifest,
  ManuscriptToolsPlugin,
} from '@okw/plugin';
import { PluginManagerModal } from './components/plugins/PluginManagerModal.js';
import { GatewayConnectModal } from './components/GatewayConnectModal.js';
import { WelcomeModal } from './components/onboarding/WelcomeModal.js';
import { getPublicAssetUrl } from './utils/assets.js';
import { TourOverlay } from './components/onboarding/TourOverlay.js';
import { LearnCenterModal } from './components/onboarding/LearnCenterModal.js';
import { KeyboardShortcutsModal } from './components/onboarding/KeyboardShortcutsModal.js';
import { AboutModal } from './components/AboutModal.js';
import { useOnboarding } from './onboarding/useOnboarding.js';
import {
  FolderPlus,
  FilePlus,
  BookOpen,
  Eye,
  Columns,
  Search,
  RefreshCw,
  FolderOpen,
  ListTree,
  PanelLeftClose,
  PanelLeft,
  Share2,
  LayoutGrid,
  FileText,
  Bot,
  Boxes,
  AlertTriangle,
  Server,
  MoreHorizontal,
  X,
  ChevronDown,
  GraduationCap,
  Keyboard,
  Info,
} from 'lucide-react';

export const App: React.FC = () => {
  const {
    vaultName,
    vaultMode,
    isReadOnly,
    gatewayUrl,
    gatewayReachable,
    isAppReady,
    eventRefreshCounter,
    backend,
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
    applyAIProposedEdit,
    atomicWrites,
    dismissConflict,
    resolveConflictReload,
  } = useVault();

  const [mainMode, setMainMode] = useState<'editor' | 'views'>('editor');
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState<
    'backlinks' | 'outline' | 'graph' | 'properties' | 'ai' | null
  >('outline');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isGatewayModalOpen, setIsGatewayModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isViewModeMenuOpen, setIsViewModeMenuOpen] = useState(false);
  const [selectedSearchTag, setSelectedSearchTag] = useState<string | null>(null);
  const [isGlobalGraphOpen, setIsGlobalGraphOpen] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [allTags, setAllTags] = useState<Map<string, number>>(new Map());

  const {
    onboardingState,
    isWelcomeOpen,
    isLearnCenterOpen,
    isShortcutsOpen,
    activeChapter,
    currentStepIndex,
    startQuickTour,
    skipFirstRun,
    startChapter,
    nextStep,
    prevStep,
    skipTour,
    finishTour,
    resetProgress,
    openLearnCenter,
    closeLearnCenter,
    openShortcuts,
    closeShortcuts,
  } = useOnboarding({
    isAppReady: isAppReady ?? true,
    onPrepareAction: (actionId: string) => {
      if (actionId === 'open-sidebar') {
        setShowSidebar(true);
      } else if (actionId === 'mode-editor') {
        setMainMode('editor');
      } else if (actionId === 'open-inspector') {
        if (!showRightPanel) setShowRightPanel('outline');
      } else if (actionId === 'tab-outline') {
        setShowRightPanel('outline');
      } else if (actionId === 'tab-backlinks') {
        setShowRightPanel('backlinks');
      } else if (actionId === 'tab-properties') {
        setShowRightPanel('properties');
      } else if (actionId === 'tab-ai') {
        setShowRightPanel('ai');
      } else if (actionId === 'open-more-menu') {
        setIsMoreMenuOpen(true);
      }
    },
  });

  // Handle native Electron application menu events
  useEffect(() => {
    if (typeof window !== 'undefined' && window.openobDesktop?.onMenuAction) {
      const unsubscribe = window.openobDesktop.onMenuAction((action) => {
        if (action === 'learn') {
          openLearnCenter();
        } else if (action === 'quick-tour') {
          void startQuickTour();
        } else if (action === 'shortcuts') {
          openShortcuts();
        } else if (action === 'about') {
          setIsAboutOpen(true);
        }
      });
      return unsubscribe;
    }
  }, [openLearnCenter, startQuickTour, openShortcuts]);

  const moreMenuRef = useRef<HTMLDivElement>(null);
  const viewModeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (viewModeMenuRef.current && !viewModeMenuRef.current.contains(e.target as Node)) {
        setIsViewModeMenuOpen(false);
      }
    };
    if (isMoreMenuOpen || isViewModeMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreMenuOpen, isViewModeMenuOpen]);

  const aiBackend = React.useMemo(() => {
    if (vaultMode === 'gateway' && gatewayUrl) {
      const token = (backend as any)?.getClient?.()?.getToken?.() || (backend as any)?.token || '';
      return new GatewayAIBackend({
        url: gatewayUrl,
        token,
      });
    }
    return new LocalAIBackend(backend);
  }, [vaultMode, gatewayUrl, backend]);

  // Initialize PluginHost with First-Party Plugins (Constitution Law 20 / Phase 3H)
  const [pluginHost] = useState<PluginHost>(() => {
    const services = createWorkspacePluginHostServices(backend, aiBackend, {
      getActiveNotePath: () => activeTabPath,
      openNote: async (p) => {
        setMainMode('editor');
        await openNote(p);
      },
      showNotice: (msg) => {
        alert(msg);
      },
    });

    const host = new PluginHost({ services });

    host.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
    host.registerPlugin(templatesManifest, () => new TemplatesPlugin());
    host.registerPlugin(characterBibleManifest, () => new CharacterBiblePlugin());
    host.registerPlugin(manuscriptToolsManifest, () => new ManuscriptToolsPlugin());

    return host;
  });

  // Pre-load plugin states before enabling
  useEffect(() => {
    const isMounted = true;
    void (async () => {
      let savedStates: Record<string, boolean> = {};
      if (typeof window !== 'undefined' && window.openobDesktop?.getPluginStates) {
        try {
          savedStates = await window.openobDesktop.getPluginStates();
        } catch (err) {
          console.warn('Failed to load desktop plugin states:', err);
        }
      } else {
        try {
          const raw = localStorage.getItem('openob_plugin_states');
          if (raw) savedStates = JSON.parse(raw);
        } catch {}
      }

      const defaultPlugins = [
        wordCountManifest.id,
        dailyNotesManifest.id,
        templatesManifest.id,
        characterBibleManifest.id,
        manuscriptToolsManifest.id,
      ];

      for (const pluginId of defaultPlugins) {
        const isExplicitlyDisabled = savedStates[pluginId] === false;
        if (!isExplicitlyDisabled && isMounted) {
          await pluginHost.enablePlugin(pluginId);
        }
      }
    })();
  }, [pluginHost]);

  // Keep plugin host context updated with live backend authority (Gateway vs Standalone)
  useEffect(() => {
    pluginHost.updateContext({
      services: createWorkspacePluginHostServices(backend, aiBackend, {
        getActiveNotePath: () => activeTabPath,
        openNote: async (p) => {
          setMainMode('editor');
          await openNote(p);
        },
        showNotice: (msg) => {
          alert(msg);
        },
      }),
    });

    if (import.meta.env.DEV || (import.meta.env as any).MODE === 'test') {
      (window as any).__pluginHost = pluginHost;
    }
  }, [pluginHost, backend, aiBackend, activeTabPath, openNote]);

  // Aggregate vault tags for Properties & Tags Explorer
  useEffect(() => {
    let isMounted = true;
    const aggregateTags = async () => {
      const docs = await index.getAll();
      const tagMap = new Map<string, number>();
      for (const doc of docs) {
        for (const tag of doc.tags) {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        }
      }
      if (isMounted) {
        setAllTags(tagMap);
      }
    };
    void aggregateTags();
    return () => {
      isMounted = false;
    };
  }, [index, activeTab?.initialSnapshot?.version.hash]);

  // Global window keyboard shortcuts for Phase 2 Workspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInsideEditor = (e.target as HTMLElement)?.closest?.('.cm-editor');

      // Ctrl/Cmd+P or Ctrl/Cmd+Shift+P: Quick Open / Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (!isInsideEditor) {
          e.preventDefault();
          setIsCommandPaletteOpen((prev) => !prev);
        }
      }

      // Ctrl/Cmd+N: Create New Note
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setMainMode('editor');
        void createNote();
      }

      // Ctrl/Cmd+Shift+F: Global Vault Search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSelectedSearchTag(null);
        setIsSearchModalOpen((prev) => !prev);
      }

      // Ctrl/Cmd+G: Toggle Global Graph View
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setIsGlobalGraphOpen((prev) => !prev);
      }

      // Ctrl/Cmd+B: Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setShowSidebar((prev) => !prev);
      }

      // Ctrl/Cmd+\: Toggle Split View
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'split' ? 'editor' : 'split'));
      }

      // Ctrl/Cmd+E: Cycle View Mode
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setViewMode((prev) =>
          prev === 'split' ? 'editor' : prev === 'editor' ? 'preview' : 'split'
        );
      }

      // Ctrl/Cmd+W: Close active tab (unconditional preventDefault P2-4)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
      }

      // Ctrl/Cmd+S: Safe Save (when not inside editor)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (!isInsideEditor) {
          e.preventDefault();
          void saveActiveNote();
        }
      }

      // Escape: Dismiss active overlay modals
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setIsSearchModalOpen(false);
        setIsGlobalGraphOpen(false);
        setIsPluginModalOpen(false);
        setIsGatewayModalOpen(false);
        setIsMoreMenuOpen(false);
        setIsViewModeMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveNote, activeTabPath, closeTab, createNote]);

  const handleSelectHeading = (heading: ParsedHeading) => {
    if (viewMode === 'editor') {
      setViewMode('split');
    }
    setTimeout(() => {
      const headingEl =
        document.getElementById(`heading-${heading.line}`) || document.getElementById(heading.slug);
      if (headingEl) {
        headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  const handleNavigateWikilink = (target: string) => {
    if (!activeTabPath) return;
    const res = index.resolveLink(activeTabPath, target);
    if (res.resolved && res.targetPath) {
      setMainMode('editor');
      void openNote(res.targetPath);
    } else {
      const cleanName = target.split('#')[0].split('|')[0].trim();
      if (confirm(`Note "${cleanName}" does not exist. Would you like to create it?`)) {
        void createNote(cleanName);
      }
    }
  };

  const handleApplyProposedEdit = async (proposal: ProposedEdit) => {
    return await applyAIProposedEdit(proposal);
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="header-left">
          <button
            className="btn-icon"
            onClick={() => setShowSidebar((prev) => !prev)}
            title="Toggle Sidebar (Ctrl+B)"
          >
            {showSidebar ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </button>
          <div className="app-logo" data-tour="app-logo">
            <img
              src={getPublicAssetUrl('brand/openob-mark.png')}
              alt="OpenOb logo — jackass skull within a broken gold sigil"
              className="logo-icon"
              width={22}
              height={22}
            />
            <span className="logo-text">OpenOb</span>
          </div>
          <span className="vault-badge" title={`Vault: ${vaultName}`}>
            {vaultName}
          </span>
          {activeTab && (
            <span
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginLeft: '4px',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <span
                style={{
                  maxWidth: '180px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activeTab.path}
              </span>
            </span>
          )}
        </div>

        <div className="header-center">
          <button
            className="search-trigger-btn"
            data-tour="search-button"
            onClick={() => {
              setSelectedSearchTag(null);
              setIsCommandPaletteOpen(true);
            }}
            title="Quick Open (Ctrl+P)"
          >
            <Search size={13} />
            <span>Search or jump to note...</span>
            <kbd>Ctrl+P</kbd>
          </button>
        </div>

        <div className="header-right">
          {/* Mode Switcher: Notes Editor vs Database Views */}
          <div className="view-mode-group" data-tour="views-switch">
            <button
              className={`view-mode-btn ${mainMode === 'editor' ? 'active' : ''}`}
              data-testid="main-mode-editor"
              title="Notes Editor"
              onClick={() => setMainMode('editor')}
            >
              <FileText size={13} />
              <span>Editor</span>
            </button>
            <button
              className={`view-mode-btn ${mainMode === 'views' ? 'active' : ''}`}
              data-testid="main-mode-views"
              title="Database Views"
              onClick={() => setMainMode('views')}
            >
              <LayoutGrid size={13} />
              <span>Views</span>
            </button>
          </div>

          {/* Compact View Mode Dropdown */}
          {mainMode === 'editor' && (
            <div style={{ position: 'relative' }} ref={viewModeMenuRef}>
              <button
                className="view-mode-btn"
                data-testid="view-mode-menu-trigger"
                data-tour="view-mode-menu"
                onClick={() => setIsViewModeMenuOpen((prev) => !prev)}
                title={`View Layout: ${viewMode.toUpperCase()} (Ctrl+E to cycle)`}
                style={{ padding: '0 8px', gap: '5px' }}
              >
                {viewMode === 'editor' && <BookOpen size={13} />}
                {viewMode === 'split' && <Columns size={13} />}
                {viewMode === 'preview' && <Eye size={13} />}
                <span style={{ fontSize: '12px', textTransform: 'capitalize' }}>{viewMode}</span>
                <ChevronDown size={11} style={{ opacity: 0.6 }} />
              </button>

              {isViewModeMenuOpen && (
                <div
                  className="dropdown-menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    zIndex: 105,
                    minWidth: '130px',
                  }}
                >
                  <button
                    className={`dropdown-item view-mode-btn ${viewMode === 'editor' ? 'active' : ''}`}
                    data-testid="view-mode-editor"
                    title="Editor View"
                    onClick={() => {
                      setViewMode('editor');
                      setIsViewModeMenuOpen(false);
                    }}
                  >
                    <BookOpen size={13} />
                    <span>Editor</span>
                  </button>
                  <button
                    className={`dropdown-item view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
                    data-testid="view-mode-split"
                    title="Split View"
                    onClick={() => {
                      setViewMode('split');
                      setIsViewModeMenuOpen(false);
                    }}
                  >
                    <Columns size={13} />
                    <span>Split</span>
                  </button>
                  <button
                    className={`dropdown-item view-mode-btn ${viewMode === 'preview' ? 'active' : ''}`}
                    data-testid="view-mode-preview"
                    title="Preview View"
                    onClick={() => {
                      setViewMode('preview');
                      setIsViewModeMenuOpen(false);
                    }}
                  >
                    <Eye size={13} />
                    <span>Preview</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className={`btn-icon ${showRightPanel === 'ai' ? 'active' : ''}`}
            data-testid="toggle-ai"
            data-tour="ai-tab"
            title="Toggle AI Assistant"
            onClick={() => setShowRightPanel((prev) => (prev === 'ai' ? null : 'ai'))}
          >
            <Bot size={15} />
          </button>

          <button
            className={`btn-icon ${showRightPanel && showRightPanel !== 'ai' ? 'active' : ''}`}
            data-testid="toggle-inspector"
            data-tour="inspector"
            title="Toggle Inspector"
            onClick={() => setShowRightPanel((prev) => (prev && prev !== 'ai' ? null : 'outline'))}
          >
            <ListTree size={15} />
          </button>

          {/* More Actions Dropdown */}
          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              className={`btn-icon ${isMoreMenuOpen ? 'active' : ''}`}
              data-testid="more-menu"
              data-tour="more-menu"
              title="More Actions"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            >
              <MoreHorizontal size={15} />
            </button>

            {isMoreMenuOpen && (
              <div className="more-menu-popover">
                <button
                  className="more-menu-item"
                  data-tour="graph-button"
                  onClick={() => {
                    setIsGlobalGraphOpen(true);
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <Share2 size={14} />
                  <span>Global Graph View</span>
                  <kbd>Ctrl+G</kbd>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    openLearnCenter();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <GraduationCap size={14} />
                  <span>Learn OpenOb</span>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    openShortcuts();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <Keyboard size={14} />
                  <span>Keyboard Shortcuts</span>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    setIsPluginModalOpen(true);
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <Boxes size={14} />
                  <span>Plugin Manager</span>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    setIsGatewayModalOpen(true);
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <Server size={14} />
                  <span>{vaultMode === 'gateway' ? 'Gateway Settings' : 'Connect to Gateway'}</span>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    void openDirectoryVault();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <FolderOpen size={14} />
                  <span>Open Folder from Disk</span>
                </button>
                <button
                  className="more-menu-item"
                  onClick={() => {
                    setIsAboutOpen(true);
                    setIsMoreMenuOpen(false);
                  }}
                >
                  <Info size={14} />
                  <span>About OpenOb</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!atomicWrites && (
        <div
          className="degraded-atomicity-banner"
          style={{
            background: 'var(--status-warning, #f59e0b)',
            color: '#0d0f12',
            padding: '4px 16px',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={14} />
          <span>
            Atomic replacement guarantee unavailable in this browser — saves will write directly to
            open file.
          </span>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="workspace-body">
        {/* Left Sidebar: File Tree */}
        {showSidebar && (
          <aside className="workspace-sidebar" data-tour="sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Files</span>
              <div className="sidebar-header-actions">
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  data-tour="new-note"
                  title="New Note (Ctrl+N)"
                  onClick={() => void createNote()}
                >
                  <FilePlus size={13} />
                </button>
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  data-tour="new-folder"
                  title="New Folder"
                  onClick={() => void createFolder()}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  title="Refresh & Rebuild Index"
                  onClick={() => void refreshVault()}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            <FileTree
              entries={entries}
              activePath={activeTabPath}
              onSelect={(path) => {
                setMainMode('editor');
                if (viewMode === 'preview') setViewMode('split');
                void openNote(path);
              }}
              onCreateNote={(name) => void createNote(name)}
              onCreateFolder={(folder) => void createFolder(folder)}
              onRename={(oldPath, newPath) => void renameNote(oldPath, newPath)}
              onDelete={(path) => void deletePath(path)}
            />
          </aside>
        )}

        {/* Central Area: Tab Bar + Editor & Preview OR Database Views */}
        <main className="editor-area">
          {mainMode === 'views' ? (
            <ViewContainer
              backend={backend}
              refreshKey={eventRefreshCounter}
              onNavigate={(path) => {
                setMainMode('editor');
                if (viewMode === 'preview') setViewMode('split');
                void openNote(path);
              }}
            />
          ) : (
            <>
              <div data-tour="tab-bar">
                <TabBar
                  tabs={openTabs}
                  activePath={activeTabPath}
                  onSelect={(path) => void openNote(path)}
                  onClose={(path) => closeTab(path)}
                />
              </div>

              <div className="content-split">
                {activeTab ? (
                  <>
                    {(viewMode === 'editor' || viewMode === 'split') && (
                      <div className="editor-container" data-tour="editor">
                        <Editor
                          key={activeTab.path}
                          content={activeTab.content}
                          onChange={(val) => updateContent(activeTab.path, val)}
                          onSave={() => void saveActiveNote()}
                          onCommandPalette={() => setIsCommandPaletteOpen(true)}
                          onNavigateWikilink={handleNavigateWikilink}
                        />
                      </div>
                    )}

                    {(viewMode === 'preview' || viewMode === 'split') && (
                      <PreviewPane
                        document={parsedDoc}
                        onNavigateWikilink={handleNavigateWikilink}
                        onToggleTask={toggleTask}
                      />
                    )}
                  </>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      gap: '16px',
                    }}
                  >
                    <BookOpen size={40} style={{ opacity: 0.25, strokeWidth: 1.5 }} />
                    <div style={{ textAlign: 'center' }}>
                      <p
                        style={{
                          fontSize: '15px',
                          fontWeight: 500,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        No document open
                      </p>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Create a note or select one from the sidebar
                      </p>
                    </div>
                    <button className="btn btn-primary" onClick={() => void createNote()}>
                      <FilePlus size={14} /> Create Note
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </main>

        {/* Right Rail: Unified Inspector Shell */}
        {showRightPanel && (
          <aside className="inspector-rail" data-tour="inspector">
            <div className="inspector-header">
              <div className="inspector-tabs" data-tour="inspector-tabs">
                <button
                  className={`inspector-tab ${showRightPanel === 'outline' ? 'active' : ''}`}
                  data-tour="outline-tab"
                  onClick={() => setShowRightPanel('outline')}
                >
                  Outline
                </button>
                <button
                  className={`inspector-tab ${showRightPanel === 'backlinks' ? 'active' : ''}`}
                  data-tour="backlinks-tab"
                  onClick={() => setShowRightPanel('backlinks')}
                >
                  Backlinks
                </button>
                <button
                  className={`inspector-tab ${showRightPanel === 'properties' ? 'active' : ''}`}
                  data-tour="properties-tab"
                  onClick={() => setShowRightPanel('properties')}
                >
                  Properties
                </button>
                <button
                  className={`inspector-tab ${showRightPanel === 'ai' ? 'active' : ''}`}
                  data-tour="ai-tab"
                  onClick={() => setShowRightPanel('ai')}
                >
                  AI
                </button>
                <button
                  className={`inspector-tab ${showRightPanel === 'graph' ? 'active' : ''}`}
                  onClick={() => setShowRightPanel('graph')}
                >
                  Graph
                </button>
              </div>
              <button
                className="btn-icon"
                style={{ width: '22px', height: '22px' }}
                onClick={() => setShowRightPanel(null)}
                title="Close Inspector"
              >
                <X size={13} />
              </button>
            </div>

            <div className="inspector-body">
              {showRightPanel === 'outline' && parsedDoc && (
                <OutlinePanel headings={parsedDoc.headings} onSelectHeading={handleSelectHeading} />
              )}

              {showRightPanel === 'backlinks' && activeTab && (
                <BacklinksPanel
                  backlinks={backlinks}
                  parsedDoc={parsedDoc}
                  index={index}
                  onNavigate={(path) => {
                    setMainMode('editor');
                    void openNote(path);
                  }}
                  onCreateNote={(name) => void createNote(name)}
                />
              )}

              {showRightPanel === 'graph' && (
                <div style={{ width: '100%', height: '100%', minHeight: '300px' }}>
                  <GraphView
                    index={index}
                    activeNotePath={activeTabPath}
                    refreshKey={
                      activeTab?.initialSnapshot?.version.hash ||
                      activeTab?.initialSnapshot?.version.token
                    }
                    isLocal={true}
                    onNavigate={(path) => {
                      setMainMode('editor');
                      void openNote(path);
                    }}
                  />
                </div>
              )}

              {showRightPanel === 'properties' && (
                <PropertiesPanel
                  parsedDoc={parsedDoc}
                  allTags={allTags}
                  onSelectTag={(tag) => {
                    setSelectedSearchTag(tag);
                    setIsSearchModalOpen(true);
                  }}
                  onUpdateProperties={(newProps) => {
                    if (activeTab) {
                      const updated = updateDocumentFrontmatter(activeTab.content, newProps);
                      updateContent(activeTab.path, updated);
                    }
                  }}
                />
              )}

              {showRightPanel === 'ai' && (
                <AIChatDrawer
                  aiBackend={aiBackend}
                  workspaceBackend={backend}
                  activeNotePath={activeTabPath}
                  activeNoteContent={activeTab?.content}
                  activeNoteVersion={
                    activeTab?.initialSnapshot?.version
                      ? {
                          token: activeTab.initialSnapshot.version.token,
                          hash: activeTab.initialSnapshot.version.hash,
                          modifiedAt: activeTab.initialSnapshot.version.modifiedAt,
                          size: activeTab.initialSnapshot.version.size,
                        }
                      : undefined
                  }
                  onNavigate={(path) => {
                    setMainMode('editor');
                    void openNote(path);
                  }}
                  onApplyProposedEdit={handleApplyProposedEdit}
                  onClose={() => setShowRightPanel(null)}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        vaultName={vaultName}
        vaultMode={vaultMode}
        isReadOnly={isReadOnly}
        gatewayReachable={gatewayReachable}
        activePath={activeTabPath}
        parsedDoc={parsedDoc}
        saveStatus={saveStatus}
        onSave={() => void saveActiveNote()}
        onOpenConflictModal={() => {}}
        onOpenGatewayModal={() => setIsGatewayModalOpen(true)}
      />

      {/* Global Full-Screen Graph Modal */}
      {isGlobalGraphOpen && (
        <div className="modal-overlay" onClick={() => setIsGlobalGraphOpen(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '92vw',
              maxWidth: '1200px',
              height: '85vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
            }}
          >
            <GraphView
              index={index}
              activeNotePath={activeTabPath}
              refreshKey={
                activeTab?.initialSnapshot?.version.hash ||
                activeTab?.initialSnapshot?.version.token
              }
              isLocal={false}
              onNavigate={(path) => {
                setMainMode('editor');
                void openNote(path);
                setIsGlobalGraphOpen(false);
              }}
              onClose={() => setIsGlobalGraphOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Conflict Resolution Modal */}
      {conflictData && activeTab && (
        <ConflictModal
          path={conflictData.path}
          diskContent={conflictData.diskContent}
          myContent={activeTab.content}
          onReload={resolveConflictReload}
          onForceOverwrite={() => void saveActiveNote(true)}
          onClose={dismissConflict}
        />
      )}

      {/* Quick Open Command Palette (Ctrl+P) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        entries={entries}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenNote={(path) => {
          setMainMode('editor');
          void openNote(path);
        }}
        onCreateNote={() => void createNote()}
        onCreateFolder={() => void createFolder()}
        onRefresh={() => void refreshVault()}
      />

      {/* Global Search Modal (Ctrl+Shift+F) */}
      <SearchModal
        isOpen={isSearchModalOpen}
        initialTag={selectedSearchTag}
        onClose={() => {
          setIsSearchModalOpen(false);
          setSelectedSearchTag(null);
        }}
        onSelectResult={(path: VaultPath) => {
          setMainMode('editor');
          void openNote(path);
        }}
        index={index}
        searchFn={async (query: string, tag?: string | null) => {
          if (vaultMode === 'gateway') {
            const res = await backend.search({
              query: query || '',
              tags: tag ? [tag] : undefined,
              limit: 20,
            });
            return res.matches.map((r) => ({
              documentId: r.path,
              path: r.path,
              title: r.title,
              score: r.score,
              source: (r.source as any) || 'fts',
              excerpt: r.matchSnippet,
            }));
          }
          const scope = tag ? { tags: [tag] } : undefined;
          return index.query({ query: query || tag || '', scope, limit: 20 });
        }}
      />

      {/* Gateway Connection Modal */}
      <GatewayConnectModal
        isOpen={isGatewayModalOpen}
        currentUrl={gatewayUrl || 'http://127.0.0.1:4200'}
        isConnected={vaultMode === 'gateway'}
        onConnect={connectToGateway}
        onDisconnect={disconnectGateway}
        onClose={() => setIsGatewayModalOpen(false)}
      />

      {/* Plugin Manager Modal (Constitution Law 20) */}
      <PluginManagerModal
        isOpen={isPluginModalOpen}
        pluginHost={pluginHost}
        onClose={() => setIsPluginModalOpen(false)}
        onRefresh={() => {}}
      />

      {/* Onboarding Welcome Dialog (First Run) */}
      <WelcomeModal isOpen={isWelcomeOpen} onStartTour={startQuickTour} onSkip={skipFirstRun} />

      {/* Guided Tour Spotlight Overlay */}
      <TourOverlay
        chapter={activeChapter}
        stepIndex={currentStepIndex}
        onNext={nextStep}
        onPrev={prevStep}
        onSkip={skipTour}
        onFinish={finishTour}
      />

      {/* Learn Center Modal (Help & Tutorials) */}
      <LearnCenterModal
        isOpen={isLearnCenterOpen}
        completedChapters={onboardingState.completedChapters}
        quickTourCompleted={onboardingState.quickTourCompleted}
        onStartChapter={startChapter}
        onResetProgress={resetProgress}
        onClose={closeLearnCenter}
      />

      {/* Keyboard Shortcuts Cheat Sheet */}
      <KeyboardShortcutsModal isOpen={isShortcutsOpen} onClose={closeShortcuts} />

      {/* About OpenOb Modal */}
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
    </div>
  );
};
