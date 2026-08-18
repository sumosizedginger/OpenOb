# PHASE 3E P1 CLOSURE: P3E-P4 RESERVED `.openob` METADATA NAMESPACE ISOLATION

## 1. Executive Summary & Audit Context

- **Repository**: https://github.com/sumosizedginger/OpenOb
- **Starting Remote Audited HEAD**: `c83d0229cbb95c37f2a8dc4db4bd807b235b9dbe`
- **Starting Working-Tree State**: Contained 5 intentional build-config corrections reverting premature types changes from `c83d022` (`apps/gateway/tsconfig.json`, `packages/desktop/tsconfig.json`, `packages/vault/tsconfig.json`, `package.json`, `package-lock.json`).
- **P1 Finding**: Internal `.openob/` application metadata was reachable and mutable through public user-note APIs (`/api/v1/notes/*`, `workspace.createNote`, `updateNote`, `deleteNote`, `renameNote`, `setProperty`, etc.) and vulnerable to case-variant bypasses (`.OPENOB`, `.OpenOb`, `.oPeNoB`).
- **P2 Blockers Remediated**:
  1. `reserved-metadata-boundary.test.ts` initially depended on a pre-existing `apps/gateway/dist/bin/gateway.js` bundle, causing clean checkout test runs (`npm test` before `npm run build`) to fail. Remediated by utilizing an isolated build strategy.
  2. `PHASE3E_P4_REMEDIATION_CLOSURE_REPORT.md` had Prettier formatting issues which are now formatted and verified.

---

## 2. Root Cause Analysis

1. **Missing Namespace Boundary in Note APIs**: `OpenObWorkspace.prototype.resolveNotePath` verified basic traversal safety (`..`, null bytes, leading slashes) but did not check if the resolved path was inside the reserved internal metadata directory `.openob/`.
2. **Case-Variant Namespace Bypass**: The initial namespace check evaluated paths case-sensitively, allowing `.OPENOB`, `.OpenOb`, and `.oPeNoB` to bypass the guard and access the metadata folder on case-insensitive filesystems or cause cross-platform divergence.
3. **Index Rebuilder Leaks**: `rebuildIndex` and `rebuildVaultIndex` enumerated all `.md` files without checking if they resided within `.openob/`.
4. **Shared Dist Test Dependency**: The HTTP attack test spawned `apps/gateway/dist/bin/gateway.js` directly, creating an implicit ordering dependency where `npm test` required `npm run build` to have run beforehand.

---

## 3. Exact Boundary & Portability Contract

Internal OpenOb application metadata is isolated from user markdown notes under the single canonical prefix `.openob` evaluated **case-insensitively across all platforms**:

```ts
export const RESERVED_WORKSPACE_PREFIX = '.openob';

export function isReservedWorkspacePath(rawOrNormalizedPath: string): boolean {
  if (!rawOrNormalizedPath || typeof rawOrNormalizedPath !== 'string') {
    return false;
  }
  let normalized = rawOrNormalizedPath.replace(/\\/g, '/').trim();
  while (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  while (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized === '' || normalized === '.') {
    return false;
  }
  try {
    const canonical = normalizeVaultPath(rawOrNormalizedPath);
    const folded = canonical.toLowerCase();
    return (
      folded === RESERVED_WORKSPACE_PREFIX || folded.startsWith(`${RESERVED_WORKSPACE_PREFIX}/`)
    );
  } catch {
    const folded = normalized.toLowerCase();
    return (
      folded === RESERVED_WORKSPACE_PREFIX || folded.startsWith(`${RESERVED_WORKSPACE_PREFIX}/`)
    );
  }
}
```

### Portability & Casing Rules:

- **Case-Insensitive Enforcement Everywhere**: The comparison uses locale-independent ASCII case folding (`folded.toLowerCase()`) uniformly on all operating systems (Windows, macOS, Linux). It does not branch on host OS filesystem properties.
- **Path Casing Preservation**: Case folding is strictly temporary during boundary evaluation. The original casing of legitimate user notes is never mutated.
- **Exact Segment Matching**:
  - Reserved: `.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB`, `.openob/foo`, `.OPENOB/views/x.json`, `./.OPENOB/views/x.json`, `foo/../.OPENOB/views/x.json`, `.OPENOB\\views\\x.json`.
  - Permitted User Notes (Near-Misses): `.openobserver.md`, `.OPENOBSERVER.md`, `.OpenObserver.md`, `.openob-notes/foo.md`, `.OPENOB-NOTES/foo.md`, `notes/.openobservation.md`, `notes/.OPENOBservation.md`, `foo.openob/bar.md`, `foo.OPENOB/bar.md`.

---

## 4. Scope Authority & Capability Separation

1. **User Note Scopes**:
   - `workspace.read`, `workspace.write`, `properties.write`, `workspace.rename`, `workspace.delete` grant authorization **exclusively over user notes**. They do **NOT** confer access to `.openob/`.
2. **Metadata Scopes**:
   - `workspace.views.write` authorizes Saved View operations (`createSavedView`, `updateSavedView`, `deleteSavedView`) handled by `SavedViewStore` targeting `.openob/views/`.
   - `workspace.views.write` does **NOT** grant arbitrary note API access to `.openob/`.
3. **No Note Backdoors**:
   - Calling `/api/v1/notes/*` or `workspace.createNote`/`updateNote`/`deleteNote`/`renameNote`/`setProperty` on any `.openob` target immediately rejects with `InvalidPathError` (HTTP 400).
4. **Rebuilder Pipeline**:
   - `rebuildIndex` and `rebuildVaultIndex` ignore all files inside `.openob/` across all case variations.

---

## 5. Isolated Process-Build Test Strategy

To ensure `npm test` passes from a completely clean tree (`rm -rf apps/gateway/dist packages/*/dist`) before `npm run build`:

- `tests/integrity/reserved-metadata-boundary.test.ts` builds its own isolated gateway bundle into a dedicated temporary directory (`apps/gateway/.dist-boundary-<timestamp>-<rand>`) in `beforeAll` using `apps/gateway/build.js --outdir <tempDist>`.
- The spawned child process targets this isolated binary.
- `afterAll` kills the child process and removes both the temporary vault and temporary build directory.

---

## 6. Touched Files & Audit Manifest

| File                                                 | Nature of Change                                                                                                        |
| :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/path.ts`                          | Exported `RESERVED_WORKSPACE_PREFIX` and case-insensitive `isReservedWorkspacePath`.                                    |
| `packages/core/src/__tests__/path.test.ts`           | Added unit tests covering exact matches, aliases, traversal patterns, case variants, and near-misses.                   |
| `packages/workspace/src/workspace.ts`                | Enforced `isReservedWorkspacePath` in `resolveNotePath`, `renameNote`, `deleteNote`, `listEntries`, `rebuildIndex`.     |
| `packages/index/src/rebuilder.ts`                    | Filtered out reserved metadata files in `rebuildVaultIndex`.                                                            |
| `tests/integrity/reserved-metadata-boundary.test.ts` | Permanent 10-test suite with isolated build harness, cross-scope proofs, and REST case-variant attacks.                 |
| `docs/API_CONTRACTS.md`                              | Documented `.openob/` reserved metadata namespace, capability separation, and error codes.                              |
| `docs/SECURITY.md`                                   | Documented application metadata boundary isolation, scope protection, and prohibition of note backdoors.                |
| `docs/ARCHITECTURE.md`                               | Updated Section 9 to document `.openob/` reserved metadata namespace and `SavedViewStore` isolation.                    |
| `docs/DECISIONS.md`                                  | Recorded Architecture Decision Record **D-023: Reserved Application Metadata Namespace & Note API Isolation (P3E-P4)**. |
| `docs/FAILURE_REGISTRY.md`                           | Logged Failure Mode **F-039: Reserved `.openob/` Metadata Namespace Reachability via Note APIs**.                       |
| `apps/gateway/tsconfig.json`                         | Preserved explicit `"types": ["node"]` without explicit `typeRoots`.                                                    |
| `packages/desktop/tsconfig.json`                     | Preserved explicit `"types": ["node"]` without explicit `typeRoots`.                                                    |
| `packages/vault/tsconfig.json`                       | Preserved explicit `"types": ["node"]` without explicit `typeRoots`.                                                    |
| `package.json` / `package-lock.json`                 | Removed `@types/estree` devDependency.                                                                                  |

---

## 7. Verification Evidence

### 1. Clean Test Execution (BEFORE `npm run build`)

```powershell
Remove-Item -Recurse -Force apps/gateway/dist, apps/web/dist, packages/*/dist -ErrorAction Ignore
npm test
```

- **Result**: 62/62 test files passed, 360/360 tests passed (0 failures).

### 2. 20x Determinism Stress Loop

Ran 20 continuous sequential runs of `tests/integrity/reserved-metadata-boundary.test.ts`:

- **Result**: 20/20 iterations passed with zero flakiness or resource leaks.

### 3. Byte-for-Byte SHA256 Integrity Verification

- Legitimate `.openob/views/view_legitimate_001.json` hashed before attack matrix: `crypto.createHash('sha256')`.
- Subjected to case-variant GET, POST, PUT, DELETE, RENAME, and PATCH REST attacks.
- Hashed afterward: identical SHA256 digest.
- `client.getSavedView` and `client.runSavedView` returned valid, intact data.

### 4. Playwright End-to-End Suite

```powershell
npm run test:e2e
```

- **Result**: 26/26 tests passed (38.0s).

### 5. Full Clean Verification Gate (`npm run verify:full`)

```powershell
npm run verify:full
```

- `format:check`: PASS (All matched files formatted)
- `lint`: PASS (0 errors, 7 known React hook warnings)
- `typecheck`: PASS (Clean TypeScript compile)
- `npm test`: PASS (62/62 test files, 360/360 tests)
- `npm run build`: PASS (Gateway and Web production builds successful)
- `verify:e2e`: PASS (26/26 browser E2E tests)

---

## 8. DeepSeek Handoff Section (Adversarial Review)

### Context for Adversary:

- **Remediation Boundary**: Enforced via `isReservedWorkspacePath()` in `@okw/core/src/path.ts` and integrated in `@okw/workspace/src/workspace.ts` (`resolveNotePath`, `listEntries`, `rebuildIndex`) and `@okw/index/src/rebuilder.ts` (`rebuildVaultIndex`).
- **Regression Suite**: `tests/integrity/reserved-metadata-boundary.test.ts`.

### Attack Matrix Covered:

1. **Case Variations**: `.openob`, `.OPENOB`, `.OpenOb`, `.oPeNoB` rejected on all note endpoints.
2. **Aliases & Normalization**: Traversal (`foo/../.OPENOB`), Windows backslashes (`.OPENOB\views`), leading slashes (`/.OPENOB`), redundant slashes.
3. **False Positive Safety**: `.openobserver.md`, `.OPENOBSERVER.md`, `.openob-notes/foo.md`, `.OPENOB-NOTES/foo.md`, `notes/.openobservation.md`, `foo.OPENOB/bar.md` are accepted and functional.
4. **Capability Isolation**: `workspace.write` cannot touch `.openob/`, and `workspace.views.write` cannot perform note CRUD on `.openob/`.
5. **Clean Test Independence**: Regression suite builds its own isolated gateway bundle and does not depend on shared `dist`.
