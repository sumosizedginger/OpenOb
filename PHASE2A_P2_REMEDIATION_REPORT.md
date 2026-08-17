# OpenOb — Phase 2A P2 Remediation Report

**Execution Context:**

- **Repository:** `https://github.com/sumosizedginger/OpenOb`
- **Starting SHA:** `93a20dcf6796d43af0c3d498664195caf862a7a5`
- **Role:** Foreman / Lead Engineer (Gemini)
- **Status:** COMPLETED & VERIFIED

---

## 1. Summary of Fixed Issues

### P2A-1 — Oversized REST Request Body Error Contract (HTTP 413)

- **Problem:**
  In `apps/gateway/src/server.ts`, `readJsonBody` previously called `req.destroy()` immediately when the accumulated body exceeded `maxBodyBytes` (10 MB default). Destroying the socket abruptly caused clients to receive `ECONNRESET` / socket hangup instead of a clean, machine-readable HTTP response.
- **Root Cause:**
  Immediate `req.destroy()` tore down the TCP connection before Node's HTTP server could write and flush an HTTP response headers/body.
- **Fix:**
  1. Added `Content-Length` pre-check in `readJsonBody`: if the `Content-Length` header exceeds `maxBodyBytes`, incoming data stream is drained (`req.resume()`) and immediately rejected with `PayloadTooLargeError`.
  2. For streamed/chunked payloads without `Content-Length`, data accumulation halts as soon as bytes exceed `maxBytes`, pauses buffering, drains remaining stream chunks, and rejects with `PayloadTooLargeError`.
  3. Added `PayloadTooLargeError` (`PAYLOAD_TOO_LARGE`, status `413`) in `@okw/workspace/src/errors.ts` and `types.ts`.
  4. Response is cleanly returned as HTTP `413 Payload Too Large` with JSON `{ "code": "PAYLOAD_TOO_LARGE", "message": "..." }` without crashing the socket or terminating the gateway process.
  5. Documented in `EXTERNAL_ACCESS.md`.
- **Permanent Regression Tests:**
  - Added Test 27 in `apps/gateway/src/__tests__/gateway.test.ts` verifying:
    - Content-Length oversized payload -> `413` JSON response.
    - Chunked oversized payload -> `413` JSON response without socket hangup.
    - Below limit payload -> `201 Created` / accepted.
    - No note or filesystem mutation occurs for rejected oversized requests.
    - Gateway `/health` remains `200 ok` after oversized request attempts.

---

### P2A-2 — Elimination of `verify:full` Test-Infrastructure Flakes

- **Problem:**
  `tests/integrity/gateway-process-packaging.test.ts` TEST A intermittently failed with `Child exited prematurely with code 1` during parallel full-suite runs (`verify:full`).
- **Root Causes:**
  1. **Dynamic Port TOCTOU:** `getFreePort()` in process test files used a bind-then-close pattern. Under parallel vitest workers, another concurrently running test could claim the closed port before the spawned gateway child process could bind to it, causing `EADDRINUSE`.
  2. **Shared Dist Deletion Race:** TEST F previously ran `fs.rm(apps/gateway/dist)` while other tests running concurrently in parallel workers were actively reading or spawning `apps/gateway/dist/bin/gateway.js`.
  3. **Parallel Build Script Collisions on Windows:** Multiple test files running `build.js` simultaneously raced on `fs.rm(dist)` which failed with Windows `EPERM: operation not permitted, rmdir`.
- **Fix:**
  1. **Dynamic Ephemeral Port Binding (`--port 0`):** Both `gateway-process-packaging.test.ts` and `gateway-external-mutations.test.ts` now spawn gateway binaries with `--port 0`. The operating system kernel assigns a guaranteed free ephemeral port, and the tests parse the announced URL/port from the stdout readiness signal (`[OpenOb Gateway] Listening on http://127.0.0.1:<port>`).
  2. **Isolated Build Target for TEST F (`--outdir`):** Updated `apps/gateway/build.js` to support `--outdir`. TEST F builds into an isolated temporary directory within the package tree (`apps/gateway/.dist-clean-test-<timestamp>`), tests the clean build, and cleans it up without touching `apps/gateway/dist`.
  3. **Removed Destructive `fs.rm` in `build.js`:** Esbuild atomically replaces bundle outputs; removing redundant directory deletion prevents Windows `EPERM` collisions.
  4. **Diagnostic Stderr Attachment:** If child process startup fails, the rejection error message includes the child's captured `stderr`.
- **Repeated-Run Evidence:**
  - `npx vitest run tests/integrity/gateway-process-packaging.test.ts tests/integrity/gateway-external-mutations.test.ts`: **5 consecutive runs, 9/9 tests passed each run (100% green)**.
  - `npm test`: **3 consecutive full-suite runs (50 files / 246 tests), 0 failures**.

---

### P3 Additions (Ergonomics, Path Normalization, Audit Docs)

- **P3A-3 (CLI `set-property` Positional Validation):**
  - Updated `apps/gateway/src/cli.ts` to reject flag-style misuse (e.g. `--key status --value active`) on `openob set-property` with exit code `1` and usage guidance.
  - Added Test 28 in `apps/gateway/src/__tests__/gateway.test.ts`.
- **P3A-4 (Leading-Slash Path Normalization):**
  - Documented that leading slashes (`/Welcome.md`) normalize to vault-relative paths (`Welcome.md`) via `normalizeVaultPath`.
  - Added Test 15 in `packages/workspace/src/__tests__/workspace.test.ts`.
- **P3A-5 (Audit Trail Scope):**
  - Documented in `EXTERNAL_ACCESS.md` that Phase 2A audit logging is in-memory via `InMemoryAuditSink` / injectable `AuditSink`.

---

## 2. Verification & Quality Gates

| Quality Gate           | Result   | Notes                                                 |
| :--------------------- | :------- | :---------------------------------------------------- |
| `npm run format:check` | **PASS** | Prettier code style verified                          |
| `npm run lint`         | **PASS** | ESLint clean (0 errors, 4 pre-existing warnings)      |
| `npm run typecheck`    | **PASS** | `tsc --build` clean across all packages and apps      |
| `npm test` (vitest)    | **PASS** | **50 test files / 246 unit & integration tests PASS** |
| `npm run build`        | **PASS** | Gateway and Web application bundles generated         |
| `npm run test:e2e`     | **PASS** | **9/9 Playwright E2E browser tests PASS**             |
| `npm run verify:full`  | **PASS** | Full verify + Playwright E2E suite clean              |

---

## 3. Git Details

- **Starting SHA:** `93a20dcf6796d43af0c3d498664195caf862a7a5`
- **Ending SHA:** (Recorded upon commit/push)
