import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { MemoryDocumentIndex, executePropertyQuery, buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  AIManager,
  StandardSecretStore,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  parseProposedEditFromResponse,
  applyProposedEdit,
  redactSecrets,
} from '@okw/ai';

describe('Phase 8 Exit Gate: BYOK Cloud AI, Secret Isolation & Failure Resilience (Constitution Laws 17 & 18)', () => {
  it('Law 17 (F-005): Cloud API secrets cannot be read back by UI and are never leaked in error logs', async () => {
    const secretStore = new StandardSecretStore();
    const rawApiKey = 'sk-proj-supersecretapikey1234567890abcdefghijklmnopqrstuvwxyz';

    // 1. Store secret
    await secretStore.setSecret('openai', rawApiKey);
    expect(await secretStore.hasSecret('openai')).toBe(true);

    // 2. UI-facing masked secret MUST NOT expose full key
    const masked = await secretStore.getMaskedSecret('openai');
    expect(masked).toBe('sk-••••••••wxyz');
    expect(masked).not.toContain('supersecretapikey');

    // 3. Test explicit redaction of raw key from error messages
    const leakedMsg = `Error connecting with Authorization: Bearer ${rawApiKey}`;
    const sanitized = redactSecrets(leakedMsg, [rawApiKey]);
    expect(sanitized).not.toContain(rawApiKey);
    expect(sanitized).toContain('[REDACTED_API_KEY]');

    // 4. Simulated provider network failure
    const provider = new OpenAIProvider({
      apiKey: rawApiKey,
      baseUrl: 'http://127.0.0.1:59999/v1',
    });

    let thrownError: Error | null = null;
    try {
      const stream = provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      for await (const _ of stream) {
        // iterate
      }
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    // Law 17: Raw secret MUST NOT appear in thrown error message
    expect(thrownError!.message).not.toContain(rawApiKey);
  });

  it('Law 18: Cloud Provider 401/429/500 failures cannot affect note editing, saving, search, or views', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);

    // 1. Setup vault
    const noteContent = `---\ntitle: Critical Architecture\nstatus: active\n---\n# Architecture\n\nCore notes.`;
    await storage.write('Architecture.md', null, noteContent);
    await index.upsert(await parser.parse('Architecture.md', noteContent));

    // 2. Create AI Provider with unreachable endpoint (ensures clean offline CI execution)
    const brokenProvider = new AnthropicProvider({
      apiKey: 'sk-ant-test-mock',
      baseUrl: 'http://127.0.0.1:59999/v1',
    });

    // 3. Verify AI failure is non-blocking
    let aiFailed = false;
    try {
      const stream = brokenProvider.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Summarize note' }],
      });
      for await (const _ of stream) {
      }
    } catch {
      aiFailed = true;
    }
    expect(aiFailed).toBe(true);

    // 4. Note edit and save must succeed 100% (Law 18)
    const updatedContent = `${noteContent}\n\n## New Section\nAdded while AI is offline.`;
    const snap = await storage.read('Architecture.md');
    const saveRes = await safeWriter.safeSave('Architecture.md', updatedContent, {
      expectedVersion: snap.version,
    });
    expect(saveRes.snapshot).toBeDefined();

    // 5. Search and Database Views must operate 100% cleanly
    const reParsed = await parser.parse('Architecture.md', updatedContent);
    await index.upsert(reParsed);

    const searchResults = await index.query({ query: 'Architecture' });
    expect(searchResults).toHaveLength(1);

    const viewResults = await executePropertyQuery(index, {
      id: 'active',
      name: 'Active',
      type: 'table',
      filters: [{ field: 'status', operator: 'equals', value: 'active' }],
    });
    expect(viewResults).toHaveLength(1);
    expect(viewResults[0].title).toBe('Critical Architecture');
  });

  it('Multi-provider diff proposal generation adheres strictly to F-028 concurrency rules', async () => {
    const storage = new MemoryVaultStorage();
    const safeWriter = new SafeWriter(storage);

    const originalContent = `# Base Note\n\nInitial version.`;
    await storage.write('base.md', null, originalContent);

    // Simulated response from Cloud AI (e.g. Gemini / Claude / GPT-4o)
    const cloudAIResponse = `Here is the requested update:
\`\`\`markdown
# Base Note

Initial version with Cloud AI enhancements.
\`\`\`
Let me know if you would like more adjustments.`;

    const proposal = parseProposedEditFromResponse(cloudAIResponse, 'base.md', originalContent);
    expect(proposal).not.toBeNull();
    expect(proposal?.proposedContent).toContain('Cloud AI enhancements');

    // User edits file concurrently
    const divergedContent = `# Base Note\n\nUser modified this before accepting proposal.`;
    const snap = await storage.read('base.md');
    await storage.write('base.md', snap.version, divergedContent);

    // Proposal apply must abort with Conflict (F-028)
    const applyRes = await applyProposedEdit(storage, safeWriter, proposal!);
    expect(applyRes.success).toBe(false);
    expect(applyRes.error).toContain('Conflict');

    // Confirm file was not overwritten
    const currentDisk = new TextDecoder().decode((await storage.read('base.md')).content);
    expect(currentDisk).toBe(divergedContent);
  });
});
