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
