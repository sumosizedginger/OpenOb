# HANDOFF PROTOCOL

## Goal

Allow Gemini 3.7 Flash in Antigravity and DeepSeek V4 Flash in Reasonix to cooperate without duplicated work, lost context, or competing architectures.

## Handoff Header

Every handoff begins with:

```text
PROJECT:
MILESTONE:
TASK ID:
OWNER:
REVIEWER:
BASE COMMIT/STATE:
STATUS:
```

## Gemini -> DeepSeek Review Packet

```text
ROLE
You are the adversarial reviewer for this bounded change.
Do not redesign unrelated architecture.

TASK
<what was implemented>

CURRENT MILESTONE
<roadmap phase>

GOVERNING DOCS
<relevant files>

ARCHITECTURAL CONTRACTS
<interfaces/rules>

CHANGED FILES
<diff or file list>

ACCEPTANCE CRITERIA
<criteria>

KNOWN FAILURE MODES
<failure IDs>

DO NOT CHANGE
<explicit boundaries>

REVIEW FOR
- data loss
- race/conflict behavior
- stale derived state
- architecture duplication
- missing tests
- large-vault performance
- security boundary violations
- plugin/AI privilege leaks

OUTPUT
CRITICAL:
HIGH:
MEDIUM:
LOW:
TEST GAPS:
PERFORMANCE:
SECURITY:
ARCHITECTURE:
VERDICT:
```

## DeepSeek -> Gemini Findings Packet

DeepSeek findings should include:

```text
ID:
SEVERITY:
FILE/AREA:
FAILURE SCENARIO:
WHY IT MATTERS:
REPRODUCTION:
RECOMMENDED TEST:
MINIMAL FIX DIRECTION:
ARCHITECTURAL IMPACT:
```

Avoid vague comments such as "could be cleaner."

## Gemini Triage Response

For every finding:

```text
FINDING ID:
DISPOSITION: ACCEPT | TEST-ONLY | DEFER | REJECT | ADR
RATIONALE:
ACTION:
TEST:
```

## Gemini -> DeepSeek Surgical Task

Use only for bounded work.

```text
ROLE
You are implementing one bounded change behind existing architecture.
Do not expand scope.

OBJECTIVE
...

FILES YOU MAY MODIFY
...

FILES YOU MUST NOT MODIFY
...

INTERFACES YOU MUST USE
...

ACCEPTANCE CRITERIA
...

REQUIRED TESTS
...

KNOWN FAILURE MODES
...

RETURN
- files changed
- tests added
- commands run
- results
- risks discovered
- any reason the task could not be completed without architectural change
```

## Handoff Completion

A task is not closed until the owner records:

- final implementation state
- test results
- unresolved risks
- failure-registry updates
- ADR updates
- next allowed roadmap task

This written state is the durable memory between model sessions.
