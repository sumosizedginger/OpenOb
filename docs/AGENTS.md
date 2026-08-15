# AGENTS

## Mission

Build this repository with two active coding systems while preserving one coherent architecture.

The objective is not maximum code output.

The objective is a trustworthy system that becomes harder to break as it grows.

## Active Toolchain

### Foreman

- Environment: **Google Antigravity 2.0**
- Model: **Gemini 3.7 Flash**

Gemini is the single repository-wide authority for:

- architecture
- task sequencing
- primary implementation
- integration
- migrations
- dependency direction
- merge decisions
- milestone exit decisions
- documentation consistency

### Secondary Engineer / Adversary

- Environment: **Reasonix**
- Model: **`deepseek-v4-flash`**

DeepSeek is responsible for:

- adversarial design review
- failure-mode discovery
- regression-test design
- bounded bug fixes
- bounded surgical implementation
- performance review
- security review
- edge-case generation
- diff review
- checking whether milestone gates are actually satisfied

DeepSeek does **not** independently replace foundational architecture.

## Mandatory Reading

Before changing production code, both agents must read:

- `START_HERE.md`
- `CONTEXT.md`
- `MODEL_OPERATIONS.md`
- `CONSTITUTION.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `HANDOFF_PROTOCOL.md`
- `TESTING.md`
- `SECURITY.md`
- `FAILURE_REGISTRY.md`

For AI work, also read `AI_ARCHITECTURE.md`.

For plugin work, also read `PLUGIN_ARCHITECTURE.md`.

## Rule Zero

If a task conflicts with `CONSTITUTION.md`, do not silently implement it.

Report:

1. the rule in conflict,
2. why the proposed change violates it,
3. the smallest compatible alternative.

## Single-Writer Architecture Rule

At any moment, one agent owns the implementation task.

Do not have Gemini and DeepSeek simultaneously edit the same subsystem or files.

Default cycle:

```text
Gemini scopes/specifies
-> Gemini implements
-> DeepSeek reviews/attacks/tests
-> Gemini integrates/fixes
-> DeepSeek verifies regression coverage
-> Gemini closes milestone/task
```

For bounded DeepSeek implementation:

```text
Gemini defines exact task boundary
-> DeepSeek implements only that boundary
-> Gemini reviews integration
-> tests run
-> Gemini merges
```

## Architecture Authority

Only Gemini may approve changes to:

- canonical vs derived state
- core interfaces
- package boundaries
- link-resolution rules
- storage semantics
- plugin permission model
- AI provider contracts
- migrations
- public APIs

DeepSeek may challenge any of these and should do so aggressively when warranted.

A challenge becomes an architecture change only after it is recorded and accepted.

## No Architecture Freelancing

Neither agent may casually:

- create a second storage abstraction
- add a second authoritative link resolver
- invent alternate document identity schemes
- bypass public interfaces for convenience
- make SQLite canonical
- add mandatory cloud infrastructure
- introduce microservices
- give plugins unrestricted runtime access
- give AI direct filesystem authority
- rewrite working architecture because another pattern looks cleaner

## Task Protocol

For every non-trivial task:

1. Read relevant docs and current implementation.
2. State the concrete outcome.
3. Identify touched contracts.
4. Define acceptance criteria.
5. Identify failure cases.
6. Implement the smallest coherent vertical slice.
7. Add tests.
8. Run relevant tests.
9. Review the diff for architecture drift.
10. Pass the task through the second model.
11. Resolve findings.
12. Update docs/ADR if public architecture changed.
13. Close only when acceptance gates pass.

## Vertical Slice Rule

Good:

> open one Markdown file -> edit -> safe save -> restart -> exact recovery -> tests

Bad:

> scaffold editor + graph + AI + plugins + sync at once

## DeepSeek Review Mandate

When reviewing a Gemini change, DeepSeek should attempt to answer:

- How can this lose user data?
- How can this produce stale state?
- What happens if the process dies halfway?
- What happens if the same file changes externally?
- What happens with weird filenames or Unicode?
- What happens with 100,000 notes?
- Can a plugin or model bypass intended permissions?
- Is there duplicated responsibility?
- Is derived state becoming accidentally canonical?
- Is this feature actually core, or should it be a plugin?
- What test would catch this failure forever?

A useful review should produce concrete failure scenarios, not aesthetic preferences.

## Gemini Integration Mandate

When receiving a DeepSeek review, Gemini must classify each finding:

- `ACCEPT` — valid; implement fix
- `TEST-ONLY` — architecture is correct but regression coverage is needed
- `DEFER` — valid but outside current milestone; record it
- `REJECT` — explain why it does not apply
- `ADR` — requires an explicit architecture decision

Do not silently ignore findings.

## Refactoring Rule

Refactoring is justified when it:

- removes duplication
- clarifies a real boundary
- fixes a demonstrated design problem
- improves testability
- measurably improves performance
- enables an accepted roadmap requirement

"Cleaner" alone is not enough.

## Data Integrity Stop Rule

Any possible silent data loss is severity critical.

If found:

1. stop unrelated feature work,
2. reproduce,
3. add a failing regression test,
4. fix,
5. run the corruption/conflict suite,
6. update `FAILURE_REGISTRY.md`,
7. have the second model verify the test actually exercises the failure.

## Performance Stop Rule

Indexing, parsing, graph work, embeddings, and plugin work must not make typing or ordinary navigation feel blocked.

Material regression means feature work pauses until measured and understood.

## Pull Request Questions

Every substantial change must answer:

- What problem is solved?
- Why does this belong in core instead of a plugin?
- Which contracts are involved?
- What new state exists?
- Is it canonical or derived?
- Can derived state be rebuilt?
- What happens if the process crashes halfway?
- What happens if the underlying file changes externally?
- What happens offline?
- What happens at large-vault scale?
- Does file format change?
- Is migration required?
- Which tests prove correctness?
- Which failure-registry entries apply?
- What did the second model find?

## Stop Conditions

Stop and escalate when:

- silent data corruption is possible
- two systems own the same responsibility
- canonical and derived state blur
- a migration lacks proof
- plugin permissions can be escaped
- secrets reach untrusted client code
- performance materially regresses
- the requested work requires jumping ahead of current roadmap gates
