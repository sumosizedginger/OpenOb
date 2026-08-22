/**
 * apps/web/src/onboarding/keyboardShortcuts.ts
 * Single source of truth for documented OpenOb keyboard shortcuts.
 */

export interface KeyboardShortcutItem {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export interface KeyboardShortcutCategory {
  readonly title: string;
  readonly items: readonly KeyboardShortcutItem[];
}

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcutCategory[] = [
  {
    title: 'Navigation & Search',
    items: [
      {
        key: 'Ctrl+P / Ctrl+Shift+P',
        label: 'Quick Open / Command Palette',
        description: 'Open quick note finder or command palette',
      },
      {
        key: 'Ctrl+Shift+F',
        label: 'Global Search',
        description: 'Search across all vault notes and tags',
      },
      {
        key: 'Ctrl+G',
        label: 'Global Graph',
        description: 'Open interactive 2D Knowledge Graph',
      },
      {
        key: 'Ctrl+N',
        label: 'Create Note',
        description: 'Create a new Markdown note',
      },
      {
        key: 'Ctrl+B',
        label: 'Toggle Sidebar',
        description: 'Toggle left file explorer sidebar',
      },
    ],
  },
  {
    title: 'Editor & Layout',
    items: [
      {
        key: 'Ctrl+S',
        label: 'Save',
        description: 'Save current note immediately',
      },
      {
        key: 'Ctrl+\\',
        label: 'Toggle Split View',
        description: 'Toggle side-by-side editor and preview',
      },
      {
        key: 'Ctrl+E',
        label: 'Cycle View Mode',
        description: 'Cycle between Split, Editor, and Preview modes',
      },
      {
        key: 'Ctrl+W',
        label: 'Close Tab',
        description: 'Close active document tab',
      },
    ],
  },
  {
    title: 'General & Dialogs',
    items: [
      {
        key: 'Escape',
        label: 'Close / Dismiss',
        description: 'Close active modals, drawers, or guided tours',
      },
      {
        key: 'Arrow Keys',
        label: 'Navigate Lists',
        description: 'Navigate items in lists, menus, and tour steps',
      },
      {
        key: 'Enter',
        label: 'Confirm',
        description: 'Confirm selection or advance tour step',
      },
    ],
  },
] as const;
