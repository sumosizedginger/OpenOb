# Contributing to OpenOb

Thank you for your interest in contributing to OpenOb. OpenOb is a local-first, extensible knowledge workspace built with TypeScript, SQLite, and Electron.

---

## Development Setup

### Prerequisites

- **Node.js**: `24.x LTS` (Node 22.x compatibility supported)
- **npm**: `>= 10.x`
- **Git**

### Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/OpenOb.git
   cd OpenOb
   ```
3. Install dependencies:
   ```bash
   npm ci
   ```

---

## Verification Pipeline

Before opening a pull request, ensure the full local verification suite passes:

```bash
# Full check: format, lint, typecheck, unit/integrity tests, and browser E2E
npm run verify:full
```

### Targeted Test Commands

- **Unit & Integrity Tests**: `npm test`
- **Browser Playwright E2E**: `npm run test:e2e`
- **Desktop Shell Tests**: `npm run test:desktop`
- **Windows Release Packaging Verification**: `npm run verify:desktop:release`

---

## Core Invariants & Architecture Rules

All contributions must preserve OpenOb's constitutional invariants:

1. **Markdown is Canonical**: Plain Markdown and frontmatter on disk are the authoritative source of truth. SQLite is purely derived and disposable.
2. **Zero Silent Data Loss**: All mutating operations must use Optimistic Concurrency Control (`expectedVersion`) to reject stale writes.
3. **Loopback Gateway Authority**: The Gateway binds strictly to loopback (`127.0.0.1`) with explicit capability scopes.
4. **No Direct Package Source Imports**: External imports must strictly reference published package names (`@okw/core`, `@okw/vault`, etc.), never unbundled relative paths.

For full architectural guidance, consult [`CONSTITUTION.md`](./CONSTITUTION.md) and [`AGENTS.md`](./AGENTS.md).

---

## Pull Request Guidelines

- **Keep changes focused**: One PR per feature or bug fix.
- **Include tests**: Every bug fix or feature must include automated regression/integration test coverage.
- **No secrets or private keys**: Ensure no real tokens or credentials are included in code or fixtures.
- **Licensing**: By contributing to OpenOb, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
