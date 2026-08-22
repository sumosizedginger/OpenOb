/**
 * apps/web/src/onboarding/targets.ts
 * Stable tour target selector registry for OpenOb.
 */

export const TOUR_TARGETS = {
  APP_LOGO: '[data-tour="app-logo"]',
  SIDEBAR: '[data-tour="sidebar"]',
  NEW_NOTE: '[data-tour="new-note"]',
  NEW_FOLDER: '[data-tour="new-folder"]',
  TAB_BAR: '[data-tour="tab-bar"]',
  EDITOR: '[data-tour="editor"]',
  VIEW_MODE_MENU: '[data-tour="view-mode-menu"]',
  SEARCH_BUTTON: '[data-tour="search-button"]',
  INSPECTOR: '[data-tour="inspector"]',
  INSPECTOR_TABS: '[data-tour="inspector-tabs"]',
  OUTLINE_TAB: '[data-tour="outline-tab"]',
  BACKLINKS_TAB: '[data-tour="backlinks-tab"]',
  PROPERTIES_TAB: '[data-tour="properties-tab"]',
  AI_TAB: '[data-tour="ai-tab"]',
  VIEWS_SWITCH: '[data-tour="views-switch"]',
  GRAPH_BUTTON: '[data-tour="graph-button"]',
  MORE_MENU: '[data-tour="more-menu"]',
  STATUS_BAR: '[data-tour="status-bar"]',
} as const;

export type TourTargetKey = keyof typeof TOUR_TARGETS;
