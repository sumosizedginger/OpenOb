# ANTIGRAVITY_PHASE3D_REMEDIATION.md

## R3D-1 — Mixed-type `greater_than`/`less_than` fall back to `localeCompare` / `Number()` coercion (incorrect filtering)

- **ID:** R3D-1
- **Severity:** P2
- **Scope:** query semantics (packages/index/src/query-engine.ts)
- **Problem:** When a `greater_than`/`less_than` filter targets a number or a valid ISO date but the indexed property value is a string that is not that type, the engine falls back to `String(value).localeCompare(String(target))`, producing materially wrong matches:
  - `f > 10` matches `f: 'hello'` (`'hello' > '10'` lexicographically).
  - `date > 2026-08-01` matches `'hello'`, `'March-ish'`, `'false'`, `'2026-99-99'`.
  - Additionally, the `Number(val)`/`Number(target)` fallback (query-engine.ts:180-185, 196-201) coerces junk strings with surprising results: `f > -1` matches `f: ''` (`Number('') === 0`); `f > 100` matches `f: '1e3'` (`Number('1e3') === 1000`). The incoherence is stark: `f > 1000` matches `f: 'hello'`/`f: 'March-ish'` via `localeCompare` while `f: '1e3'` (numerically exactly 1000) does **not** match.
- **Evidence:** re-audit live REST probe (fresh run at HEAD `ff6d0aa`, real gateway + SQLite index, 12 seeded notes):
  - `f > 10` → `["expo.md","junk.md","march.md","num.md"]` (junk `'hello'`, `'March-ish'` wrongly matched).
  - `d > 2026-08-01` → `["baddate.md","falsy.md","junk.md","march.md","num.md"]` (`'2026-99-99'`, `false`, `'hello'`, `'March-ish'` wrongly matched).
  - `f > -1` → includes `blank.md` (`f: ''`); `f > 100` → includes `expo.md` (`f: '1e3'`); `f > 1000` → excludes `expo.md` but includes `junk.md`/`march.md`.
- **Exact reproduction:** `POST /api/v1/query` with `{filters:[{field:'d',operator:'greater_than',value:'2026-08-01'}]}` on a note with `d: 'hello'` → note matches.
- **Root cause:** query-engine.ts `greater_than`/`less_than`: after `isValNum && isTargetNum` and `isIsoDate(val) && isIsoDate(target)` both fail, the code falls through to `Number()` coercion and then `String(val).localeCompare(String(target))` — ordering arbitrary strings against numeric/date targets and coercing junk strings via `Number()`.
- **Required change (minimal):** in `greater_than`/`less_than`, when the target is a number (or ISO date) and the value is neither, return `false` (type mismatch — the value is not greater/less than the target in that domain). Keep the `localeCompare` fallback only for plain-string vs plain-string (neither numeric nor ISO-date) comparisons. Gate the `Number()` fallback so it never coerces junk: apply numeric coercion only when **both** operands are strings that match a plain decimal pattern (e.g. `/^-?\d+(\.\d+)?$/`), never `''`, whitespace, exponents (`1e3`), `Infinity`, hex, or booleans — or, stricter, drop the `Number()` fallback entirely for string values (quoted numeric strings then compare as strings). Same guard for the reverse direction (value numeric/date, target string).
- **Required regression test:** permanent query-engine test + REST-level test asserting:
  - `f > 10` excludes `f:'hello'`, `'March-ish'`, `'2026-99-99'`, `'false'`; includes numbers/dates.
  - `f > -1` excludes `f:''`; `f > 100` excludes `f:'1e3'`; `f > 1000` excludes `f:'hello'`/`'March-ish'` (and `f:'1e3'`).
  - Same-domain comparisons (number vs number, ISO vs ISO) unchanged.
  - Run 20+ iterations.
- **Acceptance criteria:** date/numeric comparisons match only same-domain values; no material incorrect matches; no junk-string coercion; `verify:full` green.
- **Dependencies:** none.
- **What NOT to do:** do not parse arbitrary dates via `Date.parse` alone, do not change `equals`/`contains` semantics.

## R3D-2 — Tracked `PHASE3D_QUERY_TABLE_LIST_REPORT.md` breaks `format:check` / `verify:full`

- **ID:** R3D-2
- **Severity:** P2 (gate)
- **Problem:** the tracked Phase 3D report document is not Prettier-clean → `npm run format:check` (and therefore `verify:full`) fails at baseline.
- **Evidence:** clean `npm ci` + `npm run verify:full` → exits at `format:check` with `[warn] PHASE3D_QUERY_TABLE_LIST_REPORT.md`; every other gate (lint/typecheck/test/build/e2e) passes.
- **Fix:** `npx prettier --write PHASE3D_QUERY_TABLE_LIST_REPORT.md` (formatting-only, no content change).
- **Required regression:** `npm run format:check` green at the fix commit; keep the file Prettier-clean.
- **Acceptance criteria:** `verify:full` exit 0.

## R3D-3 — Document object-valued property query semantics (JSON-string form)

- **ID:** R3D-3
- **Severity:** P3
- **Problem:** nested YAML objects are JSON-stringified on write and read back as strings; `contains`/`equals` match the JSON string representation, not a structured object query.
- **Evidence:** probe test 7: `contains 'nested'` on `meta: {nested:{...}}` matches the note; `equals '[object Object]'` does not; no crash.
- **Fix:** documentation only — state that object-valued properties are queried as their JSON string representation; optionally add a `stringify` note in the query tool descriptions (REST/MCP).
- **Acceptance criteria:** docs truthfully describe the behavior.

## R3D-4 — Document pagination/sort edge semantics

- **ID:** R3D-4
- **Severity:** P3
- **Problem:** `limit: 0` returns 1 row (clamped to minimum page size 1); missing sort values sort last in ASC. Bounded and deterministic, but not documented.
- **Fix:** documentation only (API docs: limit clamps to [1, 500]; missing values placement; negative offset = 0).
- **Acceptance criteria:** docs match observed behavior.

## R3D-5 — Optional: coalesce view re-queries under event bursts

- **ID:** R3D-5
- **Severity:** P3
- **Problem:** every change-stream event triggers one view re-query (verified ~1:1, 29-30 queries for 30 events, bounded, converges, no runaway). Under extremely high event rates this is chatty.
- **Fix (optional, not blocking):** micro-debounce (e.g. 50-100ms) or rAF coalescing of the `refreshKey` bump in `useVault` event handling; final state must still equal the authoritative query result.
- **Acceptance criteria:** event-storm probe still bounded and final table correct; no query lost after settling.
