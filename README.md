<div align="center">

<img src="assets/brand/openob-mark-transparent.png" width="128" height="128" alt="OpenOb logo — jackass skull within a broken gold sigil" />

# OpenOb

**The open-source, local-first knowledge workspace for high-velocity thinking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/architecture-local--first-success.svg)](ARCHITECTURE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## Overview

**OpenOb** is an open-source, local-first personal knowledge management workspace and desktop application designed for maximum longevity, uncompromising data integrity, and strict human authority.

- **Markdown-Canonical**: Your files remain plain Markdown on your local disk.
- **Derived SQLite Index**: Instant full-text search, backlinks, and graph queries rebuilt deterministically.
- **Embedded Gateway Authority**: Local-first HTTP & SSE daemon coordinating human edits, external agents, and Model Context Protocol (MCP) clients with optimistic concurrency control (OCC).
- **Hardened Desktop Experience**: Native Windows, macOS, and Linux support built on Electron with secure secret storage and zero cloud lock-in.

---

## Quick Start

### Prerequisites

- **Node.js**: `>= 20.x < 23.x`
- **npm**: `>= 10.x`
- **Python**: `>= 3.10` (for brand asset generation)

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/sumosizedginger/OpenOb.git
cd OpenOb

# Install dependencies
npm ci

# Start the web workspace in development mode
npm run dev

# Start the desktop application in development mode
npm run desktop:dev
```

### Building & Verification

```bash
# Full verification gate (lint, types, tests, builds, and e2e)
npm run verify:full

# Package standalone Windows executable
npm run pack:desktop
```

---

## Brand & Identity

The canonical OpenOb brand mark is the Saint Jackass skull within the broken antique-gold sigil. All derived brand assets, favicons, multi-resolution Windows ICOs, and macOS ICNS are located in `assets/brand/` and documented in [`assets/brand/README.md`](assets/brand/README.md).

---

## License

OpenOb is open-source software licensed under the **MIT License**.
