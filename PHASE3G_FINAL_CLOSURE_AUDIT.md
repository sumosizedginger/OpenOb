# OpenOb — Phase 3G Final Closure Re-Audit (G3G-1 + G3G-2)

**Audited HEAD:** `8f56e249fb94953ce2120ea51bbb626a941302ba` (`8f56e24 feat(ai): Phase 3G gateway hardening, workspace-scoped retrieval, citation grounding, and truthful model discovery`). Working tree **clean** at audit start and end. `origin/main` == `0453f52` (prior phase HEAD); pushed to sync at close.
**Audit mode:** read-only; no production code modified; temporary probes in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway and real Chromium, then removed.
**Scope:** G3G-1 (citation line-range grounding) + G3G-2 (truthful model discovery) only. Next phase not audited.
**Authority:** `PHASE3G_AI_BYOK_HARDENING_AUDIT.md` (prior verdict STOP, 2 P2 blockers) + `GEMINI_PHASE3G_REMEDIATION.md` (G3G-1/G3G-2 fix scope) + `PHASE3G_REMEDIATION_CLOSURE_REPORT.md` (informational; re-derived from live probes).

---

## 1. Baseline

| Step                                                               | Result                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `git rev-parse HEAD`                                               | `8f56e24`                                                 |
| `git status --short`                                               | **clean (0 entries)**                                     |
| `git log -10 --oneline`                                            | `8f56e24` (Phase 3G remediation) on top of `0453f52` …    |
| `git ls-remote origin refs/heads/main`                             | `0453f52` (pre-remediation); pushed to `8f56e24` at close |
| `git diff --check`                                                 | PASS (exit 0)                                             |
| `rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci` | PASS (0 vulnerabilities)                                  |
| `npm run verify:full`                                              | **PASS (exit 0)** — see §22                               |

## 2. G3G-1 — In-Range Citation

Live probe: retrieved `A.md` lines 10-20; model claims `[Source: A.md (Lines 12-15)]`:

```
{"notePath":"A.md","noteTitle":"Note A","lineStart":12,"lineEnd":15}
```

Exact legitimate range preserved. **PASS.**

## 3. G3G-1 — Partial Overlap

| Claim   | Retrieved chunk | Result                                         |
| ------- | --------------- | ---------------------------------------------- |
| `15-30` | 10-20           | **clamped `[15,20]`** — does NOT claim 21-30 ✓ |
| `1-12`  | 10-20           | **clamped `[10,12]`** ✓                        |

**PASS.**

## 4. G3G-1 — Completely Out-of-Range

Claim `99999-100000` for retrieved chunk 10-20:

```
{"notePath":"A.md","noteTitle":"Note A"}   // no lineStart/lineEnd
```

Path-grounded citation with **no trusted line range**; no fabrication of `10-20` as if the model cited it. **PASS.**

## 5. G3G-1 — Multi-Chunk Note

Retrieved: `A.md 10-20` and `A.md 40-50`. Model claims `12-15` (→ `[12,15]` ✓), `42-45` (→ `[42,45]` ✓), `18-42` (→ **path only**, no false continuous 18-42 ✓), `25-30` (gap → **path only** ✓). Path-only is used where no single truthful range exists.

**PASS.**

## 6. G3G-1 — Invalid Ranges

| Input                                                       | Result                               |
| ----------------------------------------------------------- | ------------------------------------ |
| `(Lines 0-2)`                                               | no crash; no line range emitted ✓    |
| `(Lines 20-10)` (reversed)                                  | no crash; no line range ✓            |
| `(Lines 99999999999999999999-100000000000000000000)` (huge) | no crash; no line range ✓            |
| `(Lines 12)` (missing end)                                  | `[12,12]` (truthful single-line) ✓   |
| `(Lines abc-def)` (malformed)                               | regex doesn't match; no line range ✓ |

Defensive validation in `groundLineRange` (`Number.isSafeInteger`, `start >= 1`, `end >= start`). **PASS.**

## 7. G3G-1 — Hallucinated Path

Only `A.md` retrieved; model cites `B.md`, `NeverRetrieved.md`, `[[Secret Note]]` → **zero structured citations** emitted. Path-grounding remains closed. **PASS.**

## 8. G3G-1 — Implementation Inspection

`extractCitations` (packages/ai/src/retrieval.ts:346-432) validates line ranges against **`availableDocs` = the exact `retrievedSources` passed to that generation** (the chunks actually sent to the provider), via `groundLineRange(rawStart, rawEnd, matchingChunks)` (retrieval.ts:279-338). It does **not** validate against all vault notes, the current disk note, or a browser index — only against the retrieved context of that generation. Hallucinated paths (not in `retrievedSources`) never become citations (`findDoc` grounding check, line 406-407).

**PASS.**

## 9. G3G-2 — Dead Provider

Real gateway, `GET /api/v1/ai/models?provider=ollama` with endpoint pointed at an unused loopback port (127.0.0.1:1):

```
502 {"code":"AI_PROVIDER_ERROR","message":"fetch failed"}
```

**Non-200 provider-unavailable response with `AI_PROVIDER_ERROR` — no 200 + fabricated model.** **G3G-2 CLOSED.**

## 10. G3G-2 — Search All Fallbacks

- `OpenAICompatibleProvider.listModels` (openai-compatible.ts:82-106): the catch block fabricating `Default Local Model` is **removed**; fetch failures and HTTP non-200 propagate as thrown errors.
- `AIManager.listModels` (ai-manager.ts): the catch returning `{ id: 'default-model', name: 'Default Model', isDefault: true }` is **removed** — propagates provider errors.
- grep of production code for `Default Model` / `Default Local Model` / `default-model` / `local-model` + catch blocks around `listModels`: no remaining failure path fabricates successful discovery. (`defaultModel` remains only as an operator configuration value used to mark `isDefault` on genuinely-fetched model lists — allowed as configuration, not as fake discovery.)

**PASS.**

## 11. G3G-2 — Invalid Model Response

Mock endpoint returns HTTP 200 with invalid JSON (`{not valid json`):

```
502 {"code":"AI_PROVIDER_ERROR","message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}
```

Truthful provider error; no fake fallback. **PASS.**

## 12. G3G-2 — Provider HTTP Error

Mock endpoint returns HTTP 500 with body echoing the test secret:

```
502 {"code":"AI_PROVIDER_ERROR","message":"Failed to fetch models: HTTP 500: {\"error\":\"boom [REDACTED_API_KEY]\"}"}
```

Truthful discovery error; **no fake models; no raw secret leakage** (byte-scan of the full body for the secret: absent). **PASS.**

## 13. G3G-2 — Recovery

- Dead provider → `502 AI_PROVIDER_ERROR`.
- Provider comes online (mock returns `llama3-real`) → retry → **200 `{"models":[{"id":"llama3-real",...}]}`** — actual models load, `isDefault: false` (not fabricated).
- No gateway/workspace corruption between states.

**PASS.**

## 14. G3G-2 — Browser Model Picker

Committed e2e `ai-gateway.spec.ts` test 3 (real Chromium): select Ollama (dead in test env) → UI shows **Retry button + model select shows "Unavailable"** and does **not** contain `llama3` (no fake option); switch to configured OpenAI → **GPT-4o appears**. UI state (AIChatDrawer.tsx:65-68, 116-140, 475-501) clears stale models on provider switch, disables the selector on error, and renders a truthful unavailable/retry state.

**PASS.**

## 15. Secret Redaction Regression

Model-list error path carries the exact test secret (`sk-model-error-secret-9876543210`) in the provider response; gateway redacts via `redactSecrets` + `secretStore.getAllKnownSecrets()` (server.ts:1085-1093). Scanned: HTTP body — **raw secret absent** (`[REDACTED_API_KEY]` present); DOM/console covered by the browser probe in S16 (no raw key anywhere).

**PASS.**

## 16. P1 Cloud Secret Regression (spot-check)

Real Chromium: set `OPENOB_AUDIT_SECRET_94c7e3f7a2` through the production web UI. After submit:

| Surface                                                                      | Raw key present? |
| ---------------------------------------------------------------------------- | ---------------- |
| sessionStorage / localStorage                                                | **No**           |
| DOM (`innerText`, `outerHTML`)                                               | **No**           |
| URL / history                                                                | **No**           |
| AI status endpoints (`/ai/providers`, `/ai/secrets/:p/status`, `/ai/models`) | **No**           |

**PASS — no P1 regression.**

## 17. Retrieval Authority Regression (spot-check)

Gateway AI chat with retrieval against a dead provider: response **does not contain retrieved note content** (`SECRET_A` absent from the error). The retrieval path remains `workspace.readNote`/`workspace.queryNotes` (server.ts:850-897); no raw `VaultStorage`/browser `DocumentIndex` regression. **PASS.**

## 18. Scope Regression (spot-check)

- `current_note` A.md: `BBB_2` (from B.md) absent from context ✓
- folder `Priv`: `PPP_3` present, no widening ✓
- vault scope: `.openob` chunks absent ✓

**PASS.**

## 19. SSRF Regression (spot-check)

`127.0.0.1` allowed; `169.254.169.254`, `192.168.1.1`, `https://example.com` all rejected. **PASS.**

## 20. Proposal OCC Regression (spot-check)

V1 AI proposal; MCP V1→V2; accept old proposal → **409 Conflict**; **V2 survives byte-for-byte** (`# A\nMCP V2` on disk). **PASS.**

## 21. AI Disabled Regression (spot-check)

No AI scopes: notes/search/views all **200**; `/api/v1/ai/providers` **403**. Core OpenOb fully operational. **PASS.**

## 22. Full Clean Gate

From clean generated state (`rm -rf .../dist && npm ci`, 0 vulnerabilities):

| Gate                   | Result                                    |
| ---------------------- | ----------------------------------------- |
| `npm run format:check` | **PASS**                                  |
| `npm run lint`         | PASS (0 errors / 8 pre-existing warnings) |
| `npm run typecheck`    | PASS                                      |
| `npm test`             | **PASS — 64 files / 392 tests**           |
| `npm run build`        | PASS                                      |
| `npm run test:e2e`     | **PASS — 33/33**                          |
| `npm run verify:full`  | **PASS (exit 0)**                         |

**Vitest count:** 64 files / 392 tests. **Playwright count:** 33/33.

## 23. Stress

Citation grounding matrix + dead-provider/recovery integration run **20 consecutive times**: **20/20 passed, 0 failures, no flake.**

## 24. Remote CI

`git ls-remote origin` succeeds; GitHub web/API return **404** (private repo, no token) → workflow-run status at this exact HEAD not observable from this environment. Workflow `.github/workflows/ci.yml` runs Node 20/22 matrix + Playwright + packaging. **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.** CI existence not denied; full gate replayed locally and green.

## 25. Severity

| ID                                                                                      | Severity | Status                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| G3G-1 citation line-range false-grounding                                               | P2       | **CLOSED** — in-range preserved, partial overlap clamped, out-of-range/multi-chunk/invalid → path-only, no false ranges  |
| G3G-2 fake model discovery success                                                      | P2       | **CLOSED** — dead/invalid/HTTP-500 provider → 502 `AI_PROVIDER_ERROR`, no fabricated models, recovery works, UI truthful |
| Cloud key exposure / scope / auth / SSRF / AI write / stale proposal / second authority | P1       | CLOSED (no regression — spot-checks S16-S21)                                                                             |
| P0                                                                                      | —        | none                                                                                                                     |

---

## 26. Verdict

**AI/BYOK ARCHITECTURE HARDENED.**

All closure criteria met, with independent live evidence:

- **No structured citation claims unretrieved lines** — in-range `12-15` preserved; partial overlaps clamped to the intersection (`15-30`→`[15,20]`, `1-12`→`[10,12]`); fully out-of-range (`99999-100000`) and multi-chunk/discontiguous claims (`18-42`, `25-30`) emit **path-only** citations with no line metadata; invalid ranges (`0-2`, `20-10`, huge ints, malformed tokens) never crash and never emit an unsupported range.
- **Legitimate in-range citations preserve useful metadata** (lineStart/lineEnd retained when truthful).
- **Multi-chunk notes cannot create false continuous ranges** (Case D omits the range).
- **Hallucinated paths remain untrusted** (`B.md`, `NeverRetrieved.md`, `[[Secret Note]]` → no citation).
- **Dead provider does not return fake successful models** — 502 `AI_PROVIDER_ERROR` for unreachable/invalid-JSON/HTTP-500 endpoints; no `Default Model`/`local-model` fabrication anywhere in production code.
- **Gateway/UI truthfully show model discovery failure** — redacted 502 + browser Retry/Unavailable state with no stale or fake options (real Chromium verified).
- **Provider recovery works** — dead → 502, online → real models load; no corruption.
- **Prior P1 architecture remains closed** — cloud key absent from all browser surfaces and AI endpoints (real Chromium), retrieval via single workspace authority, scope bounds intact, SSRF loopback-only, proposal OCC 409 with V2 surviving, AI-disabled core fully functional.
- **Clean `verify:full` passes** — 64 files / 392 Vitest, 33/33 Playwright, exit 0; 20× stress loop clean.
- **Final tree is committed and clean** (HEAD `8f56e24`, pushed to `origin/main`).

No remaining blockers. Next phase not audited per instruction.
