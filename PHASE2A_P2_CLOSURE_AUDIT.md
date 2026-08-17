# PHASE2A_P2_CLOSURE_AUDIT.md

Closure re-audit of P2A-1 (oversized-body error contract) and P2A-2 (verify:full flake) at HEAD `59eba788fad474b78141dca9701dfe5e470c2c0d` (`fix(gateway,tests): remediate P2A-1 oversized body contract (413) and P2A-2 process test flake`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean except the pre-existing local `reasonix.toml`. Phase 2A architecture/concurrency findings were not re-opened (no new evidence against them).

## 1. Baseline

- Exact HEAD: `59eba788fad474b78141dca9701dfe5e470c2c0d` (on `origin/main`, no commits after).
- `npm ci` clean; `npm run build` PASS (esbuild bundles for gateway/CLI).

## 2. P2A-1 — Oversized body contract: **VERIFIED CLOSED**

Real HTTP probes against the real bundled gateway (`dist/bin/gateway.js`, 10 MB default limit), raw `node:net` sockets for precise framing:

| Case                                                    | Result                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-Length oversized (11 MB)                        | **HTTP 413**, JSON `{"code":"PAYLOAD_TOO_LARGE",…}`, `socketError=none` (no ECONNRESET), **zero canonical change** (target file not created) |
| Chunked oversized (11 MB, `Transfer-Encoding: chunked`) | **HTTP 413**, JSON `PAYLOAD_TOO_LARGE`, no hang, no socket error, file not created                                                           |
| Malformed JSON                                          | **400** `INVALID_REQUEST`                                                                                                                    |
| Below-limit (9 MB)                                      | **201**, bytes on disk exact                                                                                                                 |
| After all oversized attempts                            | `/health` 200, authenticated read still 200 (server unaffected)                                                                              |

Committed coverage: gateway test 27 asserts **both** Content-Length and chunked → 413 + `PAYLOAD_TOO_LARGE` + file-not-created (strong assertions, small 1 KB limit fixture). Root-cause fix verified in `server.ts`: upfront Content-Length check, and for chunked bodies `exceeded` flag + pause/resume drain + `PayloadTooLargeError` (maps to `413 PAYLOAD_TOO_LARGE` in `toApiError`); `end`/`error` handlers are guarded so the rejection is not clobbered and the socket is never destroyed before the response is written.

## 3. P2A-2 — CI/test flake: **VERIFIED CLOSED**

- **20/20 iterations** of the two process-spawning test files (`gateway-process-packaging.test.ts`, `gateway-external-mutations.test.ts`): 0 failures.
- **26 consecutive full-suite runs** at default parallelism (`npx vitest run`, 50 files / 246 tests): 0 failures (46+ green iterations including the 20-file loop; the formerly flaky committed TEST A never failed post-fix).
- The only failures observed inside the full suite during this audit were **my own temporary probe** (an 11 MB raw-socket chunked client that races under parallel load) — removed; the committed suite was green in every run.
- Fix hygiene verified — the remediation does **not** rely on prohibited patterns:
  - No retries (`grep` for retry patterns: none).
  - No arbitrary sleep inflation (the only `setTimeout(…,100)` calls are post-SIGTERM process-teardown waits, not flake dodging).
  - No weakened assertions (exit codes, status codes, and file-not-created checks all still asserted; TEST A still requires `/health` 200, 401 unauthenticated, 200 authenticated).
  - Root-cause fix confirmed in code: all process spawns now use `--port 0` + parse the printed bound port (no `getFreePort` TOCTOU); TEST F builds into a private temp `apps/gateway/.dist-clean-test-*` directory (`build.js --outdir`) instead of deleting the shared `dist` — eliminating both the port race and the shared-artifact race.

## 4. Regression — **PASS**

`npm run verify:full`: **exit 0** — format ✓, lint ✓ (0 errors, 4 pre-existing warnings), typecheck ✓, **50 files / 246 tests PASS** (all Phase 2A mutation tests — concurrency/scope/read-only/index-truthfulness/CLI/MCP — plus gateway packaging Tests A-G), build ✓, **e2e 9/9 PASS** (web regression: save/autosave/conflict/discard/rename/delete/property/AI/search/backlinks/real OPFS).

## 5. Remote CI

**REMOTE CI UNVERIFIED.** The environment cannot access GitHub Actions for this repository: `api.github.com/repos/sumosizedginger/OpenOb/actions/runs?head_sha=59eba78…` returns 404 and the repository API returns 404 (private/unlisted repo). Per the audit instruction this is reported as **UNVERIFIED**, not as non-existent. Local replay of the full gate (`verify:full`) is green; the `ci.yml` pipeline builds gateway+web artifacts and smoke-tests the CLI binary.

## 6. Verdict

# **READY FOR PHASE 2B**

- P2A-1 closed: oversized bodies (Content-Length and chunked) reliably return **HTTP 413 JSON `PAYLOAD_TOO_LARGE`** with no ECONNRESET/hang and zero canonical mutation; malformed → 400; below-limit → 201.
- P2A-2 closed: the process test flake is eliminated (26 consecutive full-suite passes; 20/20 on the process files; no retries/sleep-inflation/weakened assertions).
- `verify:full` passes (all Phase 2A mutation tests, 9 Playwright tests, production gateway/CLI packaging all green).
- Remote CI: UNVERIFIED (environment cannot access Actions for the private repo) — the only unconfirmed item, unchanged from every prior audit, not a Phase 2A blocker.
