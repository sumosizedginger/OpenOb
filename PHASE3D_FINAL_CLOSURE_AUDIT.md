# OpenOb — Phase 3D Final Closure Re-Audit (P3D-P1 + P3D-P2)

**Audited HEAD:** `e582250ef77d13e02e7b6ba64090c3b50270aac0` (`e582250 docs: record final ending commit SHA in closure report`, child of `64e102c fix(query): enforce strict typed comparisons and resolve format gate (R3D-1, R3D-2)`)
**Audit mode:** read-only; no production code modified; temporary probes built from current source, run, and removed; working tree clean.
**Scope:** P3D-P1 (mixed-type ordered-comparison coercion) and P3D-P2 (format/verify gate) only. Phase 3E not audited.

---

## 1. Baseline

| Item                 | Result                                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD` | `e582250`; `origin/main` == `e582250` (verified via `git ls-remote`)                                                                                                                                                                                                                                        |
| Working tree         | clean at audit start and end (probe removed)                                                                                                                                                                                                                                                                |
| Remediation commits  | `64e102c` (query-engine.ts + tests + docs), `e582250` (closure report SHA record)                                                                                                                                                                                                                           |
| Reference docs read  | `ANTIGRAVITY_PHASE3D_REMEDIATION.md`, `PHASE3D_REMEDIATION_CLOSURE_REPORT.md`, original `PHASE3D_QUERY_TABLE_LIST_AUDIT.md` — the original audit finding (P3D-P1 localeCompare/`Number()` coercion; P3D-P2 tracked report breaks `format:check`) was used as authority, not redefined by the closure report |

**Reference-doc discrepancy (P3):** `PHASE3D_REMEDIATION_CLOSURE_REPORT.md` records **Ending SHA `ad9608a6a240f7c3a013fd7de55fa6aad55ec758`**, which is a _dangling commit_ (`git cat-file -t` = commit, but not in any branch history). The actual final HEAD is `e582250`. Minor doc inaccuracy; does not affect gate status.

## 2. Ordered Comparison Code Inspection (`packages/index/src/query-engine.ts`)

`greater_than` / `less_than` at HEAD (lines 179-213):

```ts
if (val === undefined || val === null || target === undefined || target === null) return false;
if (isValNum && isTargetNum) return val > target; // number vs number
if (typeof val === 'string' && typeof target === 'string') {
  // string vs string
  if (valIsIso && targetIsIso) return Date.parse(val) > Date.parse(target);
  if (valIsIso || targetIsIso) return false; // one ISO, other not -> false
  return val.localeCompare(target) > 0; // plain string ordering
}
return false; // everything else
```

- **Generic `Number(val)` / `Number(target)` fallback: REMOVED.** The old `const numV = Number(val); const numT = Number(target); if (!isNaN...)` block is gone.
- **No `Number()`, no `parseFloat`, no unary `+`, no implicit JS relational coercion** anywhere in the ordered filter paths (verified by source diff `ff6d0aa..HEAD` — only hunk pairs: `isIsoDate` hardening + the two operator cases).
- `parseInt` appears in exactly one query-engine location: `isIsoDate` calendar-range guard (`month 1-12`, `day 1-31`) applied **only to strings that already match the strict ISO regex and parse as a real timestamp**. This is date validation, not mixed-type coercion; it cannot turn `'hello'`/`'1e3'`/`''` into numbers.
- Other `Number()`/`parseInt()` hits in the repo (sqlite-index row hydration `modified_at`/`size`; server.ts HTTP `content-length`/`limit`/`offset` param parsing) are infrastructure, not query filter semantics.
- Diff is surgical: only `isIsoDate` + `greater_than`/`less_than` changed in production code. `equals`/`not_equals`/`contains`/`is_empty`/`sortDocuments`/`matchesFolderScope`/pagination untouched.

## 3. Exact Coercion Matrix (independent probe, both operators)

Independent probe through `matchPropertyFilter` (exported engine function), both `greater_than` and `less_than` — **17 pairings, all exact**:

| Pairing (value / target)            | GT    | LT    | Result                            |
| ----------------------------------- | ----- | ----- | --------------------------------- |
| 10 num / 2 num                      | true  | false | PASS                              |
| `"10"` str / 2 num                  | false | false | PASS (no string→number coercion)  |
| 10 num / `"2"` str                  | false | false | PASS (no number→string coercion)  |
| `""` / 0                            | false | false | PASS (was `Number('')===0`)       |
| `" "` / 0                           | false | false | PASS                              |
| `false` / 0                         | false | false | PASS                              |
| `true` / 1                          | false | false | PASS                              |
| `"0"` / `false`                     | false | false | PASS                              |
| `"abc"` / 0                         | false | false | PASS                              |
| `"Infinity"` / 999                  | false | false | PASS                              |
| `"1e3"` / 999                       | false | false | PASS (was `Number('1e3')===1000`) |
| `null` / numeric                    | false | false | PASS                              |
| `undefined` / numeric               | false | false | PASS                              |
| array / numeric                     | false | false | PASS                              |
| object / numeric                    | false | false | PASS                              |
| `'hello'` / `'abc'` (plain strings) | true  | false | PASS (documented localeCompare)   |
| `'abc'` / `'hello'` (plain strings) | false | true  | PASS (deterministic)              |

**Conclusion:** only explicitly supported typed pairings match; mixed-type numeric coercion does not occur. Matches `ANTIGRAVITY_PHASE3D_REMEDIATION.md` R3D-1 acceptance criteria.

## 4. Date Semantics

| Case                                                              | GT    | LT    | Result                                               |
| ----------------------------------------------------------------- | ----- | ----- | ---------------------------------------------------- |
| `2026-08-17` vs `2026-08-16`                                      | true  | false | PASS                                                 |
| `2026-01-01T12:00:00Z` vs `2026-01-01T11:00:00Z`                  | true  | false | PASS                                                 |
| `01/02/03` vs `2026-08-01`                                        | false | false | PASS                                                 |
| `March-ish` vs `2026-08-01`                                       | false | false | PASS                                                 |
| `123` vs `2026-08-01`                                             | false | false | PASS                                                 |
| `2026-99-99` vs `2026-08-01`                                      | false | false | PASS (regex + `Date.parse` NaN + new month>12 guard) |
| ISO string vs numeric timestamp (`2026-08-17` vs `1786924800000`) | false | false | PASS (mixed ISO/timestamp rejected, as documented)   |

Valid strict ISO date comparisons still work; accidental date interpretation of non-ISO strings is rejected. No regression.

## 5. String Ordering Contract

Final documented contract (`PHASE3D_QUERY_TABLE_LIST_REPORT.md` §2, verified in file): ordinary string `greater_than`/`less_than` **is supported** when **both** operands are plain strings and **neither** is an ISO date → deterministic `localeCompare`. This is:

- coherent (pure string-domain ordering),
- documented (report updated to state it),
- shared across all adapters (single engine function),
- free of mixed-type coercion.

Design passes the audit's "either design can pass" bar.

## 6. Memory / SQLite Differential

- Committed `query-differential.test.ts` now includes the coercion matrix + date guard cases; green in the 325-test run.
- **Independent probe:** identical corpora (12 docs, mixed types incl. `''`, `' '`, `'0'`, `'1e3'`, `'Infinity'`, arrays, objects, junk dates) in `MemoryDocumentIndex` and `SqliteDocumentIndex`; 34+ queries (2 operators × 13 targets on numeric field + 3 date targets on date field) — **identical matched paths in both engines, zero divergence**.

## 7. Real Adapter Test (real gateway, live corpus)

Seeded `score: 10`, `priority: 10`, `priority: 99` via real gateway workspace:

| Adapter                         | Query                         | Result                               |
| ------------------------------- | ----------------------------- | ------------------------------------ |
| REST `POST /api/v1/query`       | `score > "2"` (string target) | **0 matches** ✓                      |
| REST `POST /api/v1/query`       | `score > 2` (number target)   | 1 match (`score.md`) ✓               |
| MCP `openob_query_notes`        | `priority > "2"`              | total 0 ✓                            |
| MCP `openob_query_notes`        | `priority > 2`                | 2 matches (`Old Task`, `Score`) ✓    |
| CLI `openob query --json-query` | `priority > "2"`              | exit 0, total 0 ✓ (REST-only client) |

All three adapters share identical semantics; the CLI path was re-confirmed as pure REST (`runCli` with no workspace → `OpenObGatewayClient`). Committed `gateway-query.test.ts` "proves typed comparison semantics across REST, MCP, and CLI (R3D-1)" also green.

## 8. Table / List

No web code changed by the remediation (`git diff ff6d0aa..HEAD` touches only query-engine.ts, tests, and 4 docs). Table and List remain pure presentations of the single `backend.queryNotes` result (`ViewContainer.tsx`); the only `Number()` in the view is the filter-builder's user-input parsing ("2" typed in the filter box → numeric target 2, matching user intent under the new contract) — it does not coerce note values or results. Table result set == List result set == backend query result, by construction.

## 9. P3D-P2 Format Gate

| Check                                                   | Result                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                                  | **PASS** (exit 0, "All matched files use Prettier code style!")                                                                                                                                                                                                |
| `PHASE3D_QUERY_TABLE_LIST_REPORT.md` tracked            | YES (`git ls-files`)                                                                                                                                                                                                                                           |
| In `.prettierignore`?                                   | NO (ignore list is standard: node_modules/dist/build/coverage/test-results/logs/tmp only)                                                                                                                                                                      |
| Formatter config weakened?                              | NO (`.prettierrc.json` unchanged: singleQuote, printWidth 100)                                                                                                                                                                                                 |
| Report accurately describes final mixed-type semantics? | YES — states mixed types and generic `Number()` coercion are rejected; dates require strict ISO + calendar validation; strings compare via `localeCompare` only when both plain strings and neither ISO; booleans/arrays/maps rejected for ordered comparisons |

**P3D-P2 is resolved.**

## 10. Full Clean Gate (from `rm -rf dist && npm ci`)

| Gate                   | Result                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm ci`               | PASS (0 vulnerabilities)                                               |
| `npm run format:check` | PASS                                                                   |
| `npm run lint`         | PASS (0 errors; 8 pre-existing `react-hooks/exhaustive-deps` warnings) |
| `npm run typecheck`    | PASS                                                                   |
| `npm test`             | PASS — **57 files / 325 tests** (matches closure report count)         |
| `npm run build`        | PASS (2.58s)                                                           |
| `npm run test:e2e`     | PASS — 24/24 (incl. Phase 3D live table update over SSE)               |
| `npm run verify:full`  | **PASS (exit 0)**                                                      |

**EVERY command passes from a clean state.** No "conditional complete" is needed: `verify:full` is green.

## 11. Targeted Regression Spot-Checks (Phase 3D invariants)

The remediation diff touched only ordered-comparison code + tests + docs; every invariant below is either unchanged-by-diff and covered by the green committed suites, or explicitly re-verified:

- folderScope boundary — code unchanged; `query-engine.test.ts` "strict directory boundaries" green
- deterministic sorting — `sortDocuments`/`compareScalars` unchanged; test green
- pagination — unchanged; test green
- boolean equality — `equals`/`not_equals` unchanged; test green
- array filtering — unchanged; test green
- YAML maps do not stringify — unchanged (`[object Object]` guard); test green
- degraded index truthful — `workspace.ts` unchanged (indexStatus propagation); prior live verification stands
- Memory/SQLite parity — differential suite green + independent 34-check probe (see §6)
- live Table update over SSE — e2e `gateway-views.spec.ts` green (24/24)
- dirty editor unaffected — `useVault.ts` unchanged (dirty buffer preserved on external events)
- REST auth — unchanged (timingSafeEqual token, server-configured scopes); auth tests green
- MCP read-only — unchanged; query path read-only
- CLI REST-only — re-confirmed (probe + `gateway-query.test.ts`)
- Standalone Table/List — `LocalWorkspaceBackend` + `MemoryDocumentIndex` unchanged
- Gateway Table/List — e2e green

## 12. Remote CI

`git ls-remote origin` **succeeds** (repo reachable via git protocol with cached credentials): `origin/main` == `e582250` == local HEAD. The GitHub web UI and REST API return 404 (private repository, no API token), so **actual workflow run status at this exact HEAD is not observable from this environment**: `REMOTE CI UNVERIFIED IN THIS ENVIRONMENT`. The workflow file (`.github/workflows/ci.yml`) runs Node 20.x + 22.x matrix, Playwright e2e, packaging/binary invocation, plus boundary/secret greps; the full gate was replayed locally and is green. Not claimed non-existent.

## 13. Severity Mapping

- **P0:** none.
- **P1:** none — no canonical mutation from query, no auth bypass, no SQL injection, no dirty-buffer loss.
- **P2:** none remaining — P3D-P1 (mixed-type coercion) fixed and regression-locked; P3D-P2 (format/verify gate) fixed and verified green from clean install.
- **P3:** P3D-C1 (doc) — `PHASE3D_REMEDIATION_CLOSURE_REPORT.md` Ending SHA points to dangling commit `ad9608a6...` instead of final HEAD `e582250`; record correct SHA (and note test count matches: 325).

## 14. Final Verdict

**QUERY + TABLE/LIST FOUNDATION COMPLETE**

All closure criteria verified with independent evidence:

- ✅ mixed-type ordered comparisons cannot coerce numerically (17-pair matrix, both operators)
- ✅ valid numeric comparisons still work (10 > 2, 2 < 10)
- ✅ valid strict date comparisons still work (ISO date + ISO timestamp; junk dates rejected)
- ✅ Memory/SQLite agree (committed differential + independent 34-check parity probe)
- ✅ REST/MCP/CLI share identical semantics (real-gateway adapter probe + committed integration tests)
- ✅ Table/List agree (single query result source; no UI-side result coercion)
- ✅ `PHASE3D_QUERY_TABLE_LIST_REPORT.md` formatter-clean, tracked, accurately documents the strict typed contract
- ✅ `format:check` passes
- ✅ `verify:full` passes from clean `npm ci`

Remaining items are documentation-grade (P3): the closure report's Ending SHA should point to `e582250`; CI run status for this exact HEAD remains unverified in this environment.

Phase 3E (Board) not audited per instruction.
