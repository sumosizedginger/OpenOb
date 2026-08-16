import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { MemoryDocumentIndex, executePropertyQuery, buildGraphData } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  OpenAICompatibleProvider,
  retrieveContext,
  formatContextPrompt,
  extractCitations,
  parseProposedEditFromResponse,
  applyProposedEdit,
} from '@okw/ai';

describe('Phase 7 Exit Gate: Local AI, Scoped Retrieval & Proposal Safety (Constitution Laws 18 & 19)', () => {
  it('Law 18: Disabling AI or provider failure leaves all vault, search, graph, and views operations 100% functional', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    // 1. Seed vault
    const notes = {
      'Notes/A.md': `---\ntitle: Note A\nstatus: active\n---\n# Note A\n\nLinks to [[B]].`,
      'Notes/B.md': `---\ntitle: Note B\nstatus: draft\n---\n# Note B\n\nContent B.`,
    };

    for (const [path, content] of Object.entries(notes)) {
      await storage.write(path, null, content);
      await index.upsert(await parser.parse(path, content));
    }

    // 2. Simulate AI provider failing / offline
    const brokenProvider = new OpenAICompatibleProvider({
      endpointUrl: 'http://127.0.0.1:99999/v1',
      defaultModel: 'offline-model',
    });

    const models = await brokenProvider.listModels();
    expect(models).toHaveLength(1); // Graceful fallback, no thrown exception

    // 3. Verify Search is 100% functional
    const searchResults = await index.query({ query: 'Note' });
    expect(searchResults).toHaveLength(2);

    // 4. Verify Graph is 100% functional
    const graphData = await buildGraphData(index);
    expect(graphData.nodes).toHaveLength(2);
    expect(graphData.edges).toHaveLength(1);

    // 5. Verify Notion Views are 100% functional
    const viewResults = await executePropertyQuery(index, {
      id: 'active',
      name: 'Active',
      type: 'table',
      filters: [{ field: 'status', operator: 'equals', value: 'active' }],
    });
    expect(viewResults).toHaveLength(1);
    expect(viewResults[0].title).toBe('Note A');
  });

  it('Law 19: AI operations cannot bypass permissions or write to disk without explicit proposal acceptance', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);

    const originalContent = `# Restricted Document\n\nConfidential company plans.`;
    await storage.write('Confidential.md', null, originalContent);
    await index.upsert(await parser.parse('Confidential.md', originalContent));

    // Simulated AI response proposing destructive change
    const maliciousAIResponse = `I recommend rewriting this entire note:
\`\`\`markdown
# Compromised Document
Deleted all confidential data.
\`\`\`
Done!`;

    // 1. Parse proposal (PROPOSE mode only)
    const proposal = parseProposedEditFromResponse(
      maliciousAIResponse,
      'Confidential.md',
      originalContent
    );

    expect(proposal).not.toBeNull();

    // 2. Assert disk content is 100% UNTOUCHED (zero silent writes!)
    const currentDiskSnap = await storage.read('Confidential.md');
    const currentDiskText = new TextDecoder().decode(currentDiskSnap.content);
    expect(currentDiskText).toBe(originalContent);

    // 3. User rejects proposal -> file remains intact
    expect(new TextDecoder().decode((await storage.read('Confidential.md')).content)).toBe(
      originalContent
    );

    // 4. User accepts proposal -> file safely updated via SafeWriter
    const applyResult = await applyProposedEdit(storage, safeWriter, proposal!);
    expect(applyResult.success).toBe(true);

    const updatedDiskText = new TextDecoder().decode(
      (await storage.read('Confidential.md')).content
    );
    expect(updatedDiskText).toContain('# Compromised Document');
  });

  it('P7-1 (F-028) Regression: Rejects proposal apply if note diverged after proposal streamed', async () => {
    const storage = new MemoryVaultStorage();
    const safeWriter = new SafeWriter(storage);

    const initialContent = `# Note\n\nInitial draft.`;
    await storage.write('note.md', null, initialContent);

    // Model streams proposal based on initial content
    const proposal = parseProposedEditFromResponse(
      '```markdown\n# Note\n\nAI improved version.\n```',
      'note.md',
      initialContent
    );
    expect(proposal).not.toBeNull();

    // User types additional keystrokes before clicking Accept
    const snap = await storage.read('note.md');
    const modifiedContent = `# Note\n\nInitial draft with user edits made in parallel.`;
    await storage.write('note.md', snap.version, modifiedContent);

    // Attempting to apply stale proposal must fail closed with Conflict
    const result = await applyProposedEdit(storage, safeWriter, proposal!);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Conflict');

    // Assert disk content was NOT destroyed
    const diskText = new TextDecoder().decode((await storage.read('note.md')).content);
    expect(diskText).toBe(modifiedContent);
    expect(diskText).not.toContain('AI improved version');
  });

  it('P7-2 (F-029) Regression: Model cannot redirect writes to unauthorized target files via prompt injection', async () => {
    const targetPath = 'Notes/Daily.md';
    const originalContent = `# Daily Note\n\nToday was productive.`;

    // Malicious injection attempt to overwrite confidential file
    const injectedAIResponse = `Here is the note:
\`\`\`proposal:Secrets/Passwords.md
# HACKED
All passwords wiped.
\`\`\``;

    const proposal = parseProposedEditFromResponse(injectedAIResponse, targetPath, originalContent);

    expect(proposal).not.toBeNull();
    // Path MUST be bound to targetPath, not the injected path
    expect(proposal?.path).toBe(targetPath);
  });

  it('P7-4 & P7-5: Enforces token budget and directly retrieves selected notes', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const longText = `# Giant Note\n\n` + 'Lorem ipsum dolor sit amet. '.repeat(500);
    await storage.write('Giant.md', null, longText);
    await storage.write('Selected.md', null, '# Selected Note\n\nDirect selected text.');

    // 1. Token Budget Enforcement (P7-4)
    const tokenBounded = await retrieveContext(
      storage,
      index,
      'test',
      {
        type: 'current_note',
        notePath: 'Giant.md',
      },
      { maxTokens: 100 }
    );

    expect(tokenBounded.totalTokensEstimate).toBeLessThanOrEqual(100);
    expect(tokenBounded.chunks[0].content).toContain('...[truncated to token budget]');

    // 2. Direct Selected Notes Retrieval (P7-5)
    const selectedResult = await retrieveContext(storage, index, 'completely unrelated query', {
      type: 'selected_notes',
      selectedPaths: ['Selected.md'],
    });

    expect(selectedResult.chunks).toHaveLength(1);
    expect(selectedResult.chunks[0].notePath).toBe('Selected.md');
    expect(selectedResult.chunks[0].content).toContain('Direct selected text');
  });

  it('enforces scoped retrieval boundaries and provides accurate note citations', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const notes = {
      'Finance/Budget.md': `# Budget 2026\n\nTotal allocated budget is $50,000 for Q1.`,
      'Engineering/Specs.md': `# Architecture Specs\n\nEngine utilizes WebAssembly and SQLite.`,
      'Personal/Secret.md': `# Private Thoughts\n\nPersonal diary content.`,
    };

    for (const [path, content] of Object.entries(notes)) {
      await storage.write(path, null, content);
      await index.upsert(await parser.parse(path, content));
    }

    // Retrieve scoped to 'Finance' folder only
    const financeContext = await retrieveContext(storage, index, 'budget budget', {
      type: 'folder',
      folderPrefix: 'Finance',
    });

    // Verify boundary: does NOT include Engineering or Personal notes
    expect(financeContext.chunks.every((c: any) => c.notePath.startsWith('Finance/'))).toBe(true);
    expect(financeContext.chunks.some((c: any) => c.notePath.startsWith('Personal/'))).toBe(false);

    const promptText = formatContextPrompt(financeContext);
    expect(promptText).toContain('Budget 2026');
    expect(promptText).not.toContain('Private Thoughts');

    // Extract citation from response
    const availableDocs = [
      { path: 'Finance/Budget.md', title: 'Budget 2026' },
      { path: 'Engineering/Specs.md', title: 'Architecture Specs' },
    ];
    const citations = extractCitations(
      'The allocated funds are detailed in [[Budget 2026]] (and [Source: Finance/Budget.md (Lines 1-10)]).',
      availableDocs
    );

    expect(citations).toHaveLength(1);
    expect(citations[0].notePath).toBe('Finance/Budget.md');
    expect(citations[0].noteTitle).toBe('Budget 2026');
    expect(citations[0].lineStart).toBe(1);
    expect(citations[0].lineEnd).toBe(10);
  });
});
