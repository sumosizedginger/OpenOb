# OpenOb — Phase 3G AI/BYOK Hardening Adversarial Audit

**Audited HEAD:** `0453f52fb3035b7102e0766d958879f679a9046c` (`0453f52 docs(audit): add Phase 3F property mutation views audit`) — `origin/main` == local HEAD. Working tree contains the uncommitted Phase 3G hardening (server AI endpoints, `ai-backend.ts`, secrets/retrieval/proposals changes, tests).
**Audit mode:** read-only; no production code modified; temporary probes in `tests/_reaudit-tmp/` (excluded from vitest/prettier/eslint), run against the real built gateway and real Chromium, then removed; working tree restored.
**Scope:** Phase 3G (AI/BYOK hardening) only. Next phase not audited.
**Reference:** `PHASE3G_AI_GATEWAY_HARDENING_REPORT.md` (informational; findings re-derived from live probes and source).

---

## 1. Baseline

| Step                                                               | Result                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `git rev-parse HEAD`                                               | `0453f52`; `origin/main` == `0453f52`                       |
| Working tree                                                       | Phase 3G changes uncommitted (11 modified + 3 new files)    |
| `rm -rf apps/gateway/dist apps/web/dist packages/*/dist && npm ci` | PASS (0 vulnerabilities)                                    |
| `npm run verify:full`                                              | **PASS (exit 0)** — 64 files / 387 Vitest, 32/32 Playwright |

## 2. No Rewrite (architecture preservation)

- Single `AIProvider` interface (packages/ai/src/types.ts:48) with six adapters: `OpenAICompatibleProvider` (local), `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OpenRouterProvider` — all `implements AIProvider`.
- `AIManager` diff is +10 lines (provider discovery + secret store wiring); `types.ts` +39 (new DTOs). The pre-existing provider/retrieval/proposals architecture was **extended, not duplicated**.
- No second provider abstraction exists.

**PASS.**

## 3. Cloud Secret Browser Leak — CRITICAL

**Real-Chromium probe**: set `OPENOB_AUDIT_SECRET_94c7e3f7a2` through the production web UI (BYOK settings → Save). Scanned every browser-readable surface for the exact string after the PUT completed:

| Surface                                                                        | Raw secret present? |
| ------------------------------------------------------------------------------ | ------------------- |
| sessionStorage (all keys)                                                      | **No**              |
| localStorage (all keys)                                                        | **No**              |
| IndexedDB (all DBs/stores, values dumped)                                      | **No**              |
| DOM (`document.body.innerText`, `outerHTML`)                                   | **No**              |
| URL / `location.href` / `history.state`                                        | **No**              |
| Gateway API responses (`/ai/providers`, `/ai/secrets/:p/status`, `/ai/models`) | **No**              |
| Console / SSE                                                                  | No secret (see S30) |

Secrets live only in the gateway's `ServerSecretStore` (process memory / env). The browser holds the token, never the cloud key. **PASS — no persistent browser-readable cloud key; P1 not triggered.**

## 4. Raw Secret Readback

Enumerated every AI secret/status endpoint with GET/POST/PUT/DELETE and query-flag variants against the real gateway after PUT:

- `GET /api/v1/ai/secrets/openai/status` → `{ configured, masked: "OPE••••••••f7a2" }` — no raw key
- `GET /api/v1/ai/providers` → masked only
- `GET /api/v1/ai/models?provider=openai` → no key
- `POST /api/v1/ai/chat` → no key in response/stream
- `GET /api/v1/ai/secrets/openai` (unlisted route) → 404
- Raw-string scan of every response body: **false** for the test secret

Masking (`prefix + •••••••• + 4-suffix`) is the documented contract. **PASS.**

## 5. Gateway Memory / Env Secret

Live process probes:

1. PUT secret → `configured: true`, masked.
2. **Restart with same token, no env** → `configured: false` — memory-only key disappears; UI truthfully reports not configured.
3. **Restart with `OPENOB_AI_OPENAI_KEY` env** → `configured: true` from env, no PUT needed.
4. Precedence verified: runtime memory override > env fallback > absent (committed test + live).

**PASS — memory key dies on restart; env supplies it only when set; precedence matches docs.**

## 6. Secret Redaction

Mock provider echoing the exact secret in a 401 response body; chat through the gateway:

- Response contains `[REDACTED_API_KEY]` (and `[REDACTED_TOKEN]` for Bearer), **never** the raw secret (byte scan false).
- `redactSecrets()` scrubs known secrets + patterns (Bearer, `sk-ant-`, `sk-`, `AIza`) — unit-verified.

**PASS — secret leak not triggered.**

## 7. Retrieval Authority

Gateway AI chat retrieval (server.ts:850-897) constructs an `AIKnowledgeSource` that calls **only** `workspace.readNote(notePath, clientContext)` and `workspace.queryNotes(..., clientContext)` — the workspace enforces scopes, reserved-path guards, and OCC. The server never instantiates `VaultStorage`/`SafeWriter`/`DocumentIndex` (grep of server.ts: zero such constructions; the only authority is the injected `OpenObWorkspace`). Web `AIChatDrawer` → `GatewayAIBackend`/`LocalAIBackend` → either REST `/api/v1/ai/chat` (gateway) or `LocalWorkspaceBackend` (standalone). No raw storage/index path in the browser.

**PASS — no second vault authority.**

## 8. Current-Note Scope

Fixture A.md (`SECRET_A`) / B.md (`SECRET_B`). `current_note` scope on A.md, query demanding SECRET_B: retrieved context contains **only A** chunks; `SECRET_B` absent (probe: contains SECRET_A = true, contains SECRET_B = false).

**PASS.**

## 9. Folder Scope

`Private/P.md` (`PRIVATE_SECRET_99`) vs `Public/Pub.md` (`PUBLIC_SECRET_77`). Folder scope `Public/`, query matching Public content: context = `Public/Pub.md` only; `PRIVATE_SECRET_99` absent. Empty-result folder does **not** widen to vault (committed test + probe).

**PASS.**

## 10. Vault Scope

Vault scope across all user notes: `.openob`, `.OPENOB`, saved-view JSON, gateway config, secrets all excluded — `.openob/views/v.json` and `.OPENOB/evil.md` (even force-indexed) never enter provider context. Probe: vault paths = `[]` for `.openob` content.

**PASS.**

## 11. MCP-Fresh State

Gateway-mode retrieval reads through `workspace.queryNotes`/`readNote` on the live index — the same index the MCP mutation updates (MCP and REST share the gateway workspace). No browser-local index is used in gateway mode. (Structural; covered by the shared-authority trace in S7.)

**PASS.**

## 12. Reserved Metadata

`.openob` / `.OPENOB` / explicit selected path / folder scope `.openob` / vault — all excluded from provider context via `isReservedOpenObPath` in retrieval and the workspace `resolveNotePath` guard (probe: vault, selected_notes, folder vectors all yield 0/empty `.openob` chunks).

**PASS.**

## 13. Context Bounds

Retrieval is bounded: `maxChunks: 5`, per-note chunk cap (2-5 chunks), `maxTokens: 4096` budget enforced after selection (retrieval.ts:222-242, truncates with an explicit marker). Search is index-driven with `limit` — never a whole-vault read/dump. `formatContextPrompt` emits only the bounded chunks. (10k-note worst case: index query returns ≤10 candidates → ≤5 chunks → token-bounded.) No catastrophic scaling path found.

**PASS.**

## 14. Citation Grounding

`extractCitations` (retrieval.ts:274-339) grounds **note identity**: `[[Wikilink]]` and `[Source: path.md]` citations are created **only** if the target matches a note in the actually-retrieved context (committed test: `[[FakeNote]]` filtered; `[[Quantum Computing]]` kept). Path-level grounding holds.

**However — see S15: line-range grounding is missing.** Path grounding is correct; the structured citation's line range is not.

**PASS for path identity; FAIL for line-range (S15, P2).**

## 15. Line Range Validation — **P2 FINDING**

`extractCitations` source-tag branch (retrieval.ts:310-336) takes the model-claimed line numbers verbatim (`lineStart = Math.max(1, startLine)` from the response regex) **without clamping to the actual retrieved chunk's `lineStart`/`lineEnd`**.

Live probe: retrieved chunk was `A.md` lines **10-20**; model claimed `[Source: A.md (Lines 99999-100000)]` → structured citation emitted with `lineStart: 99999, lineEnd: 100000` — an unsupported range the provider never saw.

Per audit S15: "structured citation does not claim unsupported range. Clamp, reject, or ground to actual retrieved chunk." Not satisfied. **P2** (citation false-grounding) — the clickable citation target is grounded, but its claimed line range is not.

## 16. Provider Endpoint SSRF

`validateLocalEndpointUrl` + `isLoopbackHostname` (openai-compatible.ts:10-67): allows `http://127.0.0.1:*`, `http://localhost:*`, `http://[::1]:*` only. Rejects (probe, all throw before connection):

- `http://169.254.169.254/...` (cloud metadata) ✓
- `http://10.0.0.1:8000/v1`, `http://192.168.1.1:11434/v1` (LAN) ✓
- `https://example.com/v1` (public) ✓
- `file:///etc/passwd`, `ftp://` (non-HTTP) ✓
- `http://metadata.google.internal/v1` ✓

Enforced at validation time **and** at `OpenAICompatibleProvider` construction (probe: metadata endpoint rejected). Cloud providers use fixed HTTPS base URLs (api.openai.com etc.); no user-supplied cloud endpoint override path exists.

**PASS.**

## 17. Authorization

Live + committed scope matrix:

| Scopes                                | Behavior                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `workspace.read` only                 | `GET /api/v1/ai/*` → **403** (AI use denied)                                                    |
| `workspace.ai.use` only (no read)     | chat with retrieval → **403** (workspace.read absent); chat without retrieval allowed by ai.use |
| `workspace.read` + `workspace.ai.use` | chat allowed                                                                                    |
| no `workspace.ai.configure`           | PUT/DELETE secrets → **403**                                                                    |
| Forged scopes in headers/body/query   | no elevation — scopes are server-configured only (server.ts:301 `scopes ?? defaultScopes`)      |

Probe confirmed: providers without ai.use → 403; forged `x-openob-scopes`/body scopes on a valid token don't change the effective set.

**PASS.**

## 18. Default Gateway

Default `openob-gateway` (no `--scopes`) → read-only `[workspace.read, workspace.search]` — no `workspace.ai.use`/`workspace.ai.configure`, so AI endpoints 403 and cloud-secret mutation unavailable. No accidental paid-model capability. (Verified via the S31 read-only probe: notes/search/views/query 200, AI endpoints 403.)

**PASS.**

## 19. Provider Failure Isolation

Real gateway with a hanging mock provider (never responds): client-aborted chat resolves; immediately after, `readNote` **200**, `search` **200**, `/api/v1/events` **200**. Malformed-stream provider: chat ends cleanly (SSE `[DONE]`), workspace ops unaffected. AI cannot wedge the gateway process (per-request `AbortController` on `req.close`, server.ts:935-938).

**PASS.**

## 20. Stream Abort

Slow-streaming mock + client abort: after abort, gateway remains responsive (note read 200); the provider fetch is aborted via the signal chain (server `abortController` → `providerInstance.chat({ signal })` → provider `fetch(signal)`); no unbounded accumulation (per-request stream loop ends on abort/close; `reader.releaseLock()` in finally).

**PASS.**

## 21. Model Listing Truth — **P2 FINDING**

`OpenAICompatibleProvider.listModels` (openai-compatible.ts:90-116) catches fetch failure and returns a **fake fallback** `{ id: defaultModel || 'local-model', name: 'Default Local Model', isDefault: true }`. The gateway serves this as **HTTP 200 success** with no fallback/unverified marking.

Live probe: `GET /api/v1/ai/models?provider=ollama` against a **dead** endpoint → `200 {"models":[{"id":"llama3","name":"llama3","isDefault":true}]}`.

Per audit S21: "Make provider model-list request fail. UI/API must say unavailable/error. Reject fake successful: Default Model unless clearly marked fallback/unverified and not treated as successful provider discovery." Not satisfied — the failure is masked as successful discovery. **P2** (model discovery truth).

## 22. Proposed Edit Only

Grep of AI paths for canonical mutations:

- `packages/ai/src/retrieval.ts`, `proposals.ts`, `ai-manager.ts`, `openai-compatible.ts`, `providers/*`: **no** `updateNote`/`setProperty`/`renameNote`/`deleteNote`/`storage.write`/`safeSave` calls.
- `proposals.ts` has `applyProposedEdit` (SafeWriter) but it is **not** invoked by any AI generation path — only the explicit user-acceptance path in the web app (`applyAIProposedEdit` → `backend.updateNote`, useVault.ts) and the gateway REST update enter the canonical path.
- The server AI chat handler performs retrieval and provider streaming only; no workspace mutation call exists in it.

**PASS — AI generation never calls canonical mutation paths; only explicit user acceptance does.**

## 23. Proposal OCC — CRITICAL

Live gateway probe: browser opens A.md **V1**; proposal generated from V1 (expectedVersion = V1 token); MCP updates A.md V1→V2; user accepts the V1 proposal → **409 Conflict**; **V2 survives byte-for-byte** (disk content + version token verified). No refetch-latest-and-apply. UI keeps the proposal active and surfaces a conflict banner ("Note changed since proposal was generated") for resolution (AIChatDrawer.tsx:286-318).

**PASS — P1 not triggered.**

## 24. ExpectedVersion Source

`parseProposedEditFromResponse` binds the `expectedVersion` passed in — which the server fills from `activeNoteContext.expectedVersion` (the browser-sent version of the note snapshot **AI actually saw**, from the open tab's `initialSnapshot.version`, App.tsx:647-656). The web accept path uses `activeProposal.expectedVersion` (AIChatDrawer.tsx:303-310), falling back to the tab snapshot — never a version fetched at accept time.

**PASS.**

## 25. Dirty Editor

`activeNoteContext.content` = the open tab's **buffer** (`activeTab.content`, App.tsx:646) — which is the human's current editor state (dirty or clean); `expectedVersion` = the tab's open-time snapshot version. The AI reads the explicitly open note's buffer (documented "Current Note" scope = the note the human is viewing). Acceptance via canonical `updateNote` with OCC: if disk diverged, 409 preserves everything; the human's dirty content is never silently discarded (it either folds into the accepted proposal or is preserved on conflict). No silent disk/buffer mixture: content is the buffer, version is the snapshot it was opened from.

**PASS (documented buffer source; OCC protects the dirty buffer).**

## 26. Legacy sessionStorage Migration

`cleanupLegacyBrowserSecrets()` removes all `okw_sec_*` keys on web boot (committed unit test: `okw_sec_openai`, `okw_sec_anthropic` removed; `okw_theme` kept). They are never uploaded to the gateway (no client→gateway secret-sync path exists; the browser holds no cloud keys post-3G) and never console-displayed.

**PASS.**

## 27. Standalone Local AI

`LocalAIBackend` (ai-backend.ts:90-261): local loopback Ollama/LM Studio providers work with `createBackendKnowledgeSource(LocalWorkspaceBackend)` for retrieval; scopes enforced at the workspace level; proposal behavior identical. Cloud providers throw with an explicit isolation notice ("Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application state") — verified in the committed e2e and at source. No browser raw-cloud-key persistence possible (setSecret throws for cloud in standalone).

**PASS.**

## 28. Provider Type Coverage

All six adapters smoke-constructed with mocked configs (probe): `OpenAICompatibleProvider` (loopback endpoint), `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OpenRouterProvider` — each exposes `id`, `chat`, `listModels`, `capabilities`. No paid external calls required. (Ollama/LM Studio share `OpenAICompatibleProvider`.)

**PASS.**

## 29. Gateway AI Not Note Authority

Server has exactly one canonical authority: the injected `OpenObWorkspace`. Zero `VaultStorage`/`SafeWriter`/`DocumentIndex` constructions in server.ts; the AI service retrieves through workspace only and never writes. No direct write authority.

**PASS.**

## 30. Event / Secret Leak

Workspace publishes only note/view/index events (`note.modified`, `note.property_changed`, `view.created`, `index.degraded`); the SSE relay (server.ts:351-403) forwards those only. AI secret set/clear writes to `ServerSecretStore` (memory) with **no event publish**. AI chat writes no workspace events; prompts/context are not emitted into the ordinary event stream. Live probes and source confirm: no cloud secret, no full prompt/context in SSE.

**PASS.**

## 31. AI Disabled

Read-only gateway (no AI scopes): `notes`, `search`, `views`, `query`, `events` all **200**; `/api/v1/ai/*` **403**. Core OpenOb (note CRUD, views, Board, search, MCP, CLI) fully functional without AI.

**PASS.**

## 32. Full Real Browser Flow

Committed e2e (`ai-gateway.spec.ts`, real gateway + web + Chromium + mock provider): secret masking in UI, **zero-browser-storage** verification (sessionStorage/localStorage scan), standalone cloud-BYOK isolation notice — **2/2 pass**. My real-Chromium probe additionally verified the secret appears nowhere (storage/DOM/IndexedDB/API). Chat streaming/citations/proposals/OCC are verified via live gateway + unit/integration probes (S14/15/23/24). The full proposal→MCP→409 browser interaction is covered by the S23 gateway probe + the UI conflict path (AIChatDrawer) + committed OCC tests.

**PASS (with the S15/S21 caveats).**

## 33. Full Gate

| Gate                   | Result                                    |
| ---------------------- | ----------------------------------------- |
| `npm run format:check` | **PASS**                                  |
| `npm run lint`         | PASS (0 errors / 7 pre-existing warnings) |
| `npm run typecheck`    | PASS                                      |
| `npm test`             | **PASS — 64 files / 387 tests**           |
| `npm run build`        | PASS                                      |
| `npm run test:e2e`     | **PASS — 32/32**                          |
| `npm run verify:full`  | **PASS (exit 0)**                         |

## 34. Remote CI

`git ls-remote origin` succeeds; `origin/main` == `0453f52` == local HEAD. GitHub web/API return **404** (private repo, no token) → workflow-run status at this HEAD not observable. Workflow exists (Node 20/22 + Playwright + packaging). **REMOTE CI UNVERIFIED IN THIS ENVIRONMENT.**

## 35. Severity

| ID                                                                            | Severity | Status                                                                                                                             |
| ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S15 citation line-range false-grounding                                       | **P2**   | **OPEN** — model-claimed line range (e.g. 99999-100000) emitted verbatim for a chunk actually at lines 10-20; not clamped/grounded |
| S21 model discovery truth                                                     | **P2**   | **OPEN** — dead local endpoint returns HTTP 200 with a fake `isDefault` model, not unavailable/error                               |
| Cloud secret browser leak                                                     | P1       | CLOSED — no surface exposes raw key                                                                                                |
| Raw secret readback                                                           | P1       | CLOSED — masked only                                                                                                               |
| AI scope bypass / autonomous write / second authority / stale proposal / SSRF | P1       | CLOSED — none found                                                                                                                |
| P0                                                                            | —        | none                                                                                                                               |

---

## 36. Verdict

**STOP — exact blockers: S15 (P2) and S21 (P2).**

The Phase 3G hardening is architecturally sound on every **P1** criterion: cloud secrets are gateway-side and unreadable from the browser (verified across sessionStorage/localStorage/IndexedDB/DOM/URL/history/API/SSE); raw secret cannot be read back; gateway AI retrieval uses the single workspace authority; retrieval scope cannot widen and `.openob` cannot enter context; SSRF is loopback-bounded; AI only proposes edits and stale proposals conflict via OCC (V2 survives byte-for-byte); provider failure does not affect the workspace; standalone local AI works; AI can be disabled without affecting OpenOb; `verify:full` passes (64/387, 32/32).

**However, two P2 closure criteria are not met:**

1. **S15 — structured citations are not fully grounded**: a citation's line range is taken from the model's claim without clamping/validating against the actual retrieved chunk's `lineStart`-`lineEnd`. A model claiming `[Source: A.md (Lines 99999-100000)]` for a chunk at lines 10-20 produces a structured citation claiming that unsupported range. Path identity is grounded; the line-range metadata is not.

2. **S21 — model discovery is not truthful on failure**: a dead local provider endpoint returns HTTP 200 with a fabricated `isDefault` model instead of an unavailable/error state, with no fallback/unverified marking.

Per the audit's own verdict rule ("structured citations are grounded" and truthful model discovery are required conditions), the closure cannot be issued. Remediation is required; see `GEMINI_PHASE3G_REMEDIATION.md`.

Next phase not audited per instruction.
