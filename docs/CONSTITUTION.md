# CONSTITUTION

These are architectural laws.

Agents must not silently violate them.

If a requested change conflicts with this file, stop, explain the conflict, and propose the smallest compatible alternative.

## Data Laws

1. User-authored Markdown/files are canonical truth.
2. Derived indexes are disposable and rebuildable.
3. The application must never require a proprietary document format.
4. User content must remain understandable without this application.
5. No feature may silently overwrite externally modified user content.
6. Data integrity outranks feature delivery.
7. Destructive operations require explicit, inspectable behavior.
8. Migrations must be reversible where practical and backed by tests.

## Runtime Laws

9. The core application is HTML/CSS/TypeScript-first.
10. The product must work without Internet access.
11. The product must work without AI.
12. No account is required for core usage.
13. Heavy parsing, indexing, embeddings, and graph work must not block the UI thread.
14. The core must not depend on Electron or any single wrapper.
15. OS-specific capabilities must sit behind adapters.

## Architectural Laws

16. Storage access occurs through a storage interface.
17. Search occurs through defined search contracts.
18. AI providers occur through provider interfaces.
19. Plugins interact through documented public APIs.
20. Plugins must not import core internals.
21. Graph state is derived from the canonical index, not independently parsed.
22. Link resolution must have one authoritative implementation.
23. Duplicate services solving the same concern are architecture defects.
24. New abstractions require a demonstrated need, not speculation.
25. A feature that can live as a plugin should not automatically become core.

## AI Laws

26. AI is an enhancement, not infrastructure required for note-taking.
27. Search must function without AI.
28. AI retrieval must use explicit scope.
29. AI must not receive the entire vault unless the user explicitly requests that scope.
30. AI-generated relationships must be distinguishable from human-authored relationships.
31. AI must not silently mutate user files.
32. Tool calls proposed by models must be validated and executed by the application.
33. Cloud secrets must not be exposed in hosted client-side JavaScript.
34. Local model support must not require a cloud proxy.

## Plugin Laws

35. Plugins receive capabilities, not unrestricted runtime access.
36. Plugin crashes must not crash the editor.
37. Plugins may not receive API secrets unless explicitly granted.
38. Plugin permissions must be visible before installation or activation.
39. Public plugin APIs are versioned.
40. Once third parties rely on a public API, breaking changes require a migration/deprecation path.

## Product Laws

41. Fast, trustworthy editing comes before graph spectacle.
42. Features do not ship merely because they are visually impressive.
43. Performance regressions are release defects.
44. Data-corruption bugs stop feature development.
45. Architectural divergence stops feature development.
46. Scope expansion requires an explicit roadmap decision.
47. No mandatory telemetry.
48. User data must not be collected for diagnostics without explicit opt-in.
49. The application must degrade gracefully when optional systems fail.
50. The project optimizes for long-term maintainability, not maximum generated code per day.
