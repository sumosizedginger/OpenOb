import React, { useState, useEffect } from 'react';
import { useVault } from './hooks/useVault.js';
import { FileTree } from './components/FileTree.js';
import { Editor } from './components/Editor.js';
import { TabBar } from './components/TabBar.js';
import { PreviewPane } from './components/PreviewPane.js';
import { BacklinksPanel } from './components/BacklinksPanel.js';
import { OutlinePanel } from './components/OutlinePanel.js';
import { SearchModal } from './components/SearchModal.js';
import { StatusBar } from './components/StatusBar.js';
import { ConflictModal } from './components/ConflictModal.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ParsedHeading } from '@okw/core';
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
  const [showRightPanel, setShowRightPanel] = useState<'backlinks' | 'outline' | null>('outline');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

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
        setIsSearchModalOpen((prev) => !prev);
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

      // Ctrl/Cmd+W: Close active tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        if (activeTabPath) {
          e.preventDefault();
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

  // Navigate wikilink clicked inside preview
  const handleNavigateWikilink = async (target: string) => {
    const resolution = index.resolveLink(activeTabPath || '', target);
    if (resolution && resolution.resolved && resolution.targetPath) {
      await openNote(resolution.targetPath);
    } else {
      await createNote(target);
    }
  };

  // Jump to heading in preview / document
  const handleSelectHeading = (heading: ParsedHeading) => {
    const headingElem = document.getElementById(`heading-${heading.line}`);
    if (headingElem) {
      headingElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <header className="top-bar">
        <div className="top-bar-left">
          <button
            className="btn-icon"
            onClick={() => setShowSidebar((prev) => !prev)}
            title="Toggle Left Sidebar (Ctrl+B)"
          >
            {showSidebar ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>

          <div className="app-brand">
            <BookOpen size={18} />
            <span>Open Knowledge Workspace</span>
          </div>

          <div className="vault-badge" title="Active local vault">
            <ShieldCheck size={13} color="var(--status-success)" />
            <span>{vaultName}</span>
          </div>

          <button
            className="btn"
            onClick={openDirectoryVault}
            title="Open a local folder on your computer as a vault (File System Access API)"
          >
            <FolderOpen size={13} /> Open Folder Vault
          </button>
        </div>

        <div className="top-bar-actions">
          <button
            className="btn"
            onClick={() => setIsCommandPaletteOpen(true)}
            title="Quick Open Notes (Ctrl+P)"
          >
            <Search size={13} /> Quick Open <span className="command-badge">Ctrl+P</span>
          </button>

          <button
            className="btn"
            onClick={() => setIsSearchModalOpen(true)}
            title="Global Vault Search (Ctrl+Shift+F)"
          >
            <Search size={13} color="var(--accent-primary)" /> Search <span className="command-badge">Ctrl+Shift+F</span>
          </button>

          <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '2px', background: 'var(--bg-secondary)' }}>
            <button
              className={`btn-icon ${viewMode === 'editor' ? 'active' : ''}`}
              title="Editor Only (Ctrl+E)"
              onClick={() => setViewMode('editor')}
            >
              <Eye size={14} />
            </button>
            <button
              className={`btn-icon ${viewMode === 'split' ? 'active' : ''}`}
              title="Split View: Editor + Live Preview (Ctrl+\)"
              onClick={() => setViewMode('split')}
            >
              <Columns size={14} />
            </button>
            <button
              className={`btn-icon ${viewMode === 'preview' ? 'active' : ''}`}
              title="Live Preview Only"
              onClick={() => setViewMode('preview')}
            >
              <BookOpen size={14} />
            </button>
          </div>

          <button
            className={`btn-icon ${showRightPanel === 'outline' ? 'active' : ''}`}
            title="Toggle Outline Panel"
            onClick={() => setShowRightPanel((prev) => (prev === 'outline' ? null : 'outline'))}
          >
            <ListTree size={14} />
          </button>

          <button
            className={`btn-icon ${showRightPanel === 'backlinks' ? 'active' : ''}`}
            title="Toggle Backlinks Panel"
            onClick={() => setShowRightPanel((prev) => (prev === 'backlinks' ? null : 'backlinks'))}
          >
            <Link2 size={14} />
          </button>

          <button
            className="btn btn-primary"
            onClick={() => saveActiveNote()}
            title="Safe Save (Ctrl+S)"
          >
            Save Note
          </button>
        </div>
      </header>

      {/* Main Workspace Split */}
      <div className="main-workspace">
        {/* Left Sidebar: File Tree */}
        {showSidebar && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Files & Folders</span>
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

        {/* Right Rail: Outline or Backlinks */}
        {showRightPanel === 'outline' && parsedDoc && (
          <OutlinePanel
            headings={parsedDoc.headings}
            onSelectHeading={handleSelectHeading}
          />
        )}

        {showRightPanel === 'backlinks' && activeTab && (
          <BacklinksPanel
            backlinks={backlinks}
            onNavigate={(path) => openNote(path)}
          />
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

      {/* Global Vault Search Modal (Ctrl+Shift+F) */}
      <SearchModal
        isOpen={isSearchModalOpen}
        index={index}
        onClose={() => setIsSearchModalOpen(false)}
        onSelectResult={(path) => openNote(path)}
      />
    </div>
  );
};
