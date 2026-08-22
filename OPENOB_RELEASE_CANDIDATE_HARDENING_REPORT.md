# OpenOb — Desktop Release Candidate Hardening Report

# Security + Data Safety + Product Truth + Release Build Truth

**Status**: READY FOR DEEPSEEK RC AUDIT  
**Audited Starting HEAD**: `3d61b8ab7562c10962df0bdc2daf7e830765a633`  
**Execution Environment**: Google Antigravity 2.0 (Foreman single authority)  
**Date**: 2026-08-22

---

## 1. Executive Summary

This hardening pass resolves every identified Release Candidate (RC) gap and incorporates all 22 mandatory architectural corrections across Security, Data Safety, Concurrency, IPC Trust Boundaries, Product Truth, and Packaging Verification.

The complete automated verification matrix (`npm run verify:full` + `npm run verify:desktop:release`) passes 100% with zero skips and zero regressions.

---

## 2. Hardening Matrix & Resolved Risks

### P1-A — Renderer Navigation & IPC Trust Boundary Hardening

- **Exact-Origin Loopback Matching**: Implemented `isAllowedNavigation(navUrl)` in `apps/desktop/src/main.ts` using strict URL origin matching against the embedded gateway loopback origin (`new URL(navUrl).origin === new URL(currentSession.gateway.url).origin`). Rogue schemes (`file:`, `javascript:`, `data:`), subdomain spoofing, and credential tricks (`@evil.com`) are rejected.
- **Main Frame IPC Validation**: Implemented `validateIpcSender(event)` requiring `event.sender === mainWindow.webContents`, `event.senderFrame === mainWindow.webContents.mainFrame`, and verified origin equality. Any invoke attempt from subframes or foreign windows fails closed.
- **Single Window Lifecycle**: Window close (`win.on('close')`) and application quit (`app.on('before-quit')`) are intercepted unless approved by the centralized Safe Shutdown Coordinator.

### P1-B — Data Safety, Concurrency & Revision-Safe Async Saving

- **Revision-Safe Save Architecture**: Augmented `OpenTab` with a monotonically increasing `revision: number`. When a save begins, `sentRevision` and `sentContent` are snapshotted. Upon response, `isDirty` is cleared _only_ if `tab.revision === sentRevision` or `tab.content === sentContent`. Keystrokes typed while a slow or queued save is in flight remain dirty and are serialized behind it.
- **Per-Path Save Serialization**: Integrated `inFlightSavesRef` and debounced autosave scheduling to serialize overlapping same-note saves.
- **Autosave Timer Lifecycle Management**: Pending autosave timers are tracked per-path and cleanly cancelled or migrated on tab close, rename, delete, vault switch, Gateway disconnect, or component unmount.
- **Bounded Flush Stabilization**: Implemented `flushDirtyNotes()` with an iterative loop (up to 3 rounds) to save all open dirty notes and catch newer edits until the entire workspace reaches a clean state.
- **Electron Flush Protocol & Safe Shutdown Coordinator**: Implemented `desktop:flush-request` and `desktop:flush-result` protocol with a 5000ms timeout and user-facing conflict resolution dialog.
- **Vault Switching Transaction**: Single authority in main process: requests renderer flush $\rightarrow$ awaits positive confirmation $\rightarrow$ stops old session $\rightarrow$ boots new session.

### P1-C — Plugin Host Hardening & Production Isolation

- **Production Isolation**: `(window as any).__pluginHost` is strictly gated to `import.meta.env.DEV || import.meta.env.MODE === 'test'` and never exposed on global `window` in production packaged builds.
- **Safe DOM Rendering**: Removed raw `.innerHTML` sink in `packages/plugin/src/host.ts` error handler and replaced with safe DOM element construction (`document.createElement`, `textContent`, `container.replaceChildren`), with fallback for non-DOM test environments.
- **Plugin Preference Loading**: `App.tsx` loads persisted plugin enabled/disabled states before activating first-party plugins on boot. Disabled plugins never run `onLoad()`.
- **IPC State Sanitization**: Implemented strict validation for `desktop:set-plugin-states` (validates plugin IDs matching `/^[a-zA-Z0-9_.-]{1,64}$/`, booleans, maximum 100 entries).

### P2-D — File Tree Mutations & OCC Integrity

- **Deterministic 2-Pass Tree Builder**: Pass 1 creates nodes and implicit ancestor folders; Pass 2 links parents and children and sorts directories first (A-Z) followed by files (A-Z).
- **Deletion Safety**: Note deletions require explicit user confirmation and warn if open dirty edits exist.
- **Folder Action Parity**: Removed unsupported folder deletion in File Tree to preserve Markdown note-based vault authority.
- **Unopened Note OCC**: Gateway renames and deletes perform an OCC read prior to mutation to prevent overwriting or deleting concurrent external edits.

### P2-E — Application Readiness & Startup Sequencing

- **Explicit Readiness Signal**: `useVault` computes `isAppReady` based on `vaultInitStatus === 'ready'`, preventing first-run Onboarding modals from rendering during startup races before the vault is seeded or connected.

### P2-F — Help / Learn Discoverability & Build Identity

- **Native Application Menu**: Configured complete Electron native menu with standard application menus (`File`, `Edit`, `View`, `Window`) and dedicated `Help` menu (`Learn OpenOb`, `Quick Tour`, `Keyboard Shortcuts`, `About OpenOb`).
- **About OpenOb Dialog**: Built `<AboutModal>` displaying App Name, Version (`0.1.0`), Commit SHA (injected via build pipeline), Clean/Dirty working tree status, Operating System, Electron/Chrome/Node runtimes, and SafeStorage encryption status.
- **More Menu Integration**: Added "About OpenOb" action to the top navbar More dropdown.

### P2-G — Release Packaging & Truthful Verification Gates

- **Distinct Artifact Target Names**: Configured `apps/desktop/electron-builder.json` with target-specific artifact naming:
  - NSIS: `OpenOb-Setup-0.1.0-x64.exe`
  - Portable: `OpenOb-Portable-0.1.0-x64.exe`
- **Release Verification Gate (`npm run verify:desktop:release`)**: Validates PE executable headers (`0x4D, 0x5A`), checks minimum bundle size, verifies embedded web dist assets, computes SHA-256 hashes, and outputs `release-manifest.json`.
- **Windows CI Update**: `.github/workflows/ci.yml` updated to run `verify:desktop:release` and upload release artifacts.

### P2-H — Truthful Starter Content

- **Starter Vault Seed**: Replaced legacy phase-era notes with comprehensive OpenOb User Guide, keyboard shortcuts cheat sheet, sample daily log, character sheets, and architectural notes.

---

## 3. Automated Verification Results

| Suite / Gate               | Command                          | Result   | Details                                                                                   |
| -------------------------- | -------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| **Formatting**             | `npm run format:check`           | **PASS** | 0 formatting violations                                                                   |
| **Linting**                | `npm run lint`                   | **PASS** | 0 errors                                                                                  |
| **Typecheck**              | `npm run typecheck`              | **PASS** | 0 type errors across all packages and apps                                                |
| **Unit & Integrity**       | `npm test`                       | **PASS** | **71/71 test files, 451/451 tests passing**                                               |
| **Production Build**       | `npm run build`                  | **PASS** | Gateway, Web, and Desktop bundle builds clean                                             |
| **Browser & Desktop E2E**  | `npm run verify:e2e`             | **PASS** | **42/42 Playwright E2E tests passing**                                                    |
| **Release Packaging Gate** | `npm run verify:desktop:release` | **PASS** | NSIS Setup + Portable Executable generated, PE headers verified, SHA256 manifest produced |
| **Full Integrated Gate**   | `npm run verify:full`            | **PASS** | Clean run across all gates                                                                |

---

## 4. Release Artifacts & SHA-256 Manifest

- **Release Output Directory**: `apps/desktop/release`
- **NSIS Installer**: `OpenOb-Setup-0.1.0-x64.exe` (109.19 MB)
  - **SHA-256**: `05fa0c0a22e3f898d21d5bf45c1e019d871c4fbca43a1211b18eab02ac6dfe73`
- **Portable Executable**: `OpenOb-Portable-0.1.0-x64.exe` (108.85 MB)
  - **SHA-256**: `fad69fa92212ce95b3e12f74113967df3ac7cef269f4ea10cb1695c1e64d6ddc`

---

## 5. Next Action

Foreman implementation is complete and verified. Ready for DeepSeek Release Candidate adversarial audit.
