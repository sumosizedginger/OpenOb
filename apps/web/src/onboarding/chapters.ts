/**
 * apps/web/src/onboarding/chapters.ts
 * Tutorial chapters and step definitions for OpenOb Guided Onboarding & Learn Center.
 */

import { TOUR_TARGETS } from './targets.js';
import { TourChapter } from './types.js';

export const QUICK_TOUR_CHAPTER: TourChapter = {
  id: 'quick-tour',
  title: 'Quick Tour',
  category: 'getting-started',
  description: 'The 5-minute interactive tour through OpenOb’s core workflow.',
  estimatedMinutes: 5,
  steps: [
    {
      id: 'qt-welcome',
      target: TOUR_TARGETS.APP_LOGO,
      title: 'Welcome to OpenOb',
      content:
        'OpenOb is a local-first workspace for your thoughts and knowledge. Your notes remain ordinary, human-readable Markdown files stored right on your computer.',
      placement: 'bottom',
    },
    {
      id: 'qt-sidebar',
      target: TOUR_TARGETS.SIDEBAR,
      title: 'Your Vault Files',
      content:
        'The sidebar displays all Markdown files and folders inside your vault. You can navigate, organize, and open notes with a single click.',
      prepareActionId: 'open-sidebar',
      placement: 'right',
    },
    {
      id: 'qt-create',
      target: TOUR_TARGETS.NEW_NOTE,
      title: 'Create & Organize',
      content:
        'Click here or press Ctrl+N anytime to create a new note. You can also organize your notes into structured subfolders.',
      shortcut: 'Ctrl+N',
      placement: 'right',
    },
    {
      id: 'qt-tabs',
      target: TOUR_TARGETS.TAB_BAR,
      title: 'Multi-Tab Workspace',
      content:
        'Keep multiple notes open simultaneously. A small indicator shows when a tab has unsaved changes in progress.',
      placement: 'bottom',
    },
    {
      id: 'qt-editor',
      target: TOUR_TARGETS.EDITOR,
      title: 'Fast Markdown Editor',
      content:
        'Write naturally in full CommonMark and GFM. OpenOb automatically tracks links, tags, and properties, and safely saves your work with deterministic versioning.',
      prepareActionId: 'mode-editor',
      placement: 'bottom',
    },
    {
      id: 'qt-view-mode',
      target: TOUR_TARGETS.VIEW_MODE_MENU,
      title: 'Editor, Split & Preview',
      content:
        'Switch seamlessly between raw Markdown Editor, Split View with side-by-side live rendering, and clean Reader Preview.',
      shortcut: 'Ctrl+E',
      placement: 'bottom',
    },
    {
      id: 'qt-search',
      target: TOUR_TARGETS.SEARCH_BUTTON,
      title: 'Instant Search & Quick Open',
      content:
        'Press Ctrl+P to jump to any note instantly by title or path, or run full-text and tag searches across your entire vault in milliseconds.',
      shortcut: 'Ctrl+P',
      placement: 'bottom',
    },
    {
      id: 'qt-inspector',
      target: TOUR_TARGETS.INSPECTOR,
      title: 'Contextual Inspector',
      content:
        'The right panel contains tools for the active note: Document Outline, Incoming Backlinks, YAML Frontmatter Properties, and Grounded AI.',
      prepareActionId: 'open-inspector',
      placement: 'left',
    },
    {
      id: 'qt-views',
      target: TOUR_TARGETS.VIEWS_SWITCH,
      title: 'Database Views',
      content:
        'View your notes as structured Tables, Kanban Boards, or Lists. Frontmatter properties become editable fields without ever leaving Markdown.',
      placement: 'bottom',
    },
    {
      id: 'qt-graph',
      target: TOUR_TARGETS.GRAPH_BUTTON,
      title: 'Interactive Knowledge Graph',
      content:
        'Visualize connections between your notes. [[Wikilinks]] automatically turn into an interactive 2D graph that shows how your ideas interlink.',
      shortcut: 'Ctrl+G',
      placement: 'bottom',
    },
    {
      id: 'qt-ai',
      target: TOUR_TARGETS.AI_TAB,
      title: 'Grounded Assistive AI',
      content:
        'Ask questions grounded strictly in your vault notes. OpenOb supports local models (Ollama, LM Studio) and cloud keys (OpenAI, Anthropic, Gemini). AI proposes edits—it never silently overwrites your work.',
      prepareActionId: 'tab-ai',
      placement: 'left',
    },
    {
      id: 'qt-plugins',
      target: TOUR_TARGETS.MORE_MENU,
      title: 'Plugins & Settings',
      content:
        'Access first-party plugins like Daily Notes, Templates, and Word Count under More. OpenOb enforces strict capability permissions.',
      placement: 'bottom',
    },
    {
      id: 'qt-finish',
      target: TOUR_TARGETS.APP_LOGO,
      title: 'You’re Ready to Write',
      content:
        'You have everything you need to start building your knowledge base. You can explore in-depth chapters anytime from More → Learn OpenOb.',
      placement: 'bottom',
      isFinalStep: true,
    },
  ],
};

export const LEARN_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'getting-started',
    title: 'Getting Started & Vault Basics',
    category: 'getting-started',
    description: 'Learn the local-first vault concept, folder organization, and tab navigation.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'gs-vault-concept',
        target: TOUR_TARGETS.APP_LOGO,
        title: 'The Vault Concept',
        content:
          'In OpenOb, a "vault" is simply a standard folder on your disk containing plain UTF-8 Markdown files. There is no proprietary database lock-in.',
        placement: 'bottom',
      },
      {
        id: 'gs-sidebar-tree',
        target: TOUR_TARGETS.SIDEBAR,
        title: 'Sidebar & File Navigation',
        content:
          'Your directory hierarchy is reflected live in the sidebar. External changes made by other editors or tools update here immediately.',
        prepareActionId: 'open-sidebar',
        placement: 'right',
      },
      {
        id: 'gs-create-actions',
        target: TOUR_TARGETS.NEW_NOTE,
        title: 'Creating Files and Folders',
        content:
          'Use the header buttons in the sidebar to create notes and nested folders. Rename or delete notes and folders directly from the File Tree.',
        placement: 'right',
      },
      {
        id: 'gs-tabs-flow',
        target: TOUR_TARGETS.TAB_BAR,
        title: 'Managing Open Tabs',
        content:
          'Switch between open documents quickly. Closing a dirty tab will prompt you to save or discard your changes without losing draft safety.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'writing-markdown',
    title: 'Writing & Markdown Formatting',
    category: 'getting-started',
    description: 'Master CommonMark, [[Wikilinks]], #tags, frontmatter, and safe saving.',
    estimatedMinutes: 4,
    steps: [
      {
        id: 'wm-editor-area',
        target: TOUR_TARGETS.EDITOR,
        title: 'CodeMirror 6 Editor',
        content:
          'OpenOb features a high-performance editor with full syntax highlighting, bracket matching, task checkboxes, and auto-indentation.',
        prepareActionId: 'mode-editor',
        placement: 'bottom',
      },
      {
        id: 'wm-split-preview',
        target: TOUR_TARGETS.VIEW_MODE_MENU,
        title: 'Layout Options',
        content:
          'Toggle between Editor-only, Split View (side-by-side live preview), and Preview-only mode using the layout menu or Ctrl+E.',
        shortcut: 'Ctrl+E',
        placement: 'bottom',
      },
      {
        id: 'wm-links-tags',
        target: TOUR_TARGETS.EDITOR,
        title: 'Wikilinks and Tags',
        content:
          'Connect notes by typing [[Note Name]]. Tag notes by typing #tag in prose or adding a `tags` list in YAML frontmatter.',
        placement: 'bottom',
      },
      {
        id: 'wm-safe-save',
        target: TOUR_TARGETS.STATUS_BAR,
        title: 'Automatic & Manual Saving',
        content:
          'Notes save automatically with debounced atomic writes. You can also press Ctrl+S anytime for an immediate durable flush to disk.',
        shortcut: 'Ctrl+S',
        placement: 'top',
      },
    ],
  },
  {
    id: 'finding-anything',
    title: 'Finding Anything (Search & Quick Open)',
    category: 'getting-started',
    description: 'Use Quick Open, Command Palette, and full-text index queries.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'fa-quick-open',
        target: TOUR_TARGETS.SEARCH_BUTTON,
        title: 'Quick Open (Ctrl+P)',
        content:
          'Press Ctrl+P to open the fast note finder. Type any part of a note title or path to jump directly to it.',
        shortcut: 'Ctrl+P',
        placement: 'bottom',
      },
      {
        id: 'fa-command-palette',
        target: TOUR_TARGETS.SEARCH_BUTTON,
        title: 'Command Palette (Ctrl+Shift+P)',
        content:
          'Execute application commands, switch view modes, manage plugins, and trigger vault actions quickly from your keyboard.',
        shortcut: 'Ctrl+Shift+P',
        placement: 'bottom',
      },
      {
        id: 'fa-global-search',
        target: TOUR_TARGETS.SIDEBAR,
        title: 'Global Search',
        content:
          'Search across document titles, headings, full body text, and specific tags with instant SQLite-powered index speeds.',
        placement: 'right',
      },
    ],
  },
  {
    id: 'outline-backlinks-properties',
    title: 'Outline, Backlinks & Properties',
    category: 'editor-views',
    description: 'Explore document structure, backlinks graph, and YAML frontmatter.',
    estimatedMinutes: 4,
    steps: [
      {
        id: 'obp-outline',
        target: TOUR_TARGETS.OUTLINE_TAB,
        title: 'Document Outline',
        content:
          'View all headings in the current note as a structured table of contents. Click any heading to scroll directly to that section.',
        prepareActionId: 'tab-outline',
        placement: 'left',
      },
      {
        id: 'obp-backlinks',
        target: TOUR_TARGETS.BACKLINKS_TAB,
        title: 'Incoming Backlinks',
        content:
          'See every other note in your vault that links to the currently active note, along with surrounding context snippets.',
        prepareActionId: 'tab-backlinks',
        placement: 'left',
      },
      {
        id: 'obp-properties',
        target: TOUR_TARGETS.PROPERTIES_TAB,
        title: 'YAML Frontmatter Properties',
        content:
          'View and edit structured metadata (status, priority, date, tags). Properties are preserved cleanly at the top of your Markdown file.',
        prepareActionId: 'tab-properties',
        placement: 'left',
      },
    ],
  },
  {
    id: 'database-views',
    title: 'Database Views (Tables & Boards)',
    category: 'editor-views',
    description: 'Transform your Markdown files into editable Tables, Kanban Boards, and Lists.',
    estimatedMinutes: 5,
    steps: [
      {
        id: 'dv-switch',
        target: TOUR_TARGETS.VIEWS_SWITCH,
        title: 'Switching to Views Mode',
        content:
          'Toggle between the active document Editor and Database Views. Views query your Markdown files dynamically based on frontmatter properties.',
        placement: 'bottom',
      },
      {
        id: 'dv-table',
        target: TOUR_TARGETS.VIEWS_SWITCH,
        title: 'Table View & Inline Editing',
        content:
          'In Table view, each row is a Markdown file. Click any property cell to edit strings, numbers, booleans, or tags directly—updates persist straight to the file.',
        placement: 'bottom',
      },
      {
        id: 'dv-board',
        target: TOUR_TARGETS.VIEWS_SWITCH,
        title: 'Kanban Board View',
        content:
          'Group your notes by properties like `status` or `priority`. Dragging a card between columns automatically updates the note’s frontmatter on disk.',
        placement: 'bottom',
      },
      {
        id: 'dv-saved-views',
        target: TOUR_TARGETS.VIEWS_SWITCH,
        title: 'Saved Views & Filters',
        content:
          'Create and save custom views with custom filters, sort orders, and column layouts. Views are stored cleanly in your vault configuration.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'visual-graph',
    title: 'Visual Knowledge Graph',
    category: 'editor-views',
    description: 'Explore connections across notes in an interactive 2D graph.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'vg-open',
        target: TOUR_TARGETS.GRAPH_BUTTON,
        title: 'Opening Global Graph',
        content:
          'Click the Graph button in the header or press Ctrl+G to open the full visual knowledge map of your vault.',
        shortcut: 'Ctrl+G',
        placement: 'bottom',
      },
      {
        id: 'vg-nodes-links',
        target: TOUR_TARGETS.GRAPH_BUTTON,
        title: 'Nodes and Connections',
        content:
          'Each node represents a Markdown note. Lines represent [[wikilinks]]. Nodes with more connections naturally cluster together.',
        placement: 'bottom',
      },
      {
        id: 'vg-nav',
        target: TOUR_TARGETS.GRAPH_BUTTON,
        title: 'Graph Navigation',
        content:
          'Pan, zoom, drag nodes, and click any note to open it immediately in the editor. You can also filter the graph by keyword or tag.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'ai-assistant',
    title: 'Grounded AI Assistant',
    category: 'advanced',
    description: 'Configure local or cloud AI, retrieve vault context, and apply proposed diffs.',
    estimatedMinutes: 4,
    steps: [
      {
        id: 'ai-panel-intro',
        target: TOUR_TARGETS.AI_TAB,
        title: 'Workspace-Scoped AI',
        content:
          'Open the AI tab to interact with your knowledge base. AI answers are grounded in your actual notes using truthful semantic retrieval.',
        prepareActionId: 'tab-ai',
        placement: 'left',
      },
      {
        id: 'ai-providers',
        target: TOUR_TARGETS.INSPECTOR,
        title: 'Local & Cloud BYOK Providers',
        content:
          'Use local offline models (Ollama, LM Studio) with zero API keys, or configure your own keys for OpenAI, Anthropic, Gemini, or OpenRouter.',
        placement: 'left',
      },
      {
        id: 'ai-citations',
        target: TOUR_TARGETS.INSPECTOR,
        title: 'Citations & Sources',
        content:
          'Every AI answer includes explicit citations to the exact notes and line numbers used as reference context.',
        placement: 'left',
      },
      {
        id: 'ai-proposed-edits',
        target: TOUR_TARGETS.INSPECTOR,
        title: 'Safe Proposed Edits',
        content:
          'AI can propose targeted edits to your notes. OpenOb shows a visual diff preview for you to review, edit, or reject before anything touches disk.',
        placement: 'left',
      },
    ],
  },
  {
    id: 'first-party-plugins',
    title: 'First-Party Plugins & Tools',
    category: 'advanced',
    description: 'Use Daily Notes, Templates, Word Count, Character Bible, and Manuscript Tools.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'fp-manager',
        target: TOUR_TARGETS.MORE_MENU,
        title: 'Plugin Manager',
        content:
          'Open More → Plugin Manager to enable or disable first-party productivity plugins.',
        placement: 'bottom',
      },
      {
        id: 'fp-available-tools',
        target: TOUR_TARGETS.MORE_MENU,
        title: 'Built-in Tooling',
        content:
          'Includes Daily Notes (date-stamped logs), Templates (reusable boilerplate), Word Count, Character Bible (entity tracking), and Manuscript Tools.',
        placement: 'bottom',
      },
      {
        id: 'fp-permissions',
        target: TOUR_TARGETS.MORE_MENU,
        title: 'Scoped Permissions',
        content:
          'Plugins operate under explicit capability scopes (e.g. read, write, notify). They cannot access arbitrary network or unauthorized files.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts Reference',
    category: 'advanced',
    description: 'Master keyboard-first navigation and editing shortcuts in OpenOb.',
    estimatedMinutes: 2,
    steps: [
      {
        id: 'ks-quick-open',
        target: TOUR_TARGETS.SEARCH_BUTTON,
        title: 'Navigation Shortcuts',
        content:
          'Ctrl+P / Ctrl+Shift+P: Quick Open / Command Palette\nCtrl+G: Global Graph View\nCtrl+N: Create Note\nCtrl+B: Toggle Sidebar',
        placement: 'bottom',
      },
      {
        id: 'ks-editor-shortcuts',
        target: TOUR_TARGETS.VIEW_MODE_MENU,
        title: 'Editor & Layout Shortcuts',
        content:
          'Ctrl+S: Save Note\nCtrl+E: Cycle View Mode\nCtrl+\\: Toggle Split View\nCtrl+W: Close Active Tab',
        placement: 'bottom',
      },
      {
        id: 'ks-dialog-shortcuts',
        target: TOUR_TARGETS.APP_LOGO,
        title: 'Dialog & Modal Controls',
        content:
          'Escape closes any open modal, search drawer, or tutorial spotlight. Arrow keys navigate lists and menu items.',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'agents-external-access',
    title: 'Agents & External Access (Advanced)',
    category: 'advanced',
    description: 'Learn how OpenOb exposes the workspace to external AI agents via MCP & Gateway.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'aea-gateway-authority',
        target: TOUR_TARGETS.STATUS_BAR,
        title: 'Embedded Gateway Authority',
        content:
          'OpenOb runs a local loopback HTTP Gateway. Both the desktop UI and external agents share the exact same authority and concurrency engine.',
        placement: 'top',
      },
      {
        id: 'aea-mcp-stdio',
        target: TOUR_TARGETS.STATUS_BAR,
        title: 'Model Context Protocol (MCP)',
        content:
          'External AI tools connect via `openob-mcp` stdio transport, allowing coding agents and assistants to read and query notes safely.',
        placement: 'top',
      },
      {
        id: 'aea-stream-resync',
        target: TOUR_TARGETS.STATUS_BAR,
        title: 'Live Change Stream',
        content:
          'All mutations emit Server-Sent Events with sequence cursors. If an external agent modifies a file, OpenOb updates the UI instantly.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'data-safety-conflicts',
    title: 'Data Safety & Conflict Resolution',
    category: 'advanced',
    description: 'Understand optimistic concurrency control (OCC) and conflict handling.',
    estimatedMinutes: 3,
    steps: [
      {
        id: 'dsc-occ-protection',
        target: TOUR_TARGETS.EDITOR,
        title: 'Optimistic Concurrency Control',
        content:
          'Every note version has a cryptographic version token. If a note changes on disk while you are typing, OpenOb will never quietly overwrite the new version.',
        placement: 'bottom',
      },
      {
        id: 'dsc-conflict-modal',
        target: TOUR_TARGETS.EDITOR,
        title: 'Conflict Resolution Modal',
        content:
          'If a collision occurs, OpenOb presents a conflict dialog allowing you to Reload the external version, Keep Your Draft, or copy your changes.',
        placement: 'bottom',
      },
      {
        id: 'dsc-atomic-replacement',
        target: TOUR_TARGETS.STATUS_BAR,
        title: 'Atomic File Replacement',
        content:
          'Saves write to an isolated temporary file before atomic renaming, protecting your data against crash corruption and partial writes.',
        placement: 'top',
      },
    ],
  },
];
