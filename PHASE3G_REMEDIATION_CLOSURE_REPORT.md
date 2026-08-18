# Phase 3G Remediation Closure Report

# Citation Line-Range Grounding (G3G-1) + Truthful Model Discovery (G3G-2)

**Repository:** OpenOb  
**Audited Base Commit:** `0453f52fb3035b7102e0766d958879f679a9046c`  
**Verdict:** **PASSED / CLOSED**

---

## 1. Executive Summary

This remediation successfully resolves the two remaining audit blockers identified in the Phase 3G Hardening Audit (`PHASE3G_AI_BYOK_HARDENING_AUDIT.md`):

1. **G3G-1 / S15 / P2 (Citation Line-Range Grounding):** Structured citations now strictly ground line ranges against actual retrieved chunk intervals. Claimed ranges outside retrieved bounds or spanning discontiguous intervals are safely omitted or clamped to retrieved intersections.
2. **G3G-2 / S21 / P2 (Truthful Model Discovery):** Removed all fake/fabricated model fallback returns from `OpenAICompatibleProvider.listModels()` and `AIManager.listModels()`. The Gateway truthfully surfaces provider unreachable errors as HTTP 502 with `{ code: 'AI_PROVIDER_ERROR', message: redactedMsg }`, and the Web UI renders an explicit unavailable/retry state without stale or fabricated options.

All existing Phase 3G guarantees (Zero-Browser Secret Leaks, SSRF loopback-only protection, workspace-scoped retrieval, and OCC 409 proposed edits) were preserved without architecture freelancing.

---

## 2. Remediations & Technical Implementation

### A. G3G-1: Citation Line-Range Grounding (`packages/ai/src/retrieval.ts`)

Implemented `groundLineRange(claimedStart, claimedEnd, matchingChunks)` adhering strictly to the grounded interval specification:

- **Case A (In-Range):** When a claimed range $[S, E]$ is fully contained within ONE retrieved chunk $[C_s, C_e]$, the exact claimed range $[S, E]$ is preserved.
  - _Example:_ Chunk $[10, 20]$, claim `12-15` $\to [12, 15]$.
- **Case B (Partial Overlap):** When a claimed range $[S, E]$ partially overlaps ONE retrieved chunk $[C_s, C_e]$, the range is clamped to the intersection $[\max(S, C_s), \min(E, C_e)]$.
  - _Example:_ Chunk $[10, 20]$, claim `1-12` $\to [10, 12]$; claim `18-30` $\to [18, 20]$.
- **Case C (No Overlap):** When a claimed range $[S, E]$ has no overlap with any retrieved chunk, the line range is omitted (path-only citation).
  - _Example:_ Chunk $[10, 20]$, claim `99999-100000` $\to$ path only; claim `1-5` $\to$ path only.
- **Case D (Discontiguous Overlap):** When a claimed range spans across multiple discontiguous retrieved chunks, the line range is omitted to avoid falsely implying unread intermediate lines.
  - _Example:_ Chunks $[10, 20]$ and $[40, 50]$, claim `18-42` $\to$ path only; claim `25-30` (gap) $\to$ path only.
- **Defensive Bounds:** Invalid numbers ($S < 1$, $E < S$, NaN, non-integers) safely degrade to path-only citations.
- **Hallucinated Note Dropping:** References to notes not present in `retrievedSources` emit no citation.

### B. G3G-2: Truthful Model Discovery (`packages/ai`, `apps/gateway`, `apps/web`)

1. **`OpenAICompatibleProvider.listModels()` (`packages/ai/src/openai-compatible.ts`):**
   - Removed catch block that fabricated `[{ id: defaultModel, name: 'Default Local Model' }]`.
   - Propagates fetch failures and HTTP non-200 responses as descriptive errors.
2. **`AIManager.listModels()` (`packages/ai/src/ai-manager.ts`):**
   - Removed fallback catch block returning fake default models.
3. **Gateway Error Mapping (`apps/gateway/src/server.ts`):**
   - Endpoint `GET /api/v1/ai/models` catches provider errors, redacts sensitive secrets using `secretStore.getAllKnownSecrets()`, and returns HTTP 502 with `{ code: 'AI_PROVIDER_ERROR', message: redactedMsg }`.
4. **Web UI Truthfulness (`apps/web/src/components/ai/AIChatDrawer.tsx`):**
   - Introduced `modelError` and `isLoadingModels` state.
   - Provider switching immediately clears stale models and active selection.
   - On discovery failure, renders a clear error banner with Retry capability and disables model selector without showing fake options.

---

## 3. Test Coverage & Verification Matrix

### Automated Test Matrix

| Test Suite                                            | Tests          | Status | Key Coverage                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integrity/ai-gateway-hardening.test.ts`        | 21             | PASS   | ServerSecretStore precedence, Zero browser storage, SSRF loopback validation, Scoped retrieval & `.openob` isolation, **G3G-1 Citation Line Matrix (Cases A-D)**, OCC version-token proposals, Gateway AI endpoints, **G3G-2 502 AI_PROVIDER_ERROR**, Mock provider recovery, Secret redaction in model error |
| `tests/integrity/local-ai.test.ts`                    | 6              | PASS   | Law 18 provider failure isolation, Law 19 proposal safety, G3G-1 chunk clamping on live retrieved context                                                                                                                                                                                                     |
| `packages/ai/src/__tests__/openai-compatible.test.ts` | 2              | PASS   | Unreachable endpoint throws truthfully, streaming capabilities                                                                                                                                                                                                                                                |
| `tests/e2e/ai-gateway.spec.ts`                        | 3              | PASS   | Gateway AI secret zero-browser-storage guarantee, Standalone cloud BYOK notice, **G3G-2 Truthful model discovery error banner and OpenAI model switch**                                                                                                                                                       |
| Full Vitest Integrity Suite                           | 392 (64 files) | PASS   | Complete system integrity, coordinator probes, gateway change stream, SQLite parity                                                                                                                                                                                                                           |
| Full Playwright E2E Suite                             | 33 (8 files)   | PASS   | Real Chromium browser multi-tab, board/table mutations, change stream, AI gateway                                                                                                                                                                                                                             |

### Full Gate Execution Results

```text
> open-knowledge-workspace@0.1.0 verify:full

✓ format:check (All matched files use Prettier code style)
✓ lint (0 errors, 8 warnings)
✓ typecheck (tsc --build exited 0)
✓ test (64 test files, 392 tests passed)
✓ build (Gateway and Web production bundles compiled)
✓ test:e2e (33 Playwright E2E browser tests passed)
```

---

## 4. Conclusion & Status

Phase 3G remediation is complete, verified, and adheres to all architectural constraints.
