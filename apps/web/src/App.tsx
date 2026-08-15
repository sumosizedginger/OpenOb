import React, { useState, useEffect } from 'react';
import { useVault } from './hooks/useVault.js';
import { FileTree } from './components/FileTree.js';
import { Editor } from './components/Editor.js';
import { TabBar } from './components/TabBar.js';
import { PreviewPane } from './components/PreviewPane.js';
import { BacklinksPanel } from './components/BacklinksPanel.js';
import { OutlinePanel } from './components/OutlinePanel.js';
import { GraphView } from './components/GraphView.js';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { SearchModal } from './components/SearchModal.js';
import { StatusBar } from './components/StatusBar.js';
import { ConflictModal } from './components/ConflictModal.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ParsedHeading, VaultPath } from '@okw/core';
import { updateDocumentFrontmatter } from '@okw/markdown';
import {
  FolderPlus,
  FilePlus,
  BookOpen,
  Eye,
  Columns,
  Search,
  RefreshCw,
  FolderOpen,
  ShieldCheck,
  Link2,
  ListTree,
  PanelLeftClose,
  PanelLeft,
  Share2,
  Sliders,
} from 'lucide-react';

export const App: React.FC = () => {
  const {
    vaultName,
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
    dismissConflict,
    resolveConflictReload,
  } = useVault();

  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState<
    'backlinks' | 'outline' | 'graph' | 'properties' | null
  >('outline');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [selectedSearchTag, setSelectedSearchTag] = useState<string | null>(null);
  const [isGlobalGraphOpen, setIsGlobalGraphOpen] = useState(false);
  const [allTags, setAllTags] = useState<Map<string, number>>(new Map());

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
    aggregateTags();
    return () => {
      isMounted = false;
    };
  }, [index, activeTab?.initialSnapshot?.version.hash]);

  // Global window keyboard shortcuts for Phase 2 Workspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInsideEditor = (e.target as HTMLElement)?.closest?.('.cm-editor');

      // Ctrl/Cmd+P: Quick Open / Command Palette
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        if (!isInsideEditor) {
          e.preventDefault();
          setIsCommandPaletteOpen((prev) => !prev);
        }
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
        setViewMode((prev) => (prev === 'split' ? 'editor' : prev === 'editor' ? 'preview' : 'split'));
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
          saveActiveNote();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveNote, activeTabPath, closeTab]);

  // P5-2: Restored heading navigation in preview and editor (matching heading-line IDs)
  const handleSelectHeading = (heading: ParsedHeading) => {
    if (viewMode === 'editor') {
      setViewMode('split');
    }
    setTimeout(() => {
      const headingEl =
        document.getElementById(`heading-${heading.line}`) ||
        document.getElementById(heading.slug);
      if (headingEl) {
        headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  const handleNavigateWikilink = (target: string) => {
    if (!activeTabPath) return;
    const res = index.resolveLink(activeTabPath, target);
    if (res.resolved && res.targetPath) {
      openNote(res.targetPath);
    } else {
      const cleanName = target.split('#')[0].split('|')[0].trim();
      if (confirm(`Note "${cleanName}" does not exist. Would you like to create it?`)) {
        createNote(cleanName);
      }
    }
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
            {showSidebar ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
          <div className="app-logo">
            <ShieldCheck size={18} className="logo-icon" />
            <span className="logo-text">OpenOb</span>
          </div>
          <span className="vault-badge">{vaultName}</span>
        </div>

        <div className="header-center">
          <button
            className="search-trigger-btn"
            onClick={() => {
              setSelectedSearchTag(null);
              setIsCommandPaletteOpen(true);
            }}
            title="Quick Open (Ctrl+P)"
          >
            <Search size={14} />
            <span>Search or jump to note...</span>
            <kbd>Ctrl+P</kbd>
          </button>
        </div>

        <div className="header-right">
          <button
            className={`btn-icon ${isGlobalGraphOpen ? 'active' : ''}`}
            title="Graph View (Ctrl+G)"
            onClick={() => setIsGlobalGraphOpen((prev) => !prev)}
          >
            <Share2 size={15} />
          </button>

          <button
            className="btn-icon"
            title="Open Directory from Disk"
            onClick={openDirectoryVault}
          >
            <FolderOpen size={16} />
          </button>

          <div className="view-mode-group">
            <button
              className={`view-mode-btn ${viewMode === 'editor' ? 'active' : ''}`}
              title="Editor View"
              onClick={() => setViewMode('editor')}
            >
              <BookOpen size={14} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
              title="Split View (Ctrl+\)"
              onClick={() => setViewMode('split')}
            >
              <Columns size={14} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'preview' ? 'active' : ''}`}
              title="Preview View"
              onClick={() => setViewMode('preview')}
            >
              <Eye size={14} />
            </button>
          </div>

          <div className="right-panel-toggles">
            <button
              className={`btn-icon ${showRightPanel === 'outline' ? 'active' : ''}`}
              title="Toggle Outline"
              onClick={() =>
                setShowRightPanel((prev) => (prev === 'outline' ? null : 'outline'))
              }
            >
              <ListTree size={16} />
            </button>
            <button
              className={`btn-icon ${showRightPanel === 'backlinks' ? 'active' : ''}`}
              title="Toggle Backlinks"
              onClick={() =>
                setShowRightPanel((prev) => (prev === 'backlinks' ? null : 'backlinks'))
              }
            >
              <Link2 size={16} />
            </button>
            <button
              className={`btn-icon ${showRightPanel === 'graph' ? 'active' : ''}`}
              title="Toggle Local Graph"
              onClick={() =>
                setShowRightPanel((prev) => (prev === 'graph' ? null : 'graph'))
              }
            >
              <Share2 size={15} />
            </button>
            <button
              className={`btn-icon ${showRightPanel === 'properties' ? 'active' : ''}`}
              title="Toggle Properties & Tags"
              onClick={() =>
                setShowRightPanel((prev) => (prev === 'properties' ? null : 'properties'))
              }
            >
              <Sliders size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="workspace-body">
        {/* Left Sidebar: File Tree */}
        {showSidebar && (
          <aside className="workspace-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Files</span>
              <div className="sidebar-header-actions">
                <button
                  className="btn-icon"
                  title="New Note (Ctrl+N)"
                  onClick={() => createNote()}
                >
                  <FilePlus size={14} />
                </button>
                <button
                  className="btn-icon"
                  title="New Folder"
                  onClick={() => createFolder()}
                >
                  <FolderPlus size={14} />
                </button>
                <button
                  className="btn-icon"
                  title="Refresh & Rebuild Index"
                  onClick={() => refreshVault()}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>

            <FileTree
              entries={entries}
              activePath={activeTabPath}
              onSelect={openNote}
              onCreateNote={createNote}
              onCreateFolder={createFolder}
              onRename={renameNote}
              onDelete={deletePath}
            />
          </aside>
        )}

        {/* Central Area: Tab Bar + Editor & Preview */}
        <main className="editor-area">
          <TabBar
            tabs={openTabs}
            activePath={activeTabPath}
            onSelect={(path) => openNote(path)}
            onClose={(path) => closeTab(path)}
          />

          <div className="content-split">
            {activeTab ? (
              <>
                {(viewMode === 'editor' || viewMode === 'split') && (
                  <div className="editor-container">
                    <Editor
                      key={activeTab.path}
                      content={activeTab.content}
                      onChange={(val) => updateContent(activeTab.path, val)}
                      onSave={() => saveActiveNote()}
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
                  gap: '12px',
                }}
              >
                <BookOpen size={36} style={{ opacity: 0.3 }} />
                <p>No document open</p>
                <button className="btn btn-primary" onClick={() => createNote()}>
                  <FilePlus size={13} /> Create Note
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Right Rail: Outline, Backlinks, Local Graph, or Properties */}
        {showRightPanel === 'outline' && parsedDoc && (
          <OutlinePanel
            headings={parsedDoc.headings}
            onSelectHeading={handleSelectHeading}
          />
        )}

        {showRightPanel === 'backlinks' && activeTab && (
          <BacklinksPanel
            backlinks={backlinks}
            parsedDoc={parsedDoc}
            index={index}
            onNavigate={(path) => openNote(path)}
            onCreateNote={(name) => createNote(name)}
          />
        )}

        {showRightPanel === 'graph' && (
          <div style={{ width: '320px', height: '100%' }}>
            <GraphView
              index={index}
              activeNotePath={activeTabPath}
              refreshKey={activeTab?.initialSnapshot?.version.hash || activeTab?.initialSnapshot?.version.token}
              isLocal={true}
              onNavigate={(path) => openNote(path)}
            />
          </div>
        )}

        {showRightPanel === 'properties' && (
          <div style={{ width: '300px', height: '100%' }}>
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
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        vaultName={vaultName}
        activePath={activeTabPath}
        parsedDoc={parsedDoc}
        saveStatus={saveStatus}
        onSave={() => saveActiveNote()}
        onOpenConflictModal={() => {}}
      />

      {/* Global Full-Screen Graph Modal */}
      {isGlobalGraphOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-in fade-in duration-150">
          <div className="relative w-full max-w-6xl h-[85vh] bg-slate-950 rounded-xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col">
            <GraphView
              index={index}
              activeNotePath={activeTabPath}
              refreshKey={activeTab?.initialSnapshot?.version.hash || activeTab?.initialSnapshot?.version.token}
              isLocal={false}
              onNavigate={(path) => {
                openNote(path);
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
          onForceOverwrite={() => saveActiveNote(true)}
          onClose={dismissConflict}
        />
      )}

      {/* Quick Open Command Palette (Ctrl+P) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        entries={entries}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenNote={(path) => openNote(path)}
        onCreateNote={() => createNote()}
        onCreateFolder={() => createFolder()}
        onRefresh={() => refreshVault()}
      />

      {/* Global Search Modal (Ctrl+Shift+F) */}
      <SearchModal
        isOpen={isSearchModalOpen}
        initialTag={selectedSearchTag}
        onClose={() => {
          setIsSearchModalOpen(false);
          setSelectedSearchTag(null);
        }}
        onSelectResult={(path: VaultPath) => openNote(path)}
        index={index}
      />
    </div>
  );
};
