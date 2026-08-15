# START HERE

## Purpose

This repository will become an open-source, HTML-first, local-first knowledge workspace inspired by the strengths of Obsidian and Notion without copying either product's proprietary implementation.

The system must:

- Keep user-authored Markdown/files as canonical truth.
- Work offline.
- Work without AI.
- Support local models and BYOK cloud providers.
- Support fast search, links, backlinks, properties, graph views, and workspace features.
- Expose a permissioned third-party plugin API.
- Avoid vendor lock-in.
- Keep derived state disposable and rebuildable.
- Protect user data above all other goals.

## Read Order for Coding Agents

Before changing production code, read these files in order:

1. `CONTEXT.md`
2. `MODEL_OPERATIONS.md`
3. `CONSTITUTION.md`
4. `PRD.md`
5. `ARCHITECTURE.md`
6. `AGENTS.md`
7. `HANDOFF_PROTOCOL.md`
8. `TESTING.md`
9. `SECURITY.md`
10. `AI_ARCHITECTURE.md`
11. `PLUGIN_ARCHITECTURE.md`
12. `FAILURE_REGISTRY.md`
13. `ROADMAP.md`
14. `CONTRIBUTING.md`

If any implementation request conflicts with `CONSTITUTION.md`, stop and report the conflict instead of silently violating it.

## Initial Build Target

Do **not** begin by building the graph, AI assistant, databases, sync, or a plugin marketplace.

The first vertical slice is:

> Select a folder -> open a Markdown file -> edit it -> save safely -> close the app -> reopen it -> confirm the data survived exactly.

Nothing else matters until that works reliably.

## Technology Direction

Default stack:

- HTML
- CSS
- TypeScript
- React
- CodeMirror 6
- Web Workers
- SQLite WASM / compatible local index
- Browser File System Access where available
- OPFS for disposable browser-local derived state
- Optional Electron wrapper later
- Optional local Node/TypeScript AI gateway for cloud BYOK secrets

The architecture must not depend on Electron, React internals, a specific AI vendor, or a proprietary server.

## Non-Goals for Early Development

Do not build these until their roadmap phase:

- Cross-device sync
- Real-time collaboration
- Mobile parity
- Plugin marketplace
- Cloud accounts
- Hosted note storage
- Team workspaces
- Mandatory telemetry
- Proprietary document format
- AI-autonomous file mutation

## Working Principle

A feature is not complete because it works once.

It is complete when:

- its contract is clear,
- its tests pass,
- its failure modes are understood,
- it survives hostile inputs,
- it respects architectural boundaries,
- it does not endanger user data,
- and it performs acceptably at realistic scale.


## Active Coding Models

This repository currently assumes exactly two quota-bearing coding systems:

### Primary Foreman

- **Environment:** Google Antigravity 2.0
- **Model:** Gemini 3.7 Flash
- **Role:** sole architecture owner, primary implementer, integration authority, final merger

### Secondary Engineer / Adversary

- **Environment:** Reasonix
- **Model:** `deepseek-v4-flash`
- **Current upstream alias:** latest DeepSeek V4 Flash revision
- **Role:** failure analysis, regression-test design, bounded surgical implementation, security/performance review

Do not require Gemini 3.7 Flash / Antigravity 2.0, DeepSeek V4 Flash / Reasonix, Grok, or any other paid coding model for the planned workflow.

See `MODEL_OPERATIONS.md` and `HANDOFF_PROTOCOL.md`.
