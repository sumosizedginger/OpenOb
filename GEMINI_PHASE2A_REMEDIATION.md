# GEMINI_PHASE2A_REMEDIATION.md

Handoff from `EXTERNAL_MUTATIONS_PHASE2A_AUDIT.md` (HEAD `93a20dcf6796d43af0c3d498664195caf862a7a5`). Phase 2A product logic is verified sound (concurrency, scopes, read-only default, index truthfulness, boundary). Only unresolved work: two P2s (REST oversized-body contract; verify:full test-infra flake) and three P3s. Fix P2s before the next gate.

---

## P2A-1 — Oversized request body destroys the socket: client gets ECONNRESET, never a status

- **ID:** P2A-1
- **Severity:** P2 (error contract; client cannot distinguish "payload too large" from a crashed connection)
- **Scope:** `apps/gateway/src/server.ts`
- **Problem:** `readJsonBody` enforces `maxBodyBytes` (default 10 MB) by `req.destroy()` on overflow. The client receives a connection reset — no `413`/`400` response ever reaches it. The 10 MB limit is documented ("Enforces 10MB default request body limit (`maxBodyBytes`)"), but the observable behavior contradicts a clean enforcement contract.
- **Empirical evidence:** real bundled gateway, 11 MB body → `CLIENT ECONNRESET` (no HTTP status); `/health` still 200 after; 9 MB control body → `201`. `fetch`-level probe logged `oversized body -> CLIENT ECONNRESET`.
- **Exact reproduction:** `POST /api/v1/notes` with `Content-Type: application/json` and a body > 10 MB against the real gateway; observe ECONNRESET/no response.
- **Root cause:** `readJsonBody` destroys the socket on size overflow instead of writing an HTTP error response first; the rejection never materializes as a response.
- **Affected files:** `apps/gateway/src/server.ts` (`readJsonBody`).
- **Required change:** when the accumulated body exceeds `maxBytes`, stop consuming, send a proper response, then terminate: e.g. accumulate up to `maxBytes + 1`, then `res.writeHead(413, {...}); res.end(JSON.stringify({code:'PAYLOAD_TOO_LARGE', message:...}))` and destroy the socket _after_ the response is flushed (or use a bounded reject path that the outer handler can still answer with 400/413). Document the exact code in `EXTERNAL_ACCESS.md`/report ("413 PAYLOAD_TOO_LARGE").
- **Required regression test:** gateway test (real server): POST >limit body → assert a clean HTTP error status (413 preferred, 400 acceptable) with a JSON body; POST <limit body → normal handling; gateway still healthy afterwards.
- **Acceptance criteria:** an oversized request always receives a machine-readable HTTP error (never a bare ECONNRESET); the limit is documented as `413 PAYLOAD_TOO_LARGE`.
- **Dependencies:** none.
- **What NOT to do:** do not raise the limit silently; do not `req.destroy()` before writing the response; do not accept partial oversized bodies into memory (bounded accumulation only).

---

## P2A-2 — verify:full flake: gateway process tests race on free ports and shared dist

- **ID:** P2A-2
- **Severity:** P2 (test infrastructure; `npm test`/`verify:full` intermittently red)
- **Scope:** `tests/integrity/gateway-process-packaging.test.ts`, `tests/integrity/gateway-external-mutations.test.ts`
- **Problem:** two parallel test files spawn real gateway binaries. `TEST A` (packaging file) fails intermittently with "Child exited prematurely with code 1" under full parallel load (observed 3/10 full-suite runs; 0 at `--maxWorkers=2`; 0 in isolation).
- **Empirical evidence:** 3 observed failures in ~10 full runs at default parallelism; 16 consecutive passes with a stderr-instrumented variant; 3/3 passes at `maxWorkers=2`; always the same test (TEST A) failing.
- **Exact reproduction:** `npx vitest run` (default workers) repeatedly; ~1-in-3-4 runs fails TEST A with the spawned gateway exiting 1 before the "Listening" line.
- **Root cause:** (a) `getFreePort()` in both files is a bind-then-close TOCTOU — under parallel workers the just-freed port can be reallocated to another test's concurrently spawned gateway → the spawned binary exits 1 (`EADDRINUSE`); (b) TEST F does `fs.rm(apps/gateway/dist, {recursive:true})` + rebuild while the parallel `gateway-external-mutations.test.ts` spawns `dist/bin/gateway.js` → a spawn during the deletion window fails to load. Both are test-infra races, not product defects (the binaries are deterministic in isolation).
- **Affected files:** `tests/integrity/gateway-process-packaging.test.ts` (TEST A-F spawns + TEST F), `tests/integrity/gateway-external-mutations.test.ts`.
- **Required change:** (1) replace `getFreePort()` with `--port 0` and parse the actual bound port from the process output (the bin already prints `Listening on http://127.0.0.1:<port>`), matching the pattern the standalone probes used — this eliminates the TOCTOU entirely; (2) make TEST F rebuild dist into a **temporary copy** (`fs.cp(dist, tmpDist)` → delete/rebuild in the copy → verify artifacts) so it never destroys artifacts other parallel tests depend on; alternatively mark the two process files to run without file-parallelism (`fileParallelism: false` in vitest config or a sequence wrapper). Also attach the child's stderr to the failure message (as the temporary instrumentation did) so future flakes are diagnosable.
- **Required regression test:** the existing tests themselves are the regression suite; acceptance is N consecutive full-suite passes (e.g., 5× `npx vitest run` at default workers, 0 failures).
- **Acceptance criteria:** `npm test` and `npm run verify:full` pass reliably at default parallelism (≥5 consecutive green full runs); no test deletes a shared build artifact another parallel test reads.
- **Dependencies:** none.
- **What NOT to do:** do not disable parallelism globally; do not add sleeps to dodge the race; do not make the tests less adversarial (they should still spawn real binaries).

---

## P3A-3 — CLI `set-property` silently misinterprets flag-style args

- **ID:** P3A-3
- **Severity:** P3 (ergonomics)
- **Scope:** `apps/gateway/src/cli.ts`
- **Problem:** the contract is positional (`openob set-property <path> <key> [value] --expected-version <token>`), but flag-style usage (`--key x --value y`) silently creates a property literally named `--key` with value `x` (the `--value`/`--active` args are dropped). No error, surprising state.
- **Exact reproduction:** `openob set-property CliNote.md --key status --value active --expected-version <v>` → frontmatter `--key: status`.
- **Required change:** validate positionals: if any positional starts with `--`/`-`, print the usage and exit 1; optionally accept `--key/--value/--value-json` flags as an alternative documented form.
- **Required regression test:** CLI unit/integration: flag-style args → exit 1 with usage; positional form still works.
- **What NOT to do:** do not auto-reorder positionals; do not silently drop unrecognized args.

---

## P3A-4 — Leading-slash absolute path is normalized, not rejected

- **ID:** P3A-4
- **Severity:** P3 (documentation nuance)
- **Scope:** docs + tests
- **Problem:** `/abs.md` normalizes to vault-relative `abs.md` via the authoritative `normalizeVaultPath` (no escape; documented rule), while the audit brief asked for absolute-path rejection. The behavior is safe but should be explicit.
- **Required change:** document the normalization semantics for absolute-path inputs on mutation/read routes and add a workspace test asserting `/abs.md` lands at vault-relative `abs.md` (in-vault), alongside the existing traversal/drive/UNC rejection tests.
- **What NOT to do:** do not add a second, stricter validator that diverges from `normalizeVaultPath` (single-authority rule).

---

## P3A-5 — Audit trail not externally observable

- **ID:** P3A-5
- **Severity:** P3 (observability)
- **Scope:** `packages/workspace/src/audit.ts`, docs
- **Problem:** `InMemoryAuditSink` is in-process only; no REST endpoint or file/log sink exposes audit events, so external operators cannot inspect the Phase 2A mutation trail. Contents are verified correct and leak-free (no tokens/bodies/paths).
- **Required change:** document the in-memory-only scope in the Phase 2A report (truthful), or add an authenticated read-only `GET /api/v1/audit` (scoped `workspace.audit.read`) as a follow-up. Deferring with accurate docs is acceptable.
- **What NOT to do:** do not expose the audit sink unauthenticated; do not log bodies/tokens when adding a file sink.

---

## Execution order

1. **P2A-1** (REST oversized contract) — small, isolated.
2. **P2A-2** (test-infra flake) — needed for a reliable green gate.
3. **P3A-3/4/5** — opportunistic polish.

Phase 2B gate per the audit: the mutation logic itself is **READY** (no P0/P1, exact-one-winner, read-only default, forgery-proof scopes, adapter boundary clean, truthful index degradation, real binary flow verified). P2A-1 + P2A-2 must land before declaring a green next gate. Rename/delete remain out of scope.
