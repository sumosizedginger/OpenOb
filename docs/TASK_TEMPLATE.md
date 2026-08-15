# CODING TASK TEMPLATE

Use this template when assigning substantial work to a coding agent.

## Objective

Describe one concrete user-visible or architectural outcome.

## Relevant Docs

Mandatory:

- `CONSTITUTION.md`
- `ARCHITECTURE.md`
- `AGENTS.md`

Add subsystem docs as needed.

## Scope

### In scope

- ...

### Out of scope

- ...

## Existing Contracts

List interfaces/modules that must be used rather than bypassed.

## Acceptance Criteria

- [ ] ...
- [ ] ...
- [ ] ...

## Failure Cases to Test

- ...
- ...

## Performance Constraints

- ...

## Security Constraints

- ...

## Required Tests

- unit:
- integration:
- e2e:
- regression:

## Deliverable

The implementing agent must return:

1. files changed
2. tests added/updated
3. commands run
4. results
5. architectural risks discovered
6. unresolved issues
7. whether any constitution rule was challenged
8. a handoff packet suitable for the second model

Default ownership:

- Gemini 3.7 Flash / Antigravity 2.0 = implementation owner
- DeepSeek V4 Flash / Reasonix = adversarial reviewer

For bounded surgical tasks, ownership may be reversed explicitly.
