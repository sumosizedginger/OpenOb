# AI ARCHITECTURE

## Principle

AI is a replaceable capability layer.

It does not own:

- user files
- search
- application state
- graph truth
- permissions

## Provider Contract

```ts
export interface AIProvider {
  id: string;
  listModels(): Promise<AIModel[]>;
  capabilities(model: string): Promise<AICapabilities>;
  chat(request: ChatRequest): AsyncIterable<AIChunk>;
}

export interface EmbeddingProvider {
  id: string;
  embed(input: string[]): Promise<number[][]>;
}
```

Provider-specific logic stays inside adapters.

## Provider Types

Initial architecture should support:

- local OpenAI-compatible endpoint
- Ollama
- LM Studio
- custom endpoint

Cloud provider adapters may include:

- OpenAI
- Anthropic
- Gemini
- xAI
- OpenRouter
- Fireworks
- others through plugins

Do not hard-code product logic around one vendor's message format.

## Context Scopes

Users must be able to choose:

- selection
- current note
- selected notes
- folder
- project/query result
- whole vault

Whole-vault scope is explicit.

## Retrieval

Preferred flow:

```text
user question
-> parse intent
-> choose permitted scope
-> lexical/property/link retrieval
-> optional semantic retrieval
-> rank passages
-> build bounded context
-> call model
-> map answer back to note citations
```

Do not send all files merely because context windows are large.

## Semantic Index

Embeddings are derived state.

They must be:

- rebuildable
- tied to embedding-model metadata
- invalidated when source chunks change
- optional

A user may disable embeddings entirely.

## AI Mutations

Three categories:

### READ

No file mutation.

### PROPOSE

Produces a patch/diff or proposed structured changes.

### WRITE

Application performs an approved mutation.

Default user-facing editing should prefer `PROPOSE`.

## Tool Layer

Example tools:

- searchNotes
- readNote
- listBacklinks
- getProperties
- proposePatch
- createNoteDraft

Avoid handing the model arbitrary shell/filesystem execution through normal AI workspace features.

## Local Gateway

Cloud BYOK gateway responsibilities:

- secret storage
- provider request proxying
- streaming
- capability normalization
- safe logging

It must remain optional.

## Failure Behavior

If AI fails:

- editor remains usable
- search remains usable
- vault remains usable
- unsent edits remain intact
- partial stream can be discarded/retried
- provider-specific failure is surfaced clearly

AI failure must never become workspace failure.
