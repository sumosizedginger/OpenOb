# OpenOb — Phase 3A Report

## Live MCP Stdio Transport (`openob-mcp`) Closure

### 1. Architectural Compliance & Single Authority

Phase 3A delivers the production `openob-mcp` stdio MCP server using the official TypeScript MCP SDK (`@modelcontextprotocol/server` v2.0.0).

**Strict Topology Enforced**:

```text
[External AI Agent / IDE]
          │ (stdio JSON-RPC via @modelcontextprotocol/server)
          ▼
    [openob-mcp]
          │ (HTTP Loopback /api/v1 via OpenObGatewayClient)
          ▼
   [OpenOb Gateway]
          │
          ▼
  [OpenObWorkspace]
          │
          ▼
 [VaultStorage + DocumentIndex]
```

- **Single Authority Invariant**: `openob-mcp` contains **zero direct vault storage or index imports/constructors**. It communicates strictly over HTTP loopback (`127.0.0.1`) with the running OpenOb Gateway REST API.
- **Scope Authority**: `openob-mcp` cannot grant itself permissions or accept scope flags from external MCP clients. Scopes and authorization are governed 100% by the server-side configuration of the running gateway.

---

### 2. Implementation Overview

#### A. Typed Gateway Client (`apps/gateway/src/client.ts`)

- Implemented `OpenObGatewayClient` providing typed methods for all 11 OpenOb operations:
  - `getWorkspaceInfo()`, `listEntries()`, `readNote()`, `search()`, `getBacklinks()`, `getProperties()`
  - `createNote()`, `updateNote()`, `setProperty()`, `renameNote()`, `deleteNote()`
- Standardized error handling: maps gateway HTTP error responses to typed `GatewayError` and `GatewayUnavailableError` (503), preserving HTTP status codes and machine-readable error details.
- Refactored `apps/gateway/src/cli.ts` to share `OpenObGatewayClient` for remote execution.

#### B. MCP Server Core (`apps/gateway/src/mcp-server.ts`)

- Configures `McpServer` (`@modelcontextprotocol/server`) with `zod` parameter schemas.
- Registers all 11 OpenOb tools:
  1. `openob_workspace_info`
  2. `openob_list_entries`
  3. `openob_read_note`
  4. `openob_search`
  5. `openob_get_backlinks`
  6. `openob_get_properties`
  7. `openob_create_note`
  8. `openob_update_note`
  9. `openob_set_property`
  10. `openob_rename_note`
  11. `openob_delete_note`
- Maps responses and exceptions to MCP `{ content: [...], isError: boolean }` format, preserving error status codes (401, 403, 404, 409, 413, 503).

#### C. Stdio Executable (`apps/gateway/src/bin/mcp.ts`)

- Provides the `openob-mcp` binary entrypoint.
- Parses `--url`, `--token`, `--client-id`, and `--help` / `-h` arguments as well as environment variables (`OPENOB_URL`, `OPENOB_TOKEN`, `OPENOB_CLIENT_ID`).
- Serves stdio transport via `serveStdio(() => createOpenObMcpServer(config))`.
- Pure stdio protocol isolation: stdout is strictly reserved for JSON-RPC MCP messages; all diagnostics and startup logs are routed to `stderr`.
- Clean shutdown on `SIGINT`, `SIGTERM`, and stdin EOF.

#### D. Packaging & Build

- `apps/gateway/package.json`: exposed `"openob-mcp": "./dist/bin/mcp.js"`.
- `apps/gateway/build.js`: added `'bin/mcp'` entrypoint for standalone esbuild bundling.
- Root `package.json`: added `"mcp": "node apps/gateway/dist/bin/mcp.js"`.
- `.github/workflows/ci.yml`: added `node apps/gateway/dist/bin/mcp.js --help` smoke test.

---

### 3. Verification Results

| Suite                  | Target                                        | Status   | Result                                        |
| :--------------------- | :-------------------------------------------- | :------- | :-------------------------------------------- |
| **Formatting**         | `prettier --check .`                          | **PASS** | 0 style issues                                |
| **Linting**            | `eslint .`                                    | **PASS** | 0 errors (4 non-blocking React hook warnings) |
| **Typecheck**          | `tsc --build`                                 | **PASS** | 0 type errors                                 |
| **Unit & Integration** | `vitest run`                                  | **PASS** | **52 files / 270 tests passed (100%)**        |
| **MCP Integration**    | `tests/integrity/mcp-stdio-transport.test.ts` | **PASS** | Real MCP client + stdio transport + gateway   |
| **E2E Playwright**     | `playwright test`                             | **PASS** | **9 tests passed**                            |
| **Executable Smoke**   | `node apps/gateway/dist/bin/mcp.js --help`    | **PASS** | Exited 0                                      |
| **Full Gate**          | `npm run verify:full`                         | **PASS** | Exit code 0                                   |

---

### 4. Touched Files

- `apps/gateway/package.json`
- `apps/gateway/build.js`
- `apps/gateway/src/client.ts` [NEW]
- `apps/gateway/src/mcp-server.ts` [NEW]
- `apps/gateway/src/bin/mcp.ts` [NEW]
- `apps/gateway/src/cli.ts`
- `apps/gateway/src/index.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `EXTERNAL_ACCESS.md`
- `tests/integrity/mcp-stdio-transport.test.ts` [NEW]
- `PHASE3A_LIVE_MCP_REPORT.md` [NEW]
