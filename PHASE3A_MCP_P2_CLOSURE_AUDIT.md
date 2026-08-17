# PHASE3A_MCP_P2_CLOSURE_AUDIT.md

Re-audit of the three Phase 3A P2 findings at HEAD `247e9e7dd6d16843586358e35056f08a11078486` (`fix(mcp): resolve Phase 3A P2-1, P2-2, and P2-3 findings`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean (deliverables + pre-existing `reasonix.toml`).

## 1. Baseline

| Step                                                                                             | Result                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Exact HEAD                                                                                       | `247e9e7dd6d16843586358e35056f08a11078486` (on origin/main, no commits after)                                                            |
| Clean (`rm -rf apps/gateway/dist packages/*/dist` + `npm ci` + `npm run typecheck` + `npm test`) | **PASS** — 52 files / **273 tests**                                                                                                      |
| `npm run verify:full`                                                                            | **PASS (exit 0)** — 273 tests + build + **e2e 9/9**                                                                                      |
| Remote CI                                                                                        | **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` 404 for the SHA (private repo); reported as unverified, not non-existent |

Note: the first `verify:full` run failed the 10,000-note performance budget (`searchDurationMs 1151 > 500`) because the 13.4 s scale benchmark saturated the machine in the parallel runner; the benchmark passes standalone (1006 ms) and the immediate re-run of `verify:full` was green (exit 0). The P2 commit touches only MCP files — the index/benchmark are untouched; this is environment-load noise, not a regression.

## 2. P2-1 — Process survival — **CLOSED**

Inspected the actual transport-level protection (not Zod-only): `apps/gateway/src/stdio-transport.ts` replaces the SDK's default stdio transport with `SafeStdioServerTransport` — a custom line-parsing `_onData` loop with a **bounded buffer capped at `maxMessageBytes` (10 MB)**. When an inbound message exceeds the cap it enters discard mode, drains the rest of the line piece-by-piece (memory stays bounded), logs one line to stderr, and replies to the client with a structured JSON-RPC error `-32600 … PAYLOAD_TOO_LARGE` — then continues serving. Malformed JSON → `-32700 Parse error`; non-object JSON → `-32600`; `onmessage` exceptions route to `onerror` (logged, not fatal). `bin/mcp.ts` wires it via `serveStdio(server, { transport, onerror })` and the process has no exit path on message errors. Zod `.max(10 MB)` on `content` remains as defense-in-depth; the transport is the first line and is what makes the guarantee hold.

**Live adversarial probe against the REAL built `openob-mcp` (one process, raw JSON-RPC):**

| #   | Requirement                                         | Result                                                                                                                                                                                   |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | normal request works                                | initialize + `tools/list` (11 tools) — **PASS**                                                                                                                                          |
| 2   | just-below-limit request works                      | create note with ~9.8 MB content → **201, 10,280,960 bytes on disk**                                                                                                                     |
| 3   | >limit request rejected without termination         | 11 MB → `-32600 PAYLOAD_TOO_LARGE`, child alive                                                                                                                                          |
| 4   | 20–50 MB adversarial requests do not kill server    | 20/30/40 MB content → all `-32600`, child alive                                                                                                                                          |
| 5   | malformed MCP/JSON does not kill server             | garbage + truncated JSON → `-32700`, child alive                                                                                                                                         |
| 6   | same-process recovery after EVERY attack            | after each of 96 attack events: `workspace_info` + `read_note` both succeed on the **same process**                                                                                      |
| 7   | attack/recovery cycle repeated 20+ times            | **96 attack events** (48 oversized 11–40 MB + 48 malformed) with 48 recovery pairs on ONE process — child never exited                                                                   |
| 8   | rejected oversized mutation → zero canonical change | vault snapshot (recursive file list + contents) **byte-identical** before/after; `Attack.md` never created                                                                               |
| 9   | memory bounded, no unbounded accumulation           | RSS 161 MB → 303 MB (mid-sample) → **127 MB** after the second equal attack block (GC reclaimed; ended below baseline) — plateau, not linear growth; per-message memory capped by design |
| 10  | stdout protocol-only                                | 195 captured lines, every one valid JSON-RPC                                                                                                                                             |
| 11  | stderr no token/secret                              | no `TOKEN`, `Bearer`, `Authorization` in stderr; `[openob-mcp]` diagnostics only                                                                                                         |

Also: EOF still exits cleanly (code 0). The committed regression suite `tests/integrity/mcp-stdio-transport.test.ts` test 8 covers the same surface (11 MB + 25 MB + 5 recovery cycles) and passes.

## 3. P2-2 — update_note frontmatter contract — **CLOSED**

- The `openob_update_note` tool description **in the production bundle** now states: _"…replaces the entire file content; existing frontmatter properties will be overwritten unless explicitly included in content. Use openob_set_property for individual property modifications."_ (both in `apps/gateway/src/mcp-server.ts` and the shared declarations `packages/workspace/src/mcp.ts`).
- **Original reproduction re-run** (no weakened assertions): create with `properties: {tags:['a']}` → disk `tags: [a]`; content-only update with fresh version token → `isError=false`, disk exactly `"new body"` (documented deterministic behavior); then `set_property` restores `tags: [a]` — the documented path works. Committed test 9 asserts the description contract; passes.

## 4. P2-3 — sql.js packaging — **CLOSED**

- `sql.js: "^1.14.2"` now declared in `apps/gateway/package.json` dependencies.
- `npm ls sql.js` → direct dependency of `@okw/gateway` (plus `@okw/index`); no longer hoisting-dependent.
- The production gateway bundle still resolves `sql.js` at runtime; packaging Tests A–G green. Committed test 10 asserts the declaration; passes.

## 5. Architectural regression — **PASS**

- Production `openob-mcp` bundle re-grepped: **zero** occurrences of `NodeFsVaultStorage`, `SafeWriter`, `NoteWriteCoordinator`, `DocumentIndex`, `fs.writeFile`, `storage.write`, `storage.remove` — chain remains `openob-mcp → REST gateway → OpenObWorkspace`.
- **All 11 tools exercised** over the real transport (info/list/read/search/backlinks/properties/create/update/set_property/rename/delete), canonical disk verified.
- **OCC intact**: stale update → 409 `isError`; file unchanged.
- **Authorization intact**: default read-only gateway → create → 403, nothing written; scoped gateway full flow works.
- Committed MCP suite tests 1–10 (incl. single-authority invariant test 7, read-only 403 test 4, full mutation lifecycle test 5) — **all 10 pass**.

## 6. Full gate

- Clean-state suite: **52 files / 273 tests PASS**; `verify:full` exit 0 (e2e 9/9).
- Real production artifacts runnable (isolated esbuild bundles): `openob` (`bin/cli.js`), `openob-gateway` (`bin/gateway.js`), `openob-mcp` (`bin/mcp.js`); `package.json` `bin` map verified; CLI/MCP `--help` exit 0.
- **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — GitHub Actions inaccessible (404 for the private repo; no Node 20/Node 22/Playwright/packaging status obtainable).

## 7. Severity

**P0: none. P1: none.** All three P2s closed with permanent regression coverage:

- P2-1 → `SafeStdioServerTransport` (bounded buffer + discard mode) + committed adversarial test (11/25 MB, malformed, recovery cycles) + this audit's 96-event/40 MB probe.
- P2-2 → documented tool description (bundle + declarations) + committed contract test + deterministic original reproduction.
- P2-3 → declared `sql.js` dependency + committed packaging test.

**P3 (no change):** Windows SIGTERM/SIGINT terminate via signal without running JS handlers (Node platform behavior; handlers cover POSIX); EOF graceful exit verified.

## 8. Verdict

# **LIVE MCP TRANSPORT COMPLETE**

P2-1, P2-2, and P2-3 are closed. The **same** `openob-mcp` process survives 96 adversarial oversized (11–40 MB) and malformed inputs across two attack blocks, rejects them with truthful JSON-RPC errors (`-32600`/`-32700`), produces **zero canonical vault change**, keeps memory bounded (RSS ends below baseline — GC plateau), keeps stdout 100% protocol, leaks no secrets on stderr, and continues serving valid `workspace_info`/`read_note`/all-11-tool requests after every attack. Architecture stays `openob-mcp → REST gateway → OpenObWorkspace` with no direct vault access; authorization and OCC semantics intact; clean-state suite 273 tests + `verify:full` + 9 e2e green. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**
