# Phase 3G Closure Report: AI/BYOK Gateway Hardening + Workspace-Scoped Retrieval

**Repository:** OpenOb  
**Status:** CLOSED & VERIFIED  
**Gate Result:** `npm run verify:full` PASSED (All format, lint, typecheck, 387 unit/integrity tests, and 32 Playwright E2E tests passing)

---

## 1. Architectural Outcomes & Objectives Fulfilled

Phase 3G hardens the OpenOb AI subsystem to adhere strictly to Constitution Laws 17, 18, and 19. It introduces a hardened server-side orchestration model, ensures API keys remain outside the client application state, and enforces workspace-bounded retrieval with strict OCC concurrency on proposed edits.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         OpenOb AI Architecture                           │
└──────────────────────────────────────────────────────────────────────────┘

     Web Browser (UI)                       Authoritative Gateway
 ┌──────────────────────┐               ┌───────────────────────────┐
 │   AIChatDrawer       │               │   Gateway REST & SSE      │
 │  (No secrets,        │──(Bearer)────▶│   (/api/v1/ai/*)          │
 │   No direct storage) │               └─────────────┬─────────────┘
 └──────────┬───────────┘                             │
            │                                         ▼
            │                           ┌───────────────────────────┐
            │                           │   ServerSecretStore       │
            │                           │  (Process Memory + Env)   │
            │                           └─────────────┬─────────────┘
            │                                         │
            │                                         ▼
            │                           ┌───────────────────────────┐
            │                           │    OpenObWorkspace        │
            │                           │  - Scoped Retrieval       │
            │                           │  - .openob exclusion      │
            │                           │  - Grounded Citations     │
            │                           └─────────────┬─────────────┘
            │                                         │
            │                                         ▼
            │                           ┌───────────────────────────┐
            ▼                           │       AI Providers        │
 ┌──────────────────────┐               │  - OpenAI / Anthropic     │
 │  LocalAIBackend      │               │  - Gemini / OpenRouter    │
 │  (Standalone: Ollama │               │  - Local loopback SSRF    │
 │   & LM Studio only)  │               └───────────────────────────┘
 └──────────────────────┘
```

---

## 2. Core Security & Architecture Guarantees

### A. Zero-Browser-Storage & Non-Leakage (Constitution Law 17)

- **ServerSecretStore**: Stores cloud API keys in process memory with environment variable fallback (`OPENOB_AI_OPENAI_KEY`, `OPENOB_AI_ANTHROPIC_KEY`, `OPENOB_AI_GEMINI_KEY`, `OPENOB_AI_OPENROUTER_KEY`).
- **No Client Reflection**: The Gateway API returns only masked secrets (e.g. `sk-••••••••1234`) or configuration status via `GET /api/v1/ai/secrets/:provider/status`. Raw secrets are NEVER returned by any endpoint.
- **Redaction**: All AI error messages and SSE logs pass through `redactSecrets()` to scrub API keys, JWTs, and Bearer tokens.
- **Legacy Cleanup**: On web client boot, `cleanupLegacyBrowserSecrets()` purges any obsolete `okw_sec_*` entries from `sessionStorage`.
- **Standalone Cloud BYOK Notice**: In standalone (local browser) mode, attempting to configure cloud BYOK renders an explicit isolation notice directing the user to connect to OpenOb Gateway.

### B. Local Endpoint SSRF Boundary

- `validateLocalEndpointUrl()` verifies that all local OpenAI-compatible endpoints (e.g. Ollama, LM Studio) resolve strictly to loopback hostnames (`127.0.0.1`, `localhost`, `::1`).
- Non-HTTP protocols (`file://`, `ftp://`), cloud metadata services (`169.254.169.254`, `metadata.google.internal`), private LAN IPs (`192.168.*`, `10.*`), and public hostnames are rejected immediately.

### C. Workspace-Scoped Retrieval & Grounded Citations (Constitution Law 19)

- **AIKnowledgeSource**: AI retrieval executes strictly through `OpenObWorkspace` (or `WorkspaceBackend` in standalone mode) rather than directly touching low-level storage or raw indexes.
- **Scope Hard Bounding**: Retains hard scopes (`selection`, `current_note`, `selected_notes`, `folder`, `vault`). If a scope query produces no matches, the scope is NOT widened to the broader vault.
- **Namespace Isolation**: The reserved `.openob/` directory (and case variants) is strictly excluded from all retrieval results.
- **Grounded Citations**: Citations extracted via `extractCitations()` are validated against the actual `retrievedContext` chunks. Hallucinated references (e.g. `[[ImaginaryNote]]`) not present in retrieved context are filtered out from structured metadata.

### D. Optimistic Concurrency Control (OCC) for ProposedEdits

- `ProposedEdit` objects contain the `expectedVersion` token of the note captured at generation time.
- Applying a proposed edit via `workspaceBackend.updateNote()` uses strict OCC version verification. If the note was modified on disk ($V1 \to V2$) by a human or external agent during LLM generation, the update returns a `409 Conflict`, prompting the user with conflict resolution actions rather than overwriting changes.

### E. Gateway Scopes & Authorization

- `workspace.ai.use`: Grants model/provider discovery and inference capabilities (`GET /api/v1/ai/providers`, `GET /api/v1/ai/models`, `POST /api/v1/ai/chat`).
- `workspace.ai.configure`: Grants permission to update or clear process-memory secrets (`PUT /api/v1/ai/secrets/:provider`, `DELETE /api/v1/ai/secrets/:provider`).
- `workspace.read`: Required when executing chat with note retrieval enabled.
- AI invocation does NOT grant `workspace.write`. Note modifications require explicit user acceptance and execute through the canonical mutation path.

---

## 3. Verification & Test Matrix

| Suite                | Tests | Result | Description                                                                                                                                 |
| :------------------- | :---: | :----: | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit & Integrity** |  387  | PASSED | Secret precedence, SSRF checks, `.openob` namespace isolation, grounded citations, OCC proposal conflict, Gateway REST & scope enforcement. |
| **Playwright E2E**   |  32   | PASSED | Real browser tests: AI BYOK key masking, zero browser storage retention, standalone mode notice, table/board mutations, OCC concurrency.    |
| **Format & Lint**    | 100%  | PASSED | Clean Prettier formatting and ESLint across all packages and apps.                                                                          |
| **Typecheck**        | 100%  | PASSED | Monorepo-wide `tsc --build` type validation.                                                                                                |

---

## 4. Modified & Created Artifacts

- `packages/ai/src/types.ts`: Extended `ProposedEdit` with `expectedVersion`, added `AIResponseMetadata`, `AIProviderInfo`, `AIKnowledgeSource`.
- `packages/ai/src/secrets.ts`: Implemented `ServerSecretStore`, `cleanupLegacyBrowserSecrets`, and `redactSecrets`.
- `packages/ai/src/openai-compatible.ts`: Added `validateLocalEndpointUrl` and SSRF loopback validation.
- `packages/ai/src/retrieval.ts`: Scoped retrieval through `AIKnowledgeSource`, `.openob` isolation, grounded `extractCitations`.
- `packages/ai/src/proposals.ts`: Bound `expectedVersion` to parsed proposals.
- `packages/ai/src/ai-manager.ts`: Added provider discovery and secret store integration.
- `packages/workspace/src/ai-backend.ts`: Created `AIBackend`, `GatewayAIBackend`, and `LocalAIBackend`.
- `apps/gateway/src/server.ts`: Added AI REST endpoints (`/api/v1/ai/*`) and SSE chat streaming with scope enforcement.
- `apps/web/src/components/ai/AIChatDrawer.tsx`: Decoupled from raw storage/index props, consumed `AIBackend`, surfaced OCC conflict banners.
- `apps/web/src/hooks/useVault.ts`: OCC version token binding for proposal application.
- `apps/web/src/App.tsx`: Wired `aiBackend` and `applyAIProposedEdit`.
- `tests/integrity/ai-gateway-hardening.test.ts`: 16 comprehensive unit & integrity tests.
- `tests/e2e/ai-gateway.spec.ts`: 2 Playwright E2E tests.
