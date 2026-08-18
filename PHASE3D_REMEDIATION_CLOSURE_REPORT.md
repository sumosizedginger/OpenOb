# Phase 3D Remediation Closure Report

## Summary & Verification Status

- **Starting SHA**: `ff6d0aa4a822936925be4cee076d27eb50a73c23`
- **Ending SHA**: (Pending commit)
- **Vitest Unit & Integrity Tests**: 57 test files passed, 325 tests passed (0 failures)
- **Playwright E2E Tests**: 24 tests passed (0 failures)
- **Format Gate (`format:check`)**: PASS (Prettier clean across all files)
- **Lint Gate (`lint`)**: PASS (0 errors)
- **Typecheck Gate (`typecheck`)**: PASS (0 errors)
- **Full Gate (`verify:full`)**: PASS (Exit code 0)
- **Remote CI Status**: `REMOTE CI UNVERIFIED IN THIS ENVIRONMENT`

---

## 1. P3D-P1 / R3D-1 Remediation: Removal of Unsafe Generic `Number()` Coercion

### Root Cause

In `packages/index/src/query-engine.ts`, the `greater_than` and `less_than` filter operators previously implemented a fallback that evaluated `Number(val)` and `Number(target)` when typed numeric or ISO-date branch checks failed. When both were not `NaN`, it performed numeric comparison, and subsequently fell back to `String(val).localeCompare(String(target))`.

JavaScript's `Number()` coercion unsafely converts empty strings `""` (`0`), whitespace strings `" "` (`0`), booleans `false` (`0`) / `true` (`1`), and exponential strings `"1e3"` (`1000`) into numbers. Furthermore, falling through to `localeCompare` for mixed comparisons allowed plain strings (`"hello"`, `"March-ish"`) to match against numeric or date targets (`"hello" > "10"` or `"hello" > "2026-08-01"`).

### Final Comparison Contract

Explicit, typed semantics are now strictly enforced across all query execution paths:

1. **NUMBER vs NUMBER**: Compare numerically (`val > target` / `val < target`) when both operands are valid numeric primitives (`typeof === 'number' && !isNaN(...)`).
2. **STRING vs STRING**:
   - If **both** operands are valid strict ISO-8601 date strings (`isIsoDate(val) && isIsoDate(target)`), timestamps are compared via `Date.parse(...)`.
   - If **one** operand is an ISO date string and the other is **not** an ISO date string, the comparison returns `false` (domain mismatch).
   - If **neither** operand is an ISO date string, standard string lexicographical ordering via `val.localeCompare(target)` is applied.
3. **MIXED TYPES & COMPLEX STRUCTURES**:
   - Mixed types (`number` vs `string`, `string` vs `number`, `boolean` vs `number`, `boolean` vs `string`, `string` vs `boolean`) return `false`.
   - Complex structures (Arrays, YAML Maps/Objects) return `false` for ordered comparisons.
   - `null` and `undefined` operands return `false`.
4. **Generic `Number()` Removal**:
   - Generic `Number(val)` / `Number(target)` coercion has been completely excised. Numeric strings (e.g. `"10"`) do not coerce into numbers against numeric targets (e.g. `2`).

---

## 2. Regression Matrix & Empirical Parity Evidence

### Comprehensive Regression Matrix (`packages/index/src/__tests__/query-engine.test.ts`)

The regression suite tests all required pairings for `greater_than` and `less_than`:

- `number 10` vs `number 2` → numeric comparison matches (`true` / `false` inverse)
- `"10"` string vs numeric `2` → `false`
- numeric `10` vs `"2"` string → `false`
- `""` vs `0` → `false`
- `" "` vs `0` → `false`
- `false` vs `0` → `false`
- `true` vs `1` → `false`
- `"0"` vs `false` → `false`
- `"abc"` vs `0` → `false`
- `"Infinity"` vs number `1000` → `false`
- `"1e3"` string vs numeric `999` → `false`
- `null` / `undefined` → `false`
- `array` vs scalar → `false`
- `YAML object/map` vs scalar → `false`
- `"2026-08-17"` vs `"2026-08-16"` → `true`
- `"01/02/03"`, `"March 4"`, `"123"`, `"2026-99-99"` vs `"2026-08-01"` → `false`
- ISO date string vs numeric timestamp → `false`

### Differential Parity Suite (`tests/integrity/query-differential.test.ts`)

13 differential tests run against both `MemoryDocumentIndex` and `SqliteDocumentIndex`. All test cases (including the mixed-type coercion matrix and date guard) produce identical results across both index engines.

### Protocol Propagation: REST, MCP & CLI Integration (`tests/integrity/gateway-query.test.ts`)

Validated that corrected semantics propagate identically through:

- REST: `POST /api/v1/query`
- MCP: `openob_query_notes` tool dispatch
- CLI: `openob query --json-query`
  Integration tests prove that querying property `priority` (number `1`, `2`, `99`) with string target `"2"` yields 0 matches, whereas numeric target `2` correctly matches `priority: 99`.

---

## 3. P3D-P2 / R3D-2 Remediation: Formatting Gate & Report Accuracy

1. **Format Gate Fix**: `PHASE3D_QUERY_TABLE_LIST_REPORT.md` has been formatted in-tree with Prettier. It remains tracked, unmodified by ignore rules, and passes `npm run format:check`.
2. **Report Accuracy**: Updated `PHASE3D_QUERY_TABLE_LIST_REPORT.md` to accurately document the strict typed comparison contract (requiring numeric-typed operands for numbers, strict ISO date strings for date ordering, and rejection of mixed-scalar coercions) and refreshed verification counts.

---

## Final Verdict

**READY FOR DEEPSEEK PHASE3D CLOSURE AUDIT**
