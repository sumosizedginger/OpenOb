# MODEL OPERATIONS

## Purpose

This document defines how the two currently available coding systems cooperate without producing architecture drift or wasting quota.

## Active Models

### Gemini 3.7 Flash

Environment: Google Antigravity 2.0

Assignment:

- primary foreman
- primary coder
- repository mapper
- architecture owner
- task decomposer
- integration authority
- milestone gatekeeper

Gemini should retain the broadest repository context.

### DeepSeek V4 Flash

Environment: Reasonix

Model selector:

```text
deepseek-v4-flash
```

Use the provider's rolling alias rather than hard-coding a checkpoint unless reproducibility testing explicitly requires a pinned revision.

Assignment:

- adversarial reviewer
- regression-test engineer
- security/performance critic
- bounded surgical coder
- failure-registry maintainer
- second-opinion architecture challenger

## Why the Roles Are Unequal

Two equal foremen create two architectures.

Therefore:

- Gemini decides what the current architecture **is**.
- DeepSeek tries to prove where it fails.
- Gemini integrates accepted fixes.
- DeepSeek verifies that fixes are covered by tests.

This is deliberate asymmetry.

## Quota-Efficient Cycle

Do not send both models the entire repository for every task.

### Gemini receives

- repository/workspace
- governing Markdown docs
- active task
- prior DeepSeek findings if any

### DeepSeek receives

- governing docs relevant to the task
- task specification
- changed files/diff
- relevant interfaces
- relevant tests
- targeted failure-registry entries

This keeps DeepSeek focused and prevents it from spending quota rediscovering the whole project.

## Standard Feature Cycle

### Step 1 — Gemini Specification

Gemini creates a bounded implementation plan containing:

- objective
- files likely touched
- contracts involved
- acceptance criteria
- failure scenarios
- test plan
- non-goals

### Step 2 — Gemini Implementation

Gemini implements only the current milestone/task.

### Step 3 — DeepSeek Attack

Reasonix/DeepSeek reviews the diff.

Required output categories:

```text
CRITICAL
HIGH
MEDIUM
LOW
TEST GAPS
ARCHITECTURE QUESTIONS
PERFORMANCE RISKS
SECURITY RISKS
```

DeepSeek should prefer reproducible scenarios over vague criticism.

### Step 4 — Gemini Triage

Each DeepSeek item becomes:

```text
ACCEPT
TEST-ONLY
DEFER
REJECT
ADR
```

### Step 5 — Fix

Gemini fixes accepted issues.

For a narrow, isolated defect, Gemini may explicitly delegate the fix to DeepSeek.

### Step 6 — DeepSeek Verification

DeepSeek checks:

- failure is covered by a regression test
- test actually fails against the broken behavior
- fix does not introduce a second problem
- architecture rule remains intact

### Step 7 — Gemini Close

Gemini updates:

- task state
- failure registry if needed
- ADR if needed
- roadmap gate status

## Standard Bug Cycle

```text
DeepSeek or Gemini finds bug
-> reproduce
-> regression test first when practical
-> one agent fixes
-> other agent reviews
-> run focused suite
-> run milestone suite
-> update failure registry
```

## Bounded DeepSeek Coding

DeepSeek may be assigned implementation when the task can be described with a hard boundary.

Good assignments:

- add regression tests for conflict handling
- fix one parser edge case
- profile one slow query
- implement one adapter behind an existing interface
- review one migration
- harden one permission check

Bad assignments:

- redesign storage
- "improve architecture"
- refactor the whole repo
- build the next three roadmap phases
- replace the index layer

## File Ownership During a Task

Never have both agents actively modify the same files at once.

Before handing implementation to DeepSeek:

1. Gemini stops editing the target files.
2. The exact base commit/state is recorded.
3. DeepSeek works on the bounded task.
4. Gemini reviews and integrates.
5. Only then does normal Gemini implementation resume.

## Context Packet

Every cross-model handoff should contain:

```text
TASK
CURRENT MILESTONE
GOVERNING RULES
ARCHITECTURAL CONTRACTS
FILES/DIFF
ACCEPTANCE CRITERIA
KNOWN FAILURE MODES
WHAT NOT TO CHANGE
REQUESTED OUTPUT
```

See `HANDOFF_PROTOCOL.md`.

## Model-Disagreement Rule

If Gemini and DeepSeek disagree about architecture:

1. stop implementation of the disputed architectural change,
2. write the competing claims,
3. test whether the disagreement is empirically resolvable,
4. compare against `CONSTITUTION.md`,
5. record an ADR if the decision is consequential,
6. Gemini makes the final repository decision,
7. DeepSeek records remaining risk if disagreement persists.

Do not alternate architectures back and forth.

## Quota Protection

To avoid wasting remaining quota:

- do not ask DeepSeek to restate repository docs
- do not ask both models to implement the same full feature competitively
- use DeepSeek for high-value adversarial work
- use diffs instead of full repository dumps when possible
- batch related review questions
- preserve findings in Markdown so models do not have to rediscover them
- convert every discovered bug into a permanent test
