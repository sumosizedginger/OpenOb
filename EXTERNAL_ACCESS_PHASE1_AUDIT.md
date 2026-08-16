# EXTERNAL_ACCESS_PHASE1_AUDIT.md

Audit type: **read / test / analyze only**. No production code modified. Temporary adversarial probes (real `NodeFsVaultStorage` vault in a temp dir + `rebuildVaultIndex` + `OpenObWorkspace` + real `startGateway` HTTP server on a dynamic port; raw `node:http` requests to bypass client-side URL normalization; MCP handler; CLI runner; 1k-note perf vault) were used and **removed afterward**. Working tree is clean except the pre-existing local `reasonix.toml` change.

## 1. Exact SHA

- **HEAD audited:** `54cf1bef1e782482c8c1b82e6007f3542db8307a` — `feat(external): implement workspace service and read-only local gateway (Phase 1)`.
- Parent: `576199c` (prettier follow-up of the R1-R8 remediation). No commits after HEAD on `origin/main`.

## 2. Baseline

| Gate                             | Result                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                         | PASS (0 vulnerabilities)                                                                                                                                                         |
| `npm run format:check`           | PASS                                                                                                                                                                             |
| `npm run lint`                   | PASS — 0 errors, 4 pre-existing react-hooks warnings                                                                                                                             |
| `npm run typecheck`              | PASS                                                                                                                                                                             |
| `npm test`                       | **47 files / 209 tests PASS**                                                                                                                                                    |
| `npm run build`                  | PASS (pre-existing chunk-size warning)                                                                                                                                           |
| `npm run test:e2e`               | **9/9 PASS**                                                                                                                                                                     |
| `npm run verify` / `verify:full` | PASS / PASS                                                                                                                                                                      |
| Remote GitHub Actions            | **UNAVAILABLE** — repo private/renamed; `api.github.com` returns 404 for the SHA and the repo (consistent with every prior audit). CI replayed locally step-for-step; all green. |

**No existing gate regressed.** The Phase 1 commit touches zero `apps/web` files; the web foundation suite (persistence R1-R8, H9-H17, G-series) remains green.

## 3. Architecture verdict — **PASS (ONE genuine OpenOb application boundary)**

Search of `apps/gateway/src` and `packages/workspace/src` (excluding tests) for `storage.write`, `storage.remove`, `fs.writeFile*`, `index.upsert`, `index.remove`, and independent frontmatter parsing: **zero direct hits**. Every adapter is thin:

```
REST server (server.ts)  -> OpenObWorkspace methods only
MCP handler (mcp.ts)     -> OpenObWorkspace methods only
CLI (cli.ts)             -> OpenObWorkspace methods only
OpenObWorkspace          -> @okw/core path rules, @okw/vault storage/SafeWriter/coordinator,
                            @okw/index (MemoryDocumentIndex, buildGraphData), @okw/markdown parser
```

No adapter parses frontmatter, no adapter mutates the index, no adapter touches the filesystem. The only writes anywhere near the boundary are inside `@okw/vault` and are not reachable through any Phase 1 route (no write method exists on the service). This is the required shape: `adapter → OpenObWorkspace → existing core subsystems`.

## 4. OpenObWorkspace verdict — **PASS**

Real application service over the real packages (verified against canonical state in probes): `listEntries`, `readNote`, `getWorkspaceInfo`, `search`, `getBacklinks`, `getOutgoingLinks`, `getProperties`, `getGraphNeighbors` all cross-check against the underlying `NodeFsVaultStorage` + rebuilt index. No stale shadow datastore exists (reads go to canonical; summaries/links come from the shared index; `readNote` parses the live file). No duplicate index per request — one `MemoryDocumentIndex` is constructed once and held by the workspace.

## 5. REST verdict — **PASS** (with one P3 route-shadowing note)

Route inventory matches `EXTERNAL_ACCESS.md` exactly: `/health`, `/api/v1/workspace`, `/api/v1/entries`, `/api/v1/notes/:path`, `/api/v1/search`, `/api/v1/notes/:path/{backlinks,links,properties,graph-neighbors}`. Non-GET methods → `405 UNSUPPORTED`. Unknown paths → `404`. No undocumented endpoints discovered (probing of `/debug`, case-variant, duplicate-slash, and dot-segment routes returned 401/404/400 — never a handler). JSON DTOs are plain serializable objects (no `FileSystemHandle`, no class instances, no functions).

**P3:** a note literally named `backlinks`, `links`, `properties`, or `graph-neighbors` inside a subfolder (e.g. `Sub/backlinks`) is shadowed by the subaction suffix routes — the note cannot be read via REST (only `Sub`'s backlinks are returned). Workspace-level API is unaffected.

## 6. Auth verdict — **REAL** (token mode)

- Loopback bind by default: `startGateway` defaults `host: '127.0.0.1'` (never `0.0.0.0`); verified by probe (server bound to 127.0.0.1).
- With a token configured: missing token → 401, wrong token → 401, valid token (Bearer or `X-OpenOb-Token`) → 200.
- Bypass attempts all rejected with 401: token in query string, `/health/../api/v1/workspace` dot-segment, case-variant path, duplicate slash, Basic auth with the right secret, lowercase `bearer` scheme, `Content-Type` tricks, wrong-token-plus-right-header combos.
- Token not returned by `/api/v1/workspace` or `/health` (probe asserted absence); token is never logged (no logging exists); token is not committed (only `TEST_TOKEN` literals in tests) and not in the browser bundle (the gateway is a separate Node package, not part of the web build).
- `/health` is intentionally public and exposes only `{status, version, readOnly, vault: <vaultName>}` — no token, no paths, no counts. Vault name exposure is P3-minor.
- **Notable configuration caveat (documented behavior):** if no token is configured, ALL routes are open. That is a conscious local-loopback default; on loopback it is acceptable for Phase 1, but the docs should state explicitly that tokenless mode trusts anything local.
- CORS is not used and not claimed as a boundary. Timing-safe comparison is not used for the token (string `!==`); acceptable on loopback, P3 polish.

## 7. Path security — **PASS (zero escapes)**

The gateway reuses the authoritative `normalizeVaultPath` from `@okw/core` (rejects UNC, drive letters, `..` escapes at root, NUL, `:`; normalizes backslashes; strips leading/trailing slashes). It has **no independent weaker validator** — every path-bearing parameter (`notes/:path`, `entries?path=`, `search?pathPrefix=`) funnels through it.

Adversarial corpus (28 entries, raw `node:http` requests so client URL normalization cannot mask server behavior): `../`, `../../`, `%2e%2e/`, `%2e%2e%2f`, double-encoded `%252e%252e`, mixed `..\`, `%5c` forms, absolute POSIX, `C:`/`C%3A` drives, `c%3A%5C...` full Windows path, UNC `\\server\share`, `....//`, dot segments mid-path, `%00`/NUL, 4000-char path, and traversal via `pathPrefix`. Result: every entry returned `400 INVALID_PATH` or `404`, except two `200`s that resolve **inside** the vault (`Sub/Note.md/../../Welcome.md` → reads in-vault `Welcome.md`; `entries?path=%2Fetc%2F` → empty listing of nonexistent vault-relative `etc`). **Zero vault escapes.**

## 8. Read-only proof — **PASS (byte-identical vault)**

Vault snapshot (recursive sha256 of every file) taken before and after the full external test matrix: 100 unauthorized requests (all 401), 100 valid read/search requests, the 28-entry traversal corpus, method-override tricks (`X-HTTP-Method-Override`, `?method=`, `?_method=`), malformed methods (DELETE/POST/PUT/PATCH/OPTIONS/TRACE/HEAD/CONNECT), and auth-bypass attempts. **Snapshots are byte-identical in every case.** No mutation means no mutation.

## 9. Data exposure — **FAIL (P2): absolute path leak in error responses**

- DTOs are clean: no absolute paths, no `FileSystemHandle` objects, no secrets, no stack traces, no internal class state, no config/env.
- **P2 defect:** error responses leak implementation-sensitive absolute filesystem paths. `NodeFsVaultStorage` builds `StorageError("Failed to read \"<path>\": <fs err.message>")` where `err.message` embeds the absolute path (EACCES/ENOENT formats include `open 'C:\...\file.md'`); `toApiError` maps `StorageError` to `500 STORAGE_ERROR` passing the message verbatim, and the unknown-error fallback passes raw `err.message` as `500 INTERNAL_ERROR`.
- Reproduced deterministically by injecting an EACCES-style read error: the HTTP response contained `"Failed to read \"Welcome.md\": EACCES: permission denied, open 'C:\Users\...\ext-phase1-...\Welcome.md'"` — **full absolute path** (JSON-unescaped check: `absolute path leaked: true`). A parser failure returned the raw message `boom in parser at D:\vault\x.md:3`. Real reachable trigger: reading a path that exists but fails to read (e.g. permission-denied file, or a directory read returning EISDIR — the EISDIR case itself omitted the path on this Node build, but EACCES/ENOENT formats include it).
- The `toApiError` structure is otherwise good (stable codes `NOT_FOUND`/`INVALID_PATH`/`INVALID_REQUEST`/`UNAUTHORIZED`/`UNSUPPORTED`/`STORAGE_ERROR`/`INTERNAL_ERROR`); only the message content leaks.

## 10. Search / index reuse — **PASS**

Gateway search calls `workspace.search` → `index.query` (the shared `MemoryDocumentIndex`/`SearchEngine` from `@okw/index`). No per-request rescan, no full-vault reparsing, no second search algorithm, no per-request index construction. Measured on a 1k-note vault: workspace info 17 ms, read 3 ms, search 4 ms; 30 consecutive searches avg 14 ms / max 16 ms (no degradation, no leak-growth signal). The one-time 434 ms index rebuild happens at startup, outside the request path.

## 11. Single-authority model — **TRUTHFUL**

`EXTERNAL_ACCESS.md` and `DECISIONS.md` D-023 clearly distinguish **Browser-Direct Mode** (UI owns FSA storage) from **Gateway-Managed Mode** (gateway owns Node fs) and state a vault operates in exactly one mode at a time. No claim of automatic cross-mode coordination exists. Reproduced the dual-writer reality: a second independent `NodeFsVaultStorage`+coordinator stack on the same vault wrote successfully behind the running gateway (no lock, no guard) — the gateway then truthfully read the new content. So the hazard is real and unguarded, and the documentation correctly frames the single-mode rule as a usage requirement, not an enforcement claim. **Phase 1 does not falsely claim coordination.**

## 12. Local gateway lifecycle — **MOSTLY PASS (P2 packaging gap)**

Verified: starts cleanly (10 ms); shuts down cleanly (`stop()` closes the server); port configurable (`port: 0` dynamic + default 4200); port conflict produces a useful error (`EADDRINUSE: address already in use 127.0.0.1:<port>`); repeated restart x3 yields consistent results; read operations leave **zero** temp/lock junk in the vault (probe: `.okw.tmp`/`.lock` set unchanged after 40 requests).

**P2 gap:** `apps/gateway` ships **library code only** — `createGatewayServer`/`startGateway`/`runCli` exports, no `bin`, no launcher that wires `NodeFsVaultStorage` + `rebuildVaultIndex` + token + server into a runnable process. `EXTERNAL_ACCESS_PHASE1_REPORT.md` describes "a local gateway HTTP process (apps/gateway)" as delivered, but no process entry point exists; "invalid vault configuration rejected" and "inaccessible vault rejected" are therefore untestable end-to-end. The CLI is likewise a library function, not an executable.

## 13. REST contract — **PASS**

9 documented routes, all implemented, none undocumented, methods enforced (`405`), auth enforced (except `/health`), stable error codes, plain serializable JSON. DTO shapes stable (`WorkspaceInfo`, `NoteReadResult`, `SearchResultDTO`, `BacklinkDTO`, `OutgoingLinkDTO`, `PropertyMapDTO`, `GraphNeighborDTO`, `ApiErrorDTO`).

## 14. MCP status — **CONTRACT + HANDLER, runtime deferred (documentation P3)**

`packages/workspace/src/mcp.ts` ships 6 protocol-neutral tool declarations and a dispatcher; **no MCP server/transport (stdio/SSE) exists** — the runtime is deferred, which matches the approved Phase 1 scope (read-only). Verified: every tool is a thin adapter over `OpenObWorkspace` (zero storage/index access inside `mcp.ts`); traversal (`../../etc/passwd`) → `isError: true`; missing args → `isError: true`; unknown tool (incl. `openob_delete_note`) → `isError: true`; normal reads succeed. **P3:** `EXTERNAL_ACCESS.md` §6 does not explicitly say the MCP runtime/transport is deferred — it reads as if the tools are served today. Docs should state: declarations + handler shipped; transport deferred.

## 15. CLI status — **LIBRARY IMPLEMENTED, no executable (P2 packaging)**

`runCli` (in-process function) is machine-readable (`--json`), returns nonzero exit codes on failure (missing args, errors, traversal), rejects traversal through `workspace`, and never touches the filesystem directly. Verified: `read ../../etc/passwd --json` → exit 1 with parseable JSON; `read` without args → exit 1; `info --json` → readOnly true, no token. **P2:** not a standalone executable; stdout/stderr separation is caller-controlled (the function returns `{exitCode, output}` rather than writing to streams) — fine for embedding, undocumented for agents.

## 16. Web regression — **PASS**

The Phase 1 commit changes **zero** files under `apps/web`. Full e2e suite (open/edit/save/autosave/rename/delete/discard/property/AI/search/backlinks/real-OPFS) is 9/9 green at this HEAD; the persistence unit suite (R1-R8, H9-H17) is green (209 tests). No application-service refactor broke the product because no product code was touched.

## 17. Gateway vs sumo-sized-api — **PASS**

Zero code coupling to `sumosizedginger/sumo-sized-api` (grep of workspace/gateway sources: no hits). `EXTERNAL_ACCESS.md` §8 explicitly distinguishes them (OpenOb gateway = TypeScript monorepo package reusing `@okw/*`; sumo-sized-api = separate external FastAPI telemetry service). The gateway IS part of the monorepo and reuses OpenOb packages.

## 18. Performance — **PASS**

1k-note vault: one-time startup index rebuild 434 ms; gateway start 10 ms; `/api/v1/workspace` 17 ms; `/api/v1/notes/...` 3 ms; `/api/v1/search` 4 ms; 30× repeated search avg 14 ms / max 16 ms. No N+1 parsing (`readNote` parses a single note), no full vault rebuild per request, no per-request index/SQLite construction (single shared `MemoryDocumentIndex`). `getWorkspaceInfo` does `index.getAll()` + root `list()` per call — O(n) but measured acceptable; not premature micro-optimization territory.

## 19. Test credibility — **TRUTHFUL**

- `apps/gateway/__tests__/gateway.test.ts`: **protocol/integration** — starts a real HTTP server on a dynamic port and drives it with real `fetch` (real socket I/O, real URL decoding, real routing).
- `packages/workspace/__tests__/workspace.test.ts`: **unit/integration** — real `OpenObWorkspace` over real storage/index/parser; read-only mutation assertion; MCP tests invoke the real `handleMcpToolCall`.
- e2e: **real browser** (Playwright, real OPFS).
- No copied implementation logic in tests, no fake REST tests, no mocked workspace presented as e2e, no path tests bypassing routing/URL decoding (committed traversal tests go through `encodeURIComponent` + real fetch; my independent corpus used raw `node:http` for the non-normalizing case — both pass).

## 20. Required adversarial probes (A-G + extras) — all executed, results

| Probe                                                             | Result                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| A. 100 unauthorized requests                                      | all 401, vault byte-identical                        |
| B. 100 valid read/search requests                                 | no canonical change                                  |
| C. 28-entry path traversal corpus                                 | **zero vault escapes**                               |
| D. gateway restart loop x3                                        | consistent (noteCount stable)                        |
| E. 50 concurrent read/search requests                             | stable, all 200                                      |
| F. read while canonical changes externally                        | truthful new content, no corruption                  |
| G. large note (2 MB) / Unicode / nested path                      | stable serialization, exact round-trip               |
| + method/override tricks, auth-bypass attempts, MCP/CLI traversal | no mutation, all rejected                            |
| + error-mapping injection                                         | **P2 finding: absolute path leaked in 500 messages** |

## 21. Severity

**P0: none. P1: none.**

**P2:**

1. Error responses leak absolute filesystem paths (`STORAGE_ERROR` / `INTERNAL_ERROR` message passthrough) — reproduced; loopback-only, requires a storage/parser failure, but violates the no-implementation-path-leak requirement.
2. No runnable gateway/CLI executable — `apps/gateway` is library-only; the report overstates "a local gateway HTTP process"; lifecycle config-validation paths untestable end-to-end.

**P3:**

1. MCP runtime deferral not explicit in `EXTERNAL_ACCESS.md`.
2. REST subaction suffix shadowing for notes named `backlinks`/`links`/`properties`/`graph-neighbors` in subfolders.
3. `/health` exposes the vault name; token comparison not timing-safe; tokenless mode implicitly trusts loopback (should be documented).
4. `readOnly` flag and capability scopes are metadata (vacuously safe in Phase 1 — no write API exists; Phase 2 scopes are correctly documented as reserved, no false enforcement claims).

## 22. Phase 2 gate — **PROCEED TO EXTERNAL MUTATION PHASE**

Hard gate criteria: no P0/P1 ✓ · web regression suite green ✓ · adapters cannot bypass workspace service ✓ (grep + probes) · read-only guarantee proven ✓ (byte-identical vault) · path traversal blocked ✓ (28-entry corpus, zero escapes) · auth real ✓ (token mode, bypass attempts rejected) · gateway binds loopback by default ✓ · search/index reuse correct ✓ · single-authority model truthful ✓ · CI fully green ✓.

The two P2s are **not boundary-undermining**: the boundary is solid; the path leak is a message-content hygiene defect and the launcher is a packaging gap. **Recommendation:** proceed to Phase 2, with the P2 error-redaction fix (R1 below) landing first (cheap, and Phase 2's write paths will multiply the error surface) and the launcher (R2) landing at the start of Phase 2 so mutation endpoints are testable end-to-end. P3s are non-blocking polish.

The important question — does OpenOb now have ONE trustworthy application boundary humans and machines can share — is answered **yes**: every external interface funnels through `OpenObWorkspace`, the vault stayed byte-identical under the entire adversarial matrix, and the read-only foundation is real.
