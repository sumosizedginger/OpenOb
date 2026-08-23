# Security Policy

## Supported Versions

OpenOb is currently under active pre-release development. Security patches are applied directly to the `main` branch.

| Version              | Supported          |
| -------------------- | ------------------ |
| `main` (pre-release) | :white_check_mark: |
| < 0.1.0              | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability in OpenOb, please report it responsibly using GitHub's **Private Vulnerability Reporting**:

1. Navigate to the repository's **[Security tab](https://github.com/sumosizedginger/OpenOb/security)** on GitHub.
2. Click **"Report a vulnerability"** to open a confidential security advisory draft.
3. Provide detailed information about the vulnerability:
   - A clear description of the issue and potential impact
   - Minimal reproduction steps or proof-of-concept
   - Affected components (Gateway, Desktop Shell, MCP Server, Storage, Parser)
   - Proposed remediation if available

> [!IMPORTANT]
> **Please do not open public issues or pull requests containing sensitive vulnerability details or unredacted exploits before coordination and resolution.**

---

## Security Architecture & Threat Model

OpenOb enforces strict data safety and security invariants across its subsystems:

- **Local-First Vault Integrity**: Canonical Markdown files on local disk remain the sole source of truth. Writes require Optimistic Concurrency Control (OCC) version tokens to prevent silent overwrites.
- **Gateway Loopback Authority**: The OpenOb Gateway binds strictly to loopback (`127.0.0.1`) with bearer token authentication and capability scopes (`workspace.read`, `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete`, `workspace.views.write`).
- **Model Context Protocol (MCP) Sandboxing**: MCP tools execute exclusively through the authenticated Gateway REST API over stdio, ensuring AI agents operate within defined permission boundaries.
- **Path Traversal Prevention**: Storage and Gateway layers enforce path normalization and directory boundary checks to block path traversal outside the vault root.
- **Desktop Credential Protection**: AI provider credentials and sensitive keys are encrypted locally using platform-specific DPAPI/Keychain backing before storage.
- **Plugin Sandboxing**: Plugin runtimes operate with sandboxed access and explicit capability declarations.
