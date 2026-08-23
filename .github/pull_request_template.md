## Summary

<!-- Briefly explain the problem solved and why this change is needed. -->

## Changes

<!-- List the specific files and architectural changes introduced. -->

-

## Verification

<!-- Which tests prove correctness and data safety? -->

- [ ] `npm run verify:full` passes locally (format, lint, typecheck, unit, browser E2E)
- [ ] Added automated tests covering the new behavior / regression
- [ ] Zero silent data loss: Optimistic Concurrency Control (OCC) invariants preserved
- [ ] No private keys or real credentials committed

## Architectural Alignment

- [ ] Markdown files on disk remain canonical (SQLite remains disposable derived state)
- [ ] Loopback Gateway authority and security scopes preserved
- [ ] Clean package boundaries (no illegal internal source imports)
