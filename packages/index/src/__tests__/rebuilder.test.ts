import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '../memory-index.js';
import { rebuildVaultIndex } from '../rebuilder.js';

describe('Index Rebuilder (Constitution Law 2 & D-002: Disposable Index)', () => {
  it('rebuilds complete relational index and backlinks from raw files', async () => {
    const storage = new MemoryVaultStorage();
    await storage.seed({
      'index.md': '# Welcome\nSee [[Guide]] and [[Research/AI]].',
      'Guide.md': '# User Guide\nThis links back to [[index]].',
      'Research/AI.md': '# AI Notes\nRefer to [[index]] and [[Guide]].',
    });

    const index = new MemoryDocumentIndex();

    // 1. Initial build
    const buildResult = await rebuildVaultIndex(storage, index);
    expect(buildResult.totalIndexed).toBe(3);

    const initialDocs = await index.getAll();
    expect(initialDocs).toHaveLength(3);

    const backlinksToIndex = await index.getBacklinks('index.md');
    expect(backlinksToIndex).toHaveLength(2); // From Guide.md and Research/AI.md
    expect(backlinksToIndex.map((b) => b.sourcePath).sort()).toEqual(['Guide.md', 'Research/AI.md']);

    // 2. DISPOSABLE REBUILD TEST: Destroy the index completely
    await index.rebuild([]);
    expect(await index.getAll()).toHaveLength(0);
    expect(await index.getBacklinks('index.md')).toHaveLength(0);

    // 3. Rebuild from raw storage again
    await rebuildVaultIndex(storage, index);

    // 4. Verify 100% equivalent state is restored
    const rebuiltDocs = await index.getAll();
    expect(rebuiltDocs).toHaveLength(3);

    const rebuiltBacklinks = await index.getBacklinks('index.md');
    expect(rebuiltBacklinks).toHaveLength(2);
    expect(rebuiltBacklinks.map((b) => b.sourcePath).sort()).toEqual(['Guide.md', 'Research/AI.md']);
  });
});
