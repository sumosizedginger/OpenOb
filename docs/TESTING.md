# TESTING

## Philosophy

Tests are institutional memory.

Every significant production bug should become a regression test before or alongside the fix.

The goal is not maximal line coverage.

The goal is to make dangerous failures difficult to reintroduce.

## Test Layers

### Unit

For:

- Markdown parsing
- link normalization
- link resolution
- property parsing
- query parsing
- path normalization
- version/hash comparison
- permission checks

### Integration

For:

- vault adapter + editor save flow
- parser + index
- index + search
- rename + link update behavior
- external-change detection
- index rebuild
- AI retrieval pipeline
- plugin capability enforcement

### End-to-End

For real workflows:

- open vault
- create note
- edit note
- save
- restart
- reopen
- verify exact content

### Torture / Property Tests

Generate:

- random paths
- random filenames
- Unicode
- deeply nested folders
- same-name notes
- malformed Markdown
- huge notes
- dense link graphs
- rename storms

### Performance

Maintain synthetic vaults:

- 1,000 notes
- 10,000 notes
- 50,000 notes
- 100,000 notes

Record:

- startup
- index rebuild
- incremental index
- note open
- FTS query
- graph construction
- memory
- worker utilization

## Critical Data Integrity Cases

Mandatory regression scenarios:

1. crash while saving
2. external file edit while note is open
3. file deleted externally
4. note renamed externally
5. folder renamed externally
6. write permission disappears
7. disk write fails
8. duplicate filenames in different folders
9. case-only rename
10. Unicode normalization differences
11. malformed frontmatter
12. index deleted and rebuilt
13. index partially corrupt
14. two app tabs open same note
15. autosave races with external change

## Rebuild Test

A canonical test must:

1. create a fixture vault,
2. build index,
3. serialize expected relational/search state,
4. delete the index entirely,
5. rebuild from files,
6. verify equivalent results.

If this fails, the index is carrying hidden canonical state.

## Link Tests

Cover:

- `[[Note]]`
- `[[Note|Alias]]`
- heading anchors
- broken links
- multiple candidate targets
- aliases
- moves
- renames
- case behavior
- relative/path-qualified links

## AI Tests

Use deterministic fake providers.

Test:

- provider failure
- stream interruption
- unavailable model
- malformed tool call
- tool permission rejection
- scope restriction
- citation mapping
- prompt injection inside a note
- provider timeout

Never make normal CI depend on paid model APIs.

## Plugin Tests

Test:

- crash isolation
- infinite-loop/timeout handling where possible
- permission denial
- forbidden vault access
- forbidden network access
- version mismatch
- malformed manifest
- duplicate plugin ID
- unload/reload
- settings cleanup

## Release Gate

A release candidate is blocked by:

- known silent data-loss bug
- failing migration test
- failing index rebuild
- critical security regression
- material performance regression without explicit acceptance
