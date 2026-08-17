# EXTERNAL_MUTATIONS_PHASE2B_AUDIT.md

Adversarial audit of Phase 2B external rename/delete at HEAD `853022209fb39afc806ae9519abc567d228d8c40` (`feat(workspace): implement Phase 2B external structural mutations (rename + delete)`). **AUDIT ONLY** — no production code modified; temporary probes removed afterward; working tree clean except pre-existing `reasonix.toml`.

## 1. Baseline

- Exact HEAD: `853022209fb39afc806ae9519abc567d228d8c40` (on `origin/main`, no commits after).
- Clean state (`rm -rf apps/gateway/dist packages/*/dist` + `npm ci` + `npm run typecheck` + `npm test`): **PASS** — 51 files / **263 tests** (246 Phase 2A + 17 Phase 2B).
- `npm run verify:full`: **PASS (exit 0)** — format/lint/typecheck/263 tests/build/**e2e 9/9**.
- Remote CI: **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT** — `api.github.com` returns 404 for the SHA and the repo (private/unlisted); the environment cannot access GitHub Actions. Reported as unverified, not non-existent.

## 2. Application boundary — **PASS**

All structural mutations flow `REST/CLI/MCP → OpenObWorkspace.renameNote/deleteNote → structural machinery → SafeWriter/VaultStorage → index`. Grep across adapters: the only mutation-API hits are `workspace.renameNote({…})` / `workspace.deleteNote({…})` calls in `server.ts`, `cli.ts`, `mcp.ts` — zero direct `storage.write/remove`, `safeWriter`, `coordinator`, `index.upsert/remove`, or `fs.writeFile` outside `workspace.ts`. Bundled CLI: the two `workspace.renameNote/deleteNote` occurrences are the in-process **test-harness path** (`runCliDirect`, requires an injected workspace); the production remote path is pure REST with no storage/index construction.

## 3. Authorization — **PASS**

Real gateway with no scopes → rename/delete **403** (probe). Scope isolation verified in-process and over HTTP: `workspace.write` alone → rename and delete **denied**; `workspace.rename` alone → rename **allowed**, delete **denied**; `workspace.delete` alone → delete **allowed**, rename **denied**. Forged headers/body/query scopes cannot elevate (server-configured scopes, unchanged from Phase 2A). Default read-only gateway → both **403** with vault bytes untouched.

## 4. Rename OCC / races — **PASS (deterministic)**

Structural design: a writer-preferring reader–writer gate (`StructuralGate`) — rename/delete take the **exclusive** lock (the whole operation incl. backlink rewrites), update/property take **shared** locks; no nested gate acquisition → **no deadlock by construction** (verified by stress).

| Race                                 | Result (probed)                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rename vs update, same V1 (× 8)      | **exactly one winner**; no ghost old file, no duplicate target; if rename wins, target has v0 and old is gone; if update wins, source has the update and no target exists                                                             |
| two renames, same source             | exactly one winner; loser rejected; only the winner's target exists; old path gone                                                                                                                                                    |
| rename vs create-target              | exactly one winner; if create wins, target holds the created content and source intact; if rename wins, target holds v0 and source gone                                                                                               |
| backlink-source update racing rename | **no silent loss**: the human update either lands (content present) or receives a truthful **409 conflict**; the final file is never in a split state (links all-old or all-rewritten; probed `oldLinks=0 newLinks=2 human=conflict`) |

Pre-delete re-check: after writing the target, the source's version is re-verified before removal — an external modification aborts with a conflict and the target is removed (no ghost/duplicate).

## 5. Rename correctness — **PASS**

- Source `expectedVersion` **required** (missing → `InvalidRequestError`); target must not exist (**ConflictError**, no overwrite path).
- Nested paths (`Sub/A.md → Sub/Deeper/A2.md`) work; **frontmatter preserved**; **self-links rewritten** to the new basename; **fenced and inline code untouched** (`[[not-a-link]]` inside ` ``` ` and backticks preserved byte-for-byte).
- **Degraded index → rename refuses** (`IndexDegradedError`: "Cannot execute safe rename… Rebuild/verify required") — it never knowingly uses stale backlink data.

## 6. Rename failure injection — **PASS**

- Backlink rewrite failure mid-set (injected on the 2nd referencing file): **full transactional rollback** — source restored, target removed, both linkers intact with original links; no `[[M1x]]` anywhere; **no false success**.
- Rollback is version-protected (`expectedVersion = updatedVersion` per rewritten file) — **cannot overwrite a newer edit**; if a rollback write conflicts, `RecoveryRequiredError` surfaces with `indexHealth='degraded'` (explicit recovery-required state, not silence).
- Index upsert failure after durable rename: response `durableSuccess=true, indexStatus=degraded, indexError=…`; canonical authoritative (new path exists, old gone); **no false rollback** because the disposable index failed.
- No unconditional/force writes found in the rename path (every canonical write carries `expectedVersion`).

## 7. Delete — **PASS**

- `expectedVersion` **mandatory**; stale token → **409**; missing note → **404**; folder path rejected; no force path (grep + probe).
- delete vs update (same V1): **exactly one winner** — delete wins → no resurrection; update wins → content present (no silent lost update).
- Double delete: exactly one success, one rejection; no resurrection.
- **Inbound-link source files remain byte-unchanged** (probe: `Linked.md` byte-identical after deleting its target); deleted links simply become unresolved.

## 8. Index truthfulness — **PASS**

Injected index failures after successful rename/delete: canonical operation remains authoritative, result reports `durableSuccess: true` with `indexStatus: 'degraded'` + `indexError`; no false rollback. Rename additionally refuses while degraded.

## 9. External process boundary — **PASS (truthful)**

Docs (`EXTERNAL_ACCESS.md` §1/§3) state the single-authority boundary and the mode-exclusivity rule as a usage requirement; no claim that arbitrary external filesystem writers are atomically excluded. Within gateway authority, races are deterministic (gate + OCC + pre-delete re-check). The unavoidable final filesystem TOCTOU for external writers (recheck→commit) remains the documented best-effort limit from the storage-layer audits (F-039) — not overclaimed.

## 10. Real artifacts — **PASS**

Isolated esbuild bundles (unique `--outdir`, never shared dist). Real gateway + real CLI: create → read V1 → **REST rename** (200, self-link rewritten, old file gone on disk) → **CLI rename** (exit 0, disk verified) → **CLI delete** (exit 0, disk verified); **stale-version rename → 409**; **stale delete → 409**; **rename/delete without scopes → 403** with vault intact.

## 11. Regression — **PASS**

Phase 2A fully green: create/update/property, same-version exact-one-winner concurrency (20× in-process + 10× HTTP in the Phase 2A audit; re-verified via the 263-test suite), P2A-1 413 contract, process isolation (test 20 + integrity files), packaging Tests A-G, **e2e 9/9** (web save/autosave/conflict/discard/rename/delete/property/AI/search/backlinks/OPFS).

## 12. Severity

**P0: none. P1: none.**

**P2: none found.** (The only behaviors worth noting are safety-preserving by design: rename refuses on a degraded index; a concurrent human edit on a backlink source gets a truthful 409 rather than a silent merge.)

**P3 (docs/ergonomics, non-blocking):**

1. Rename with backlink-source contention returns 409 to the human editor — document the retry expectation in `EXTERNAL_ACCESS.md`.
2. `IndexDegradedError` on rename while degraded — already surfaced; add a doc note that rename requires a verified index.
3. CLI `rename`/`delete` positional-vs-flag arg handling follows the Phase 2A `set-property` pattern — the flag-style misuse note (P3A-3) applies equally; not yet validated.

## 13. Verdict

# **PHASE 2 EXTERNAL MUTATIONS COMPLETE**

- No P0/P1 remains.
- Rename races are deterministic (exactly-one-winner across all four race classes, no ghost/duplicate/split state).
- Delete cannot erase newer content (mandatory OCC, 409 on stale, no resurrection, inbound links byte-unchanged).
- Rollback cannot overwrite newer edits (version-protected rollback; `RecoveryRequiredError` surfaces any rollback failure).
- Scopes are isolated (rename/delete require distinct scopes; forgery fails; default read-only 403).
- Canonical/index truthfulness holds (degraded reporting, no false rollback, rename refuses while degraded).
- Real isolated-esbuild gateway + CLI rename/delete flow works with disk verification.
- `verify:full` green (263 tests + 9 e2e). Remote CI: **UNVERIFIED IN THIS ENVIRONMENT** (environment cannot access Actions for the private repo).
