# OpenOb — Phase 3A MCP P2 Remediation Report

## 1. Findings Addressed & Root Causes

### P2-1 / R3A-1: Oversized / Malformed MCP Input Killing Server (Blocker)

- **Problem**: When `openob-mcp` received a single stdio JSON-RPC message exceeding the 10 MB default buffer, the official SDK's `StdioServerTransport` read buffer threw an unhandled buffer overflow error, closed the transport session, and silently terminated the process (`exit 0`).
- **Root Cause**: Default `@modelcontextprotocol/server` `StdioServerTransport` closes the session on unhandled buffer overflow without writing an in-band JSON-RPC error or keeping the transport alive.
- **Fix**:
  1. Implemented `SafeStdioServerTransport` in `apps/gateway/src/stdio-transport.ts` implementing `Transport`.
  2. Bounded streaming chunks: when a message line exceeds `maxMessageBytes` (10 MB default, matching gateway REST limit), excess bytes are discarded with bounded memory consumption without terminating the process.
  3. Returns a structured JSON-RPC error (`-32600 Invalid Request: PAYLOAD_TOO_LARGE`) and diagnostic to `stderr`.
  4. Returns a structured JSON-RPC parse error (`-32700 Parse error: Invalid JSON`) on malformed JSON.
  5. Kept the same MCP process active and ready for subsequent requests.
  6. Added defensive Zod `.max(10 * 1024 * 1024)` constraints on note content in tool definitions.

### P2-2 / R3A-2: `openob_update_note` Document Replacement Contract

- **Problem**: Updating a note via `openob_update_note` replaces the entire file content, causing YAML frontmatter to be overwritten unless explicitly re-supplied.
- **Root Cause**: Inherited gateway contract (`workspace.updateNote` writes content verbatim via `SafeWriter`).
- **Fix**:
  1. Updated tool descriptions in `packages/workspace/src/mcp.ts` and `apps/gateway/src/mcp-server.ts` to explicitly state:
     _"Update the body content of an existing note using strict optimistic concurrency control. Note: this replaces the entire file content; existing frontmatter properties will be overwritten unless explicitly included in content. Use openob_set_property for individual property modifications."_
  2. Documented in `EXTERNAL_ACCESS.md`.
  3. Added regression tests verifying explicit tool description.

### P2-3 / R3A-3: Undeclared `sql.js` Dependency in `apps/gateway`

- **Problem**: `apps/gateway/build.js` left `sql.js` external, but `apps/gateway/package.json` did not declare `sql.js`, relying on hoisting from `@okw/index`.
- **Root Cause**: Missing dependency entry in `apps/gateway/package.json`.
- **Fix**: Declared `"sql.js": "^1.14.2"` in `apps/gateway/package.json` dependencies and verified via `npm ci`.

---

## 2. Process-Level & Adversarial Test Evidence

- **Test Suite**: `tests/integrity/mcp-stdio-transport.test.ts`
- **Results**:
  - `A`: Normal tool calls succeed (`initialize`, `tools/list`, `workspace_info`, `read_note`, `search`, `create_note`, `update_note`, `set_property`, `rename_note`, `delete_note`).
  - `B`: Requests below 10 MB succeed.
  - `C`: Requests just above limit (11 MB) rejected with `PAYLOAD_TOO_LARGE`; process stays alive; no vault mutation occurs.
  - `D`: Very large streaming payloads (25 MB) rejected with bounded memory; process stays alive.
  - `E`: Malformed JSON payloads rejected with Parse Error (`-32700`); process stays alive.
  - `F`: Immediate subsequent valid tool calls on the **same running MCP process** succeed cleanly.
  - `G`: Repeated 5x cycles of malformed/oversized requests followed by valid requests pass deterministically.
  - `H`: Stdout purity verified: 100% of stdout lines parse as valid JSON-RPC 2.0.

- **Repeated Run Evidence**:
  - Executed 20 consecutive iterations of the full `mcp-stdio-transport.test.ts` suite.
  - **Result: 20/20 iterations PASSED (100% deterministic success)**.

---

## 3. Verification Gates Summary

| Verification Step               | Command                                                  | Result                          |
| :------------------------------ | :------------------------------------------------------- | :------------------------------ |
| **Formatting**                  | `prettier --check .`                                     | **PASS** (0 style issues)       |
| **Linting**                     | `eslint .`                                               | **PASS** (0 errors)             |
| **Typecheck**                   | `tsc --build`                                            | **PASS** (0 type errors)        |
| **Full Unit & Integration**     | `vitest run`                                             | **PASS** (52 files / 273 tests) |
| **MCP Adversarial Suite (20x)** | `vitest run tests/integrity/mcp-stdio-transport.test.ts` | **PASS (20/20 runs green)**     |
| **Playwright E2E**              | `playwright test`                                        | **PASS (9/9 browser tests)**    |
| **Executable Packaging Smoke**  | `node apps/gateway/dist/bin/mcp.js --help`               | **PASS (exit 0)**               |
| **Full Gate**                   | `npm run verify:full`                                    | **PASS (exit 0)**               |
