# GEMINI_PHASE3G_REMEDIATION.md

Remediation items for the Phase 3G AI/BYOK adversarial audit (`PHASE3G_AI_BYOK_HARDENING_AUDIT.md`). Audit-only run; production code untouched. Fix scope defined for the Foreman (Gemini).

## G3G-1 — Citation line-range grounding (P2, S15)

- **ID:** G3G-1
- **Severity:** P2
- **Scope:** `packages/ai/src/retrieval.ts` (`extractCitations`, lines ~309-336); tests `tests/integrity/ai-gateway-hardening.test.ts` (§5)
- **Problem:** `extractCitations` takes the model-claimed line range from `[Source: path.md (Lines X-Y)]` verbatim (`lineStart = Math.max(1, startLine)`, `lineEnd = endLine`) without comparing against the actual retrieved chunk's `lineStart`/`lineEnd`. Live probe: retrieved chunk was `A.md` lines 10-20; model claimed lines 99999-100000; the emitted structured citation carried `lineStart: 99999, lineEnd: 100000`. The clickable path is grounded (only retrieved notes become citations), but the claimed line range is not.
- **Required change (minimal):** when a source-tag citation carries a line range, clamp it to the matching retrieved chunk's `[lineStart, lineEnd]`:
  - find the retrieved chunk whose `notePath` matches the cited path;
  - if the chunk has `lineStart`/`lineEnd`, clamp `citation.lineStart = max(chunk.lineStart, claimedStart)` and `citation.lineEnd = min(chunk.lineEnd, claimedEnd)`; if the claimed range is entirely outside the chunk's range (or after clamping `start > end`), either drop the line fields or clamp to the chunk's full range — per the documented contract, the citation must not claim lines the provider never received;
  - if no matching chunk range exists (retrievedSources without line info, as in the current unit test), keep current behavior (path-only citation) or clamp to undefined.
- **Required regression test:** extend the §5 citation test: retrieved chunk `A.md` lines 10-20; model response `[Source: A.md (Lines 99999-100000)]`; assert the citation's `lineStart`/`lineEnd` do not exceed `[10, 20]` (either clamped or absent); also assert a legitimate in-range claim (Lines 12-15) survives with those values.
- **Acceptance criteria:** no structured citation claims a line range outside the actual retrieved chunk; existing path-grounding tests still pass; `verify:full` green.
- **What NOT to do:** do not remove line metadata from all citations; do not trust model line claims; do not change the path-grounding logic (it is correct).

## G3G-2 — Truthful model discovery on provider failure (P2, S21)

- **ID:** G3G-2
- **Severity:** P2
- **Scope:** `packages/ai/src/openai-compatible.ts` (`OpenAICompatibleProvider.listModels`, lines ~90-116); `apps/gateway/src/server.ts` (`GET /api/v1/ai/models`, lines ~1074-1099); tests `tests/integrity/ai-gateway-hardening.test.ts` (add to §7)
- **Problem:** `OpenAICompatibleProvider.listModels` catches fetch failure and returns a fabricated fallback `{ id: defaultModel || 'local-model', name: 'Default Local Model', isDefault: true }`. The gateway serves it as HTTP 200 success with no fallback/unverified marking. Live probe: `GET /api/v1/ai/models?provider=ollama` against a dead endpoint → `200 {"models":[{"id":"llama3","name":"llama3","isDefault":true}]}`. This is treated as successful provider discovery, which the audit rejects.
- **Required change (minimal):** make model discovery truthful on failure:
  - Option A (recommended): `listModels` re-throws the fetch error (no silent fallback), so the gateway returns **502 `AI_PROVIDER_ERROR`** with the redacted message (the existing catch path already handles this — remove the fallback return);
  - Option B: if a fallback is retained (e.g. to keep the UI functional offline), mark it explicitly — return a distinct shape (e.g. `{ id, name: '... (unverified fallback)', isDefault: false, unverified: true }`) **and** have the gateway/UI treat it as unverified rather than successful discovery. Prefer A unless offline UX requires B.
- **Required regression test:** gateway `GET /api/v1/ai/models?provider=ollama` with an unreachable endpoint returns non-200 (502) with `code: 'AI_PROVIDER_ERROR'` (or, if B is chosen, 200 with `unverified` markers and `isDefault: false`); the raw error does not leak secrets.
- **Acceptance criteria:** a failed provider model-list request reports unavailable/error truthfully (never a fake successful `Default Model` treated as verified); `verify:full` green.
- **What NOT to do:** do not fabricate successful discovery; do not return a hardcoded verified model list as if discovered; do not leak the raw provider error/secret.

## Notes

Both findings are P2; no P1/P0 findings were raised. All other Phase 3G criteria passed: cloud secrets gateway-side and browser-unreadable, no raw readback, single workspace retrieval authority, hard scope bounds, `.openob` isolation, SSRF loopback-only, proposal-only AI with OCC 409 on stale accept, provider failure isolation, stream abort cleanup, standalone local AI, AI-disabled core functionality, `verify:full` green (64 files / 387 tests, 32/32 e2e).

Do not begin the next phase.
