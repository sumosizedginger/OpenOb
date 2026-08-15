# CONTRIBUTING

## Before You Code

Read:

- `CONSTITUTION.md`
- `ARCHITECTURE.md`
- `AGENTS.md`

For AI or plugin changes, read the corresponding architecture file.

## Feature Classification

Every proposed capability must be classified:

- `CORE`
- `PLATFORM`
- `PLUGIN`
- `LATER`
- `NO`

Examples:

| Feature | Classification |
|---|---|
| Safe file write | CORE |
| Link resolver | CORE |
| Search index | CORE |
| Plugin API | PLATFORM |
| Character Bible | PLUGIN |
| Calendar | PLUGIN |
| Sync | LATER |
| Real-time cursors | LATER |

## Required PR Description

Include:

1. Problem
2. Scope
3. Why this layer owns the behavior
4. Canonical vs derived state impact
5. Failure behavior
6. Tests
7. Performance impact
8. Security impact
9. Migration impact
10. Plugin-vs-core justification

## Architecture Decision Records

For foundational changes, add:

```text
docs/decisions/ADR-XXXX-short-title.md
```

Include:

- Context
- Decision
- Alternatives considered
- Consequences
- Reversal strategy

## Dependency Policy

Prefer established, focused dependencies.

Before adding a major dependency, explain:

- what problem it solves
- why existing dependencies cannot
- bundle/runtime impact
- maintenance activity
- license compatibility
- replacement cost

Avoid dependencies for trivial utilities.

## Definition of Done

A feature is done when:

- acceptance criteria pass
- tests exist
- error states are explicit
- docs/contracts are updated
- architecture boundaries remain intact
- no known integrity regression exists
- performance is acceptable


## Two-Model Review Requirement

For substantial core changes:

1. Gemini 3.7 Flash implements or integrates.
2. DeepSeek V4 Flash reviews against the failure registry and acceptance criteria.
3. Gemini triages findings.
4. Accepted failures receive tests.
5. DeepSeek verifies the regression coverage for critical/high findings where quota permits.

Do not use competitive parallel rewrites of the same feature.
