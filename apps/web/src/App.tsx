import React, { useState, useEffect } from 'react';
import { useVault } from './hooks/useVault.js';
import { FileTree } from './components/FileTree.js';
import { Editor } from './components/Editor.js';
import { TabBar } from './components/TabBar.js';
import { PreviewPane } from './components/PreviewPane.js';
import { BacklinksPanel } from './components/BacklinksPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { ConflictModal } from './components/ConflictModal.js';
import { CommandPalette } from './components/CommandPalette.js';
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
  const [showBacklinks, setShowBacklinks] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global keyboard shortcuts (Ctrl+P / Cmd+P, Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveNote]);

  // Navigate wikilink clicked inside preview
  const handleNavigateWikilink = async (target: string) => {
    const resolution = (index as any).linkResolver?.resolve(activeTabPath || '', target);
    if (resolution && resolution.resolved && resolution.targetPath) {
      await openNote(resolution.targetPath);
    } else {
      await createNote();
    }
  };

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <header className="top-bar">
        <div className="top-bar-left">
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
            title="Quick Open / Command Palette (Ctrl+P)"
          >
            <Search size={13} /> Quick Open <span className="command-badge">Ctrl+P</span>
          </button>

          <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '2px', background: 'var(--bg-secondary)' }}>
            <button
              className={`btn-icon ${viewMode === 'editor' ? 'active' : ''}`}
              title="Editor Only"
              onClick={() => setViewMode('editor')}
            >
              <Eye size={14} />
            </button>
            <button
              className={`btn-icon ${viewMode === 'split' ? 'active' : ''}`}
              title="Split View (Editor + Live Preview)"
              onClick={() => setViewMode('split')}
            >
              <Columns size={14} />
            </button>
            <button
              className={`btn-icon ${viewMode === 'preview' ? 'active' : ''}`}
              title="Preview Only"
              onClick={() => setViewMode('preview')}
            >
              <BookOpen size={14} />
            </button>
          </div>

          <button
            className={`btn-icon ${showBacklinks ? 'active' : ''}`}
            title="Toggle Backlinks Panel"
            onClick={() => setShowBacklinks((prev) => !prev)}
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

      {/* Main Workspace */}
      <div className="main-workspace">
        {/* Left Sidebar: File Tree */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Files & Folders</span>
            <div className="sidebar-header-actions">
              <button
                className="btn-icon"
                title="New Note"
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
                      content={activeTab.content}
                      onChange={updateContent}
                      onSave={() => saveActiveNote()}
                      onCommandPalette={() => setIsCommandPaletteOpen(true)}
                    />
                  </div>
                )}

                {(viewMode === 'preview' || viewMode === 'split') && (
                  <PreviewPane
                    document={parsedDoc}
                    onNavigateWikilink={handleNavigateWikilink}
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

        {/* Right Sidebar: Backlinks */}
        {showBacklinks && activeTab && (
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

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        entries={entries}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenNote={(path) => openNote(path)}
        onCreateNote={() => createNote()}
        onCreateFolder={() => createFolder()}
        onRefresh={() => refreshVault()}
      />
    </div>
  );
};
