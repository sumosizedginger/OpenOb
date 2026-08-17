# EXTERNAL_MUTATIONS_PHASE2A_AUDIT.md

Audit type: **read / test / analyze only**. No production code modified (the packaging test file was temporarily instrumented for diagnosis and restored byte-identical; verified `git diff` empty). Temporary probes (in-process workspace matrix; real bundled `dist/bin/gateway.js` + `dist/bin/cli.js` process spawns; raw HTTP) were used and **removed afterward**. Working tree clean except the pre-existing local `reasonix.toml`.

## 1. Exact SHA & baseline

- **HEAD:** `93a20dcf6796d43af0c3d498664195caf862a7a5` — `feat(workspace,gateway): implement Phase 2A external mutations with optimistic locking and capability enforcement`. No commits after on `origin/main`.
- `npm ci` clean (0 vulnerabilities). `npm run verify:full`: **flaky** — full suite (50 files / 243 tests) passes most runs but **TEST A in `tests/integrity/gateway-process-packaging.test.ts` fails intermittently under parallel load** (observed 3 failures in ~10 full runs; zero failures with `--maxWorkers=2`; zero in isolation). See P2-2.
- Remote GitHub Actions for the SHA: **404** (private repo — consistent with every prior audit; locally replayed).

## 2. Application boundary — **PASS**

All mutations flow `REST/CLI/MCP → OpenObWorkspace → SafeWriter → VaultStorage → index`. Grep across `apps/gateway/src` + `packages/workspace/src` (excl. tests): zero direct `storage.write/remove`, `SafeWriter`, `NoteWriteCoordinator`, `index.upsert/remove`, `fs.writeFile`, or frontmatter-helper calls outside `workspace.ts`. The three mutation methods (`createNote`, `updateNote`, `setProperty`) run: capability check → authoritative path resolve → `withPathLock` per-path mutex → SafeWriter with `expectedVersion` → storage optimistic check → index upsert (degradation-aware) → audit record. The workspace internals are `private` (compile-time); adapters use methods only. **No adapter backdoor.**

## 3. Default remains read-only — **PASS (proven at process level)**

Real bundled gateway started with **no `--scopes`** (default): `POST /api/v1/notes` → **403**, `PUT /api/v1/notes/Seed.md` → **403**, `PATCH .../properties` → **403**; reads/search still 200; vault bytes untouched. Mutation permissions require explicitly granted scopes (`--scopes workspace.write,...`).

## 4. Authorization — **PASS**

In-process scope matrix (real workspace): `workspace.write` alone → create/update OK, `setProperty` → Forbidden; `properties.write` alone → setProperty OK, body update → Forbidden; empty-scope context → all mutations Forbidden. **Forgery cannot elevate**: the server computes `clientContext.scopes` **entirely from server config** (`scopes ?? ['workspace.read','workspace.search']`); probes sent forged `X-OpenOb-Scopes`, `X-OpenOb-Client-Id`, body `scopes`, query `?scopes=` — all still **403** against a read-only-scoped gateway. Missing/wrong token → **401** (verified over HTTP).

## 5. Optimistic concurrency — **PASS (the critical audit)**

Same note, same version V1, two concurrent updates:

- In-process: **20/20 runs → exactly one fulfilled + one `ConflictError`**, final canonical equals the winner's content exactly (no merge).
- Over real HTTP (10 runs): statuses exactly `[200, 409]`, disk equals the winner exactly.
- Same-path concurrent create → exactly one 201/fulfilled, one 409/ConflictError.
- Property V1 vs body update V1 → exactly one winner; disk is the winner's output, never a merge.
- Different paths concurrently → both succeed.

No last-write-wins silent overwrite anywhere. Enforcement: `withPathLock` serialization + SafeWriter pre-check + storage-level expectedVersion check (authoritative).

## 6. Version contract — **PASS**

`readNote` returns a version token usable by update/property. After a successful mutation, the old version is stale: **stale update → 409 CONFLICT, stale property → 409** (HTTP and workspace). No hidden `force`/`overwrite`/`ignoreVersion`: passing these fields on an update with a stale version still **conflicts** (probe-verified). Missing `expectedVersion` → rejected (not 500).

## 7. Canonical / index truthfulness — **PASS**

Injected `index.upsert` failure after a durable update: response `durableSuccess=true, indexStatus=degraded, indexError="injected index.upsert failure"`; canonical on disk contains the successful mutation (**no rollback, no false failure**); search/index visibly stale until `rebuildVaultIndex` restores consistency (verified). Truthful degradation reporting confirmed.

## 8. Create — **PASS**

New note uses `expectedVersion=null` semantics; existing path → `ConflictError`; nested paths, spaces, Unicode (`Sub Folder/日本語 ノート.md`) work; index updated after durable success (search finds it). Traversal (`../evil.md`), drive (`C:/evil.md`), UNC, and dot-segment escapes → rejected. **Nuance (P3):** a leading-slash absolute path `/abs.md` is _normalized_ to vault-relative `abs.md` by the authoritative `normalizeVaultPath` rule (no escape, documented semantics) — not rejected.

## 9. Update — **PASS**

`expectedVersion` required (missing → error, not 500); stale → 409; BOM preserved on property mutations (verified `\uFEFF` prefix and CRLF survive `setProperty`); full-body update writes exactly the bytes given (2 MB note OK); oversized body handling has a defect — see P2-1.

## 10. Property mutation — **PASS**

`expectedVersion` required; unrelated frontmatter keys preserved (`title`, `tags`, `count`, `flag` all survive setting a new key); body preserved byte-for-byte; one key doesn't erase others; `value: null` removes the key; numbers/booleans/arrays serialize and round-trip (`count: 3`, `flag: true`, `list: [1, two, true]`); **YAML injection safe** — a hostile value (`\n---\nsteal: true\n`) round-trips as ONE quoted string property (`properties.evil === '\n---\nsteal: true\n'`, no `steal` key) via `serializeYamlValue` (JSON-quoting). All property mutations go through SafeWriter with version checks — no bypass.

## 11. Audit trail — **PASS (in-process; not externally observable — P3)**

`InMemoryAuditSink` events record timestamp, requestId, clientId, operation, path, success, previousVersion, currentVersion, grantedScope, indexStatus, errorMessage. Verified contents: **no bearer tokens, no API keys, no note bodies, no absolute paths** (probe asserts all four). Conflicted attempts are recorded truthfully (`success=false, errorMessage="Conflict…"`). **P3:** the audit sink is in-memory only — no REST endpoint or log sink exposes it; external observers cannot inspect the trail.

## 12. REST — **PASS** (with P2-1)

Routes: `POST /api/v1/notes` (201 create), `PUT /api/v1/notes/:path` (200 update), `PATCH /api/v1/notes/:path/properties` (200 set-property). No rename/delete/AI routes exist. Status codes verified: 201/200/400 (malformed JSON + invalid path)/401/403/404/409; **oversized payload → connection reset instead of 413 — P2-1**.

## 13. CLI — **PASS** (with P3-1)

Real `dist/bin/cli.js` against the running gateway: `create`/`update`/`set-property` all succeed (exit 0) and the vault bytes are verified on disk after each. Nonzero exit on 401/403/404/409/bad args/gateway-unavailable; **conflicts are not retried** (probe: stale update → exit 1 immediately). The CLI bundle contains no storage/index construction (pure REST client, re-verified). **P3-1:** `set-property` is positional (`<path> <key> [value]`); passing flag-style `--key x --value y` silently creates a property literally named `--key` with value `x` instead of erroring.

## 14. MCP — **PASS**

Live MCP transport remains deferred (documented — not penalized). Protocol-neutral tools exactly: `openob_create_note`, `openob_update_note`, `openob_set_property`. Handlers delegate only to `OpenObWorkspace` methods (scope + expectedVersion enforced by the workspace); no rename/delete tools exist (grep). Committed test 25 + workspace test 13 cover the dispatcher.

## 15. Process-level adversarial — **PASS**

Real bundled gateway + CLI: default read-only → 403s (create/update/set-property), reads OK; scoped gateway → full flow `create Test.md → read V1 → update V1→V2 → set-property V2→V3`, bytes verified on disk at each step (`status: active` + body preserved); stale V1 → 409; default gateway CLI create → exit 1, file not created.

## 16. Regression — **PASS (with P2-2)**

Web e2e 9/9 green (save/autosave/conflict/discard/rename/delete/property/AI/search/backlinks/real OPFS). Persistence suite green. **P2-2:** `verify:full`/`npm test` is intermittently red due to a test-infrastructure flake (see below) — not a web/product regression.

## 17. Findings

**P0: none. P1: none.**

**P2:**

1. **Oversized request body → connection reset, no HTTP status.** `readJsonBody` calls `req.destroy()` on bodies over `maxBodyBytes` (10 MB default), so the client receives **ECONNRESET** — the documented "enforces 10MB limit" is real but the error contract is broken: no 413/400 response reaches the client. Reproduced with an 11 MB body (ECONNRESET, gateway survives, 9 MB control → 201). Affected: `apps/gateway/src/server.ts` (`readJsonBody`).
2. **`verify:full` flake: `gateway-process-packaging.test.ts` TEST A fails intermittently under parallel load** (observed 3/10 full runs; 0/16 with instrumentation; 0/3 at `maxWorkers=2`; 0 in isolation). Root cause: the process-spawning tests use `getFreePort()` — a bind-then-close TOCTOU — so under parallel vitest workers the "free" fixed port can be taken by another test's concurrently spawned gateway → the spawned binary exits 1 (`EADDRINUSE`); TEST F additionally `rm -rf`s the shared `apps/gateway/dist` while the parallel `gateway-external-mutations.test.ts` spawns those binaries. Test-infrastructure defect, not a product defect (the binaries are deterministic in isolation). Makes the gate criterion "verify:full passes" unreliable.

**P3:**

1. CLI `set-property` flag-style misuse silently misinterprets args (positional contract not validated).
2. Leading-slash absolute path normalized (not rejected) — documented `normalizeVaultPath` semantics; add explicit doc/assertion.
3. Audit trail not externally observable (in-memory sink only).

## 18. Phase 2B recommendation

The Phase 2A product is verified: no P0/P1; exact-one-winner concurrency; default read-only; scope forgery fails; adapters cannot bypass `OpenObWorkspace`; canonical/index failure reported truthfully; real bundled gateway+CLI mutation flow works end-to-end; web regression green. **Two P2s must be fixed before Phase 2B/next release gate** because they undermine CI reliability and the REST error contract:

1. `readJsonBody`: respond with a clean `413` (or readable 400) **before** destroying the socket (buffer cap + reject + send response, or `res.writeHead(413)` + end, then destroy).
2. Process-spawning tests: replace `getFreePort()` with `--port 0` + parse the printed port (the bin already supports it), and/or run the gateway-process files serially; move TEST F's dist deletion to a temp copy so it cannot race parallel binary spawns.

Verdict: **READY FOR PHASE 2B, contingent on P2-1 + P2-2 remediation** (both are small, well-scoped, and outside the verified mutation logic). Rename/delete remain out of scope as instructed.
