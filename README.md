<div align="center">

<img src="assets/brand/openob-mark-transparent.png" width="128" height="128" alt="OpenOb logo — jackass skull within a broken gold sigil" />

# OpenOb

**The open-source, local-first knowledge workspace for high-velocity thinking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI Status](https://github.com/sumosizedginger/OpenOb/actions/workflows/ci.yml/badge.svg)](https://github.com/sumosizedginger/OpenOb/actions/workflows/ci.yml)
[![Pages Status](https://github.com/sumosizedginger/OpenOb/actions/workflows/pages.yml/badge.svg)](https://sumosizedginger.github.io/OpenOb/)
[![Local-First](https://img.shields.io/badge/architecture-local--first-success.svg)](ARCHITECTURE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## Overview

**OpenOb** is an open-source, local-first personal knowledge management workspace and desktop application designed for maximum longevity, uncompromising data integrity, and strict human authority.

- **Markdown-Canonical**: Your notes remain plain text Markdown and YAML frontmatter on your local disk.
- **Pure Derived SQLite Index**: Instant full-text search, backlinks, and graph queries rebuilt deterministically.
- **Embedded Gateway Authority**: Local loopback daemon (`127.0.0.1`) coordinating human edits, external agents, and Model Context Protocol (MCP) clients with optimistic concurrency control (OCC).
- **Database & Kanban Views**: Table and Board views with live property mutation, filtering, sorting, and persisted `.openob/views/` configurations.
- **Zero Cloud Lock-in**: 100% private and offline-first with local hardware-backed secret storage.

---

## Deployment & Run Modes

### 🌐 Live Web Demo

Experience OpenOb directly in modern web browsers (Chrome, Edge) using the Origin Private File System (OPFS):
👉 **[Open Web Client](https://sumosizedginger.github.io/OpenOb/)**

> _Note: In-browser web mode runs within browser sandbox storage. For native filesystem authority and live MCP AI agent integration, run the Desktop Application._

### 💻 Desktop Application & Platform Status

- **Windows (x64)**: **Release-Verified**. Full release packaging gate validated (NSIS Setup installer and Portable executable). Pre-release builds are currently unsigned; Windows Defender SmartScreen may display an unknown publisher notification.
- **macOS**: **CI Build-Verified**. Packaged as DMG and ZIP; unsigned and unnotarized in developer preview.
- **Linux**: **CI Build-Verified**. Packaged as tar.gz and ZIP distributables (AppImage target configured); distribution-ready developer build.

---

## Quick Start

### Prerequisites

- **Node.js**: `>= 22.x <= 24.x` (Node 24 LTS recommended)
- **npm**: `>= 10.x`
- **Git**

### Installation & Local Development

```bash
# Clone repository
git clone https://github.com/sumosizedginger/OpenOb.git
cd OpenOb

# Install dependencies
npm ci

# Start web client in development mode
npm run dev

# Start desktop application in development mode
npm run desktop:dev
```

### Verification & Testing

OpenOb maintains strict multi-lane verification gates:

```bash
# Run full verification suite (format check, lint, typecheck, unit, and browser E2E)
npm run verify:full

# Run desktop integration tests
npm run test:desktop

# Run Windows official desktop packaging and release gate
npm run verify:desktop:release
```

---

## Community & Governance

- **[Changelog](CHANGELOG.md)**: Track recent and upcoming changes.
- **[Security Policy](SECURITY.md)**: Details on threat modeling and confidential vulnerability reporting via GitHub Private Vulnerability Reporting.
- **[Contributing Guide](CONTRIBUTING.md)**: Instructions for code contributions, invariants, and development workflows.
- **[Constitution](CONSTITUTION.md)**: The immutable laws governing OpenOb's state, data safety, and single-writer architecture.

---

## Brand & Identity

The canonical OpenOb brand mark is the Saint Jackass skull within the broken antique-gold sigil. All derived brand assets, favicons, multi-resolution Windows ICOs, and macOS ICNS are located in `assets/brand/` and documented in [`assets/brand/README.md`](assets/brand/README.md).

---

## License

OpenOb is open-source software licensed under the **[MIT License](LICENSE)**.
