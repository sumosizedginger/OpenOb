# SECURITY

## Threat Model

Protect:

- user-authored files
- attachments
- API keys
- local model endpoints
- plugin permissions
- application configuration
- retrieval context
- user privacy

Potentially hostile inputs include:

- Markdown
- HTML embeds
- external URLs
- plugin packages
- plugin manifests
- AI responses
- AI tool-call arguments
- synced files later
- imported vaults

## Cloud API Secrets

Hosted browser JavaScript must not be treated as a secure place for long-lived cloud API secrets.

Preferred architecture:

```text
Web UI -> localhost gateway -> cloud provider
```

The gateway may use OS-appropriate secure secret storage when available.

The gateway must:

- restrict allowed origins
- never expose stored secrets back to the UI
- redact secrets from logs
- support revocation
- fail closed

## Local Models

Local endpoints such as Ollama/LM Studio may be contacted directly when the user explicitly configures them and browser/runtime security permits.

Do not automatically scan arbitrary localhost ports.

## Markdown Rendering & HTML Policy

Current policy: raw HTML in Markdown is not interpreted by the preview renderer. It is rendered strictly as plain escaped text.

OpenOb does not use a regex HTML sanitizer. All Markdown preview rendering maps directly to native React JSX elements with standard text escaping. The use of `dangerouslySetInnerHTML` is prohibited across the codebase by static analysis and tests in CI.

If raw HTML support is introduced later, use a mature parser-based sanitizer with an explicit allowlist. Do not resurrect regex sanitization.

Treat:

- scripts
- inline event handlers
- dangerous URL schemes
- embedded HTML
- iframes
- SVG
- remote resources

as security-sensitive.

## Plugin Security

Plugins receive explicit capabilities.

Potential permissions:

```text
vault.read
vault.write
vault.delete
workspace.modify
editor.extend
search.query
graph.read
graph.extend
ai.use
ai.provider
network
clipboard
filesystem.external
```

High-risk permissions must be obvious to users.

Plugins must not receive:

- arbitrary Node execution by default
- raw filesystem access by default
- API keys by default
- unrestricted DOM access by default

## AI Tool Execution

Models do not execute side effects directly.

Flow:

```text
model proposes structured tool call
-> validate schema
-> check scope
-> check permission
-> preview if destructive
-> application executes
-> result returned to model
```

## Prompt Injection

Content inside user notes can contain adversarial instructions.

Retrieval content must be treated as data, not higher-priority instructions.

Tool permissions and file-access scope are enforced outside the model.

## Logging

Never log:

- API keys
- full note bodies by default
- raw authentication headers
- complete private prompts unless user explicitly enables debugging

Diagnostics should prefer:

- error code
- subsystem
- app version
- timing
- anonymized size/count information

## Security Review Triggers

Require focused review when adding:

- new plugin permissions
- new filesystem capabilities
- new HTML rendering behavior
- new network behavior
- secret storage
- update mechanism
- installer
- sync
- collaboration
- remote content execution
