# FAILURE REGISTRY

This is a living document.

Each serious failure mode receives:

- ID
- severity
- scenario
- mitigation
- automated test status
- current owner/status

## Critical

### F-001 Silent file overwrite

**Scenario:** User edits a file externally while the app has an older buffer, then autosave destroys the external change.

**Mitigation:** expected-version/hash checks; conflict UI.

**Test:** required.

### F-002 Partial/corrupt write

**Scenario:** Process/browser crashes during persistence.

**Mitigation:** safe storage-adapter write semantics; atomic/temporary-write strategy where supported; verification.

**Test:** required.

### F-003 Canonical state leaks into index

**Scenario:** Deleting SQLite loses user-visible knowledge that cannot be recovered from files.

**Mitigation:** canonical/derived boundary enforcement; rebuild test.

**Test:** required.

### F-004 Index disagrees with files

**Scenario:** Crash or stale incremental update leaves incorrect links/search results.

**Mitigation:** transactional index updates; version metadata; repair/rebuild path.

**Test:** required.

### F-005 Cloud API key exposure

**Scenario:** Long-lived provider key is accessible to hosted client code or logs.

**Mitigation:** local secure gateway; secret redaction.

**Test:** security review required.

### F-006 Plugin permission escape

**Scenario:** Plugin accesses files/network/API credentials without declared capability.

**Mitigation:** isolated host; capability validation.

**Test:** required before public plugins.

### F-007 Plugin crash kills workspace

**Scenario:** faulty plugin throws or loops and freezes core UI.

**Mitigation:** isolated execution/lifecycle; disable/restart controls.

**Test:** required before public plugins.

### F-008 AI silently mutates files

**Scenario:** model generates destructive edit and app applies it without clear approval.

**Mitigation:** READ/PROPOSE/WRITE separation; validated tool executor.

**Test:** required.

### F-009 AI prompt injection gains capabilities

**Scenario:** note content tells the model to expose secrets or delete files.

**Mitigation:** model content treated as untrusted data; permissions enforced outside model.

**Test:** required.

## High

### F-010 Rename breaks links

Mitigation: authoritative resolver + rename integration tests.

### F-011 Duplicate note names resolve unpredictably

Mitigation: explicit deterministic resolution rules and visible ambiguity.

### F-012 UI freezes during indexing

Mitigation: workers; performance tests.

### F-013 Graph parses independently from index

Mitigation: graph consumes indexed relationships only.

### F-014 Duplicate architecture

Scenario: multiple storage/search/resolution services emerge.

Mitigation: architecture review and dependency boundaries.

### F-015 Semantic search becomes required

Mitigation: lexical search remains first-class.

### F-016 Provider lock-in

Mitigation: normalized provider contracts.

### F-017 Wrapper lock-in

Mitigation: web app remains product; wrapper stays adapter.

### F-018 Unbounded context costs

Mitigation: scoped retrieval; bounded chunks; user-visible scope.

### F-019 Malicious Markdown rendering

Mitigation: sanitizer; restricted URL/HTML policy.

### F-020 Migration breaks old vaults/plugins

Mitigation: migration fixtures + compatibility testing.

## Project-Level

### F-021 Scope explosion

Symptoms:

- sync/mobile/collaboration before editor trust
- multiple incomplete subsystems
- feature count rising faster than tests

Mitigation:

- roadmap gates
- vertical slices
- feature classification

### F-022 AI coding swarm divergence

Symptoms:

- agents create competing implementations
- architecture churn
- duplicated utilities

Mitigation:

- one foreman
- reviewers report rather than rewrite
- mandatory architecture docs
- narrow merge ownership

### F-023 Screenshot-driven development

Scenario: polished demo hides unreliable core.

Mitigation: data-integrity and dogfood gates before cosmetic expansion.

### F-024 Test debt

Scenario: features accumulate faster than regression coverage.

Mitigation: no feature considered done without acceptance tests.

### F-025 Performance decay

Scenario: each feature adds small overhead until normal use feels bad.

Mitigation: repeatable large-vault benchmarks in CI/release process.

### F-026 Stale preview checkbox line mutation

Scenario: clicking a task checkbox in a debounced preview triggers mutation using a stale line number against a shifted live buffer, mutating the wrong task.

Mitigation: content-aware line re-location (`toggleTaskAtLine` with target text verification).

### F-027 End-of-line (EOL) format churn on mutation

Scenario: in-place string mutation splits on `\r?\n` and rejoins with `\n`, silently converting Windows CRLF files to POSIX LF across the entire document.

Mitigation: detect and preserve dominant document EOL delimiter across all mutation utilities.

### F-028 AI Proposal Stale Content Overwrite

Scenario: A user receives an AI diff proposal and continues editing the active document buffer; subsequently clicking "Accept Edit" applies the stale proposed content generated against the earlier baseline, silently destroying all intervening user keystrokes.

Mitigation: Strict divergence check on proposal application comparing `proposal.originalContent` against live buffer and disk snapshots. If modified, the operation aborts with a Conflict and surfaces conflict data rather than overwriting.

### F-029 Model Path Injection Target Redirect

Scenario: Prompt-injection content in a note induces the model to emit a proposal header with an unvetted arbitrary path (e.g. ```` ```proposal:Secrets/Passwords.md ````). The user accepts the proposal believing it applies to their active note, overwriting an unrelated sensitive file.

Mitigation: Proposal parser strictly binds `proposal.path` to the verified `targetPath` of the active note, completely ignoring model-emitted destination paths.

### F-030 Plugin Manifest Mutable Permission Self-Escalation

Scenario: A plugin receives its manifest object via the public API bridge (`api.manifest`) and pushes undeclared capabilities (e.g. `vault.write`, `ai.use`) directly to the mutable array at runtime, causing the capability gatekeeper to approve unauthorized operations.

Mitigation: The gatekeeper captures an immutable `Set<PluginPermission>` at registration time and exposes only a deep-frozen projection of the manifest to plugin instances.

### F-031 Plugin API Concurrency Conflict Catch-All Overwrite

Scenario: A plugin bridge attempts a versioned write to an existing file; upon encountering a `ConflictError` from a concurrent user edit, a generic catch block falls back to an unversioned write (`expectedVersion: null`), silently clobbering the user's modifications.

Mitigation: Distinguish file non-existence from concurrency conflict; never swallow `ConflictError`, allowing concurrency exceptions to propagate to host error containment without modifying disk state.

### F-032 Plugin Realm Capability Boundary Leakage

Scenario: First-party plugins executing in the same JavaScript realm can access `sessionStorage` secrets, `fetch()`, `Function('return this')()`, or the editor DOM outside the `PluginAPI` permission facade.

Mitigation: Document same-realm boundary for first-party plugins; enforce strict Worker/iframe boundary with postMessage capability routing before any third-party plugin distribution is permitted.

### F-033 Browser FSA Non-Atomic Write Interruption

Scenario: Browser File System Access API performs truncate-write via `createWritable()` directly on canonical files. A power loss or tab crash mid-stream results in a truncated or zero-byte canonical note.

Mitigation: Implement atomic temporary file creation and swap (`.okw.tmp.*` followed by `move()`), with explicit capability flags and fallbacks.

### F-034 Silent UTF-8 BOM Stripping

Scenario: User opens a note originating from Windows tooling containing a leading byte order mark (`\uFEFF` / `0xEF,0xBB,0xBF`). Standard `TextDecoder` strips the byte order mark on read, and saving the note drops the BOM, silently altering canonical byte fidelity.

Mitigation: Decode with `{ ignoreBOM: true }`, preserve the leading BOM in the editor buffer and text representation, and record `hasBom` flag in snapshot metadata.

### F-035 False Security Boundary via Regex Sanitizer

Scenario: Relying on regex-based HTML sanitizers creates a false sense of security while leaving entity-encoded attributes, nested tag constructions, or CSS URLs unescaped.

Mitigation: Delete the regex sanitizer. Render raw HTML in Markdown strictly as plain escaped text via React JSX element rendering. Prohibit `dangerouslySetInnerHTML` in CI. If raw HTML interpretation is ever introduced in the future, require an established parser-based sanitizer with an explicit allowlist.

