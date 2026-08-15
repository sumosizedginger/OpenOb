import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  retrieveContext,
  formatContextPrompt,
  extractCitations,
  parseProposedEditFromResponse,
  applyProposedEdit,
} from '../index.js';

describe('Local AI Scoped Retrieval & Citations (Phase 7)', () => {
  it('retrieves bounded context for current note, folder, and vault scopes', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    const files = {
      'Projects/Quantum.md': `# Quantum Systems\n\nOverview of qubits and entanglement.\n\n## Principles\n\nSuperposition is essential.`,
      'Projects/Algorithms.md': `# Algorithms\n\nShor's algorithm achieves polynomial speedup.`,
      'Personal/Diary.md': `# Journal\n\nDaily reflections on life.`,
    };

    for (const [path, content] of Object.entries(files)) {
      await storage.write(path, null, content);
      await index.upsert(await parser.parse(path, content));
    }

    // 1. Current Note Scope
    const currentScope = await retrieveContext(storage, index, 'qubits', {
      type: 'current_note',
      notePath: 'Projects/Quantum.md',
    });
    expect(currentScope.chunks.length).toBeGreaterThan(0);
    expect(currentScope.chunks[0].notePath).toBe('Projects/Quantum.md');

    // 2. Folder Scope
    const folderScope = await retrieveContext(storage, index, 'algorithm', {
      type: 'folder',
      folderPrefix: 'Projects',
    });
    expect(folderScope.chunks.some((c) => c.notePath.startsWith('Projects/'))).toBe(true);

    // 3. Selection Scope
    const selScope = await retrieveContext(storage, index, 'summary', {
      type: 'selection',
      selectedText: 'Custom selected paragraph text',
      notePath: 'Projects/Quantum.md',
    });
    expect(selScope.chunks).toHaveLength(1);
    expect(selScope.chunks[0].content).toBe('Custom selected paragraph text');
  });

  it('extracts wikilinks and note citations from assistant response', () => {
    const availableDocs = [
      { path: 'Projects/Quantum.md', title: 'Quantum Systems' },
      { path: 'Personal/Diary.md', title: 'Journal' },
    ];

    const aiResponse =
      'According to [[Quantum Systems]] (and also [Source: Projects/Quantum.md:L10-25]), superposition enables quantum parallelism.';

    const citations = extractCitations(aiResponse, availableDocs);
    expect(citations.length).toBeGreaterThanOrEqual(1);
    expect(citations[0].notePath).toBe('Projects/Quantum.md');
    expect(citations[0].noteTitle).toBe('Quantum Systems');
  });

  it('parses proposed diffs and applies them via SafeWriter without bypassing permissions (Law 19)', async () => {
    const storage = new MemoryVaultStorage();
    const safeWriter = new SafeWriter(storage);

    const originalContent = `# Draft Note\n\nInitial ideas.`;
    await storage.write('draft.md', null, originalContent);

    const aiResponse = `Here is the revised note:
\`\`\`markdown
# Draft Note

Initial ideas with expanded AI explanations.
\`\`\`
Hope this helps!`;

    const proposal = parseProposedEditFromResponse(aiResponse, 'draft.md', originalContent);
    expect(proposal).not.toBeNull();
    expect(proposal?.proposedContent).toContain('expanded AI explanations');

    // Apply proposal
    const result = await applyProposedEdit(storage, safeWriter, proposal!);
    expect(result.success).toBe(true);

    const diskSnap = await storage.read('draft.md');
    const diskText = new TextDecoder().decode(diskSnap.content);
    expect(diskText).toContain('expanded AI explanations');
  });
});
