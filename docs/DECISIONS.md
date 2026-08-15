# DECISIONS

Record product and architecture decisions here until they become large enough for dedicated ADRs.

## D-001 Canonical format

**Decision:** Markdown and ordinary attachments are canonical user data.

**Reason:** portability, openness, recoverability, external-editor compatibility.

## D-002 Derived index

**Decision:** search/link/graph indexes are disposable.

**Reason:** corruption or deletion of the app database must not destroy knowledge.

## D-003 HTML-first

**Decision:** core UI and application logic are built with web technologies.

**Reason:** broad tooling support, fast iteration, wrapper independence.

## D-004 Modular monolith

**Decision:** do not use microservices for the local application.

**Reason:** unnecessary deployment/coordination complexity.

## D-005 AI optional

**Decision:** every core knowledge workflow works without an AI provider.

## D-006 Cloud BYOK gateway

**Decision:** cloud secrets use an optional local gateway rather than being embedded into hosted browser code.

## D-007 Plugin permissions

**Decision:** extensions use explicit capabilities and public APIs.

## D-008 No sync in early core

**Decision:** cross-device sync is postponed until local data semantics are mature.

## D-009 Views over files

**Decision:** Notion-like database views derive from open Markdown properties rather than an opaque canonical block database.

## D-010 Agent governance

**Decision:** Gemini 3.7 Flash in Google Antigravity 2.0 is the primary implementation/architecture foreman. DeepSeek V4 Flash in Reasonix is the adversarial reviewer and bounded secondary implementer.

**Reason:** one architectural authority prevents two-model divergence while retaining independent failure discovery.

## D-011 SafeSave ExpectedVersion & Content Hash Concurrency

**Decision:** Storage write operations require `expectedVersion` concurrency verification against file mtime and FNV/SHA content hashes. Unconditional overwrite requires explicit user force flag.

**Reason:** Prevents `F-001` (silent data overwrite) and `F-002` (partial corrupt write) in multi-tab, external editor, and rapid autosave workflows.

