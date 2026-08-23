# Changelog

All notable changes to OpenOb will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Core Architecture**: Local-first Markdown vault storage engine with optimistic concurrency control (OCC) and deterministic version tokens.
- **SQLite Document Index**: Pure derived in-memory and SQLite-backed document index with full-text search, tag extraction, wikilink resolution, and property querying.
- **Gateway REST & MCP Server**: Local loopback authority (`127.0.0.1`) exposing workspace CRUD, search, properties mutation, live SSE change streams, and Model Context Protocol (MCP) stdio server.
- **Desktop Application**: Electron-based native desktop shell embedding local gateway authority, native filesystem watcher reconciliation, and secure secret store.
- **Database & Saved Views**: Table and Kanban board views with live property mutation, filtering, sorting, and persisted `.openob/views/` JSON view configs.
- **Plugin SDK**: Sandboxed event-driven plugin runtime supporting Daily Notes, Templates, and custom workspace extensions.
- **Web Client & GitHub Pages**: Pure static web application deployed to GitHub Pages with in-browser OPFS storage and remote gateway connectivity.
- **Verification Pipeline**: Comprehensive multi-lane verification suite covering unit, integrity, concurrency probes, real browser Playwright E2E, and desktop packaging gates.
