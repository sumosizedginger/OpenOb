# CONTEXT

## Product Thesis

Build an open-source knowledge workspace that combines:

- Obsidian-like local ownership, Markdown, links, backlinks, graph navigation, themes, and extensibility.
- Notion-like workspace polish, properties, views, command-driven interaction, and deeply integrated AI.
- Provider independence through BYOK and local model support.
- A permissioned plugin platform that allows the ecosystem to grow without modifying core.

This is not intended to be an Obsidian clone.

It is a local-first knowledge platform whose user data remains understandable outside the application.

## Core User Promise

If this application disappears tomorrow, the user's writing still exists as ordinary files.

Deleting the derived index must never delete user knowledge.

Losing access to all AI providers must not disable ordinary note-taking, search, links, or file access.

## Canonical Data

Canonical:

- Markdown files
- user attachments
- explicitly persisted user configuration
- explicit user-authored metadata

Derived / disposable:

- SQLite indexes
- search caches
- graph caches
- embeddings
- AI retrieval caches
- preview caches
- inferred relationships
- generated summaries unless the user explicitly saves them

## Product Character

The application should feel:

- fast
- calm
- direct
- keyboard-friendly
- inspectable
- local-first
- extensible
- trustworthy

It should not feel like:

- a web dashboard wrapped around a cloud account
- a chatbot with notes bolted on
- an opaque database
- a collection of disconnected plugins
- a framework demo
- an AI-generated enterprise architecture

## Agent Workflow Context

The project is expected to be built with multiple AI coding tools.

One primary implementation agent should own repository-wide architectural continuity. Other agents may review, test, debug, benchmark, or propose alternatives, but they must not independently rewrite foundational architecture without an explicit architectural decision.

Active operating model:

- **Primary foreman:** Google Antigravity 2.0 using Gemini 3.7 Flash.
- **Secondary engineer/adversary:** Reasonix using `deepseek-v4-flash`.
- Gemini owns repository-wide architecture, implementation sequencing, integration, and final merge decisions.
- DeepSeek attacks assumptions, writes/regresses tests, reviews security/performance, and may perform bounded surgical implementation when explicitly assigned.
- The two models must not independently redesign the same subsystem.
- The two models should not edit the same files concurrently.
- DeepSeek findings are reports or bounded patches; Gemini decides how they integrate into the repository.

No workflow step may depend on Gemini 3.7 Flash / Antigravity 2.0, DeepSeek V4 Flash / Reasonix, Grok, or another model being available.

## Critical Development Bias

Prefer boring, explicit, replaceable systems over clever abstractions.

Prefer one well-defined implementation over three speculative abstractions.

Prefer tests over promises.

Prefer reversible decisions over irreversible convenience.

Prefer local ownership over platform dependence.

Prefer user trust over feature count.
