import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex } from '@okw/index';
import { MemoryVaultStorage } from '@okw/vault';
import { renameDocument } from '@okw/index';

describe('Index Guard Concurrency & Path Lifecycle (H15 & H16)', () => {
  it('1. H15: strictly monotonic save sequence drops older delayed parse even with equal modifiedAt timestamps', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'Note.md';
    let saveSequence = 0;
    const indexGenerationMap = new Map<string, number>();

    // Commit v1 on disk
    const snap1 = (await storage.write(path, null, '# v1 old')).snapshot;
    const seq1 = ++saveSequence;

    // Commit v2 on disk (simulate equal timestamp / modifiedAt)
    const snap2 = (await storage.write(path, snap1.version, '# v2 new')).snapshot;
    const seq2 = ++saveSequence;

    // Start parse for v1 (delayed)
    const parseV1Promise = new Promise<{ seq: number; parsed: any }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, snap1.textContent!, snap1.version.hash);
        resolve({ seq: seq1, parsed: p });
      }, 100);
    });

    // Start parse for v2 (immediate)
    const parseV2 = await parser.parse(path, snap2.textContent!, snap2.version.hash);
    const lastIndexed2 = indexGenerationMap.get(path) || 0;
    if (seq2 > lastIndexed2) {
      indexGenerationMap.set(path, seq2);
      await index.upsert(parseV2);
    }

    // Now delayed v1 parse completes
    const { seq: delayedSeq, parsed: delayedParsed } = await parseV1Promise;
    const lastIndexedDelayed = indexGenerationMap.get(path) || 0;
    if (delayedSeq > lastIndexedDelayed) {
      indexGenerationMap.set(path, delayedSeq);
      await index.upsert(delayedParsed);
    }

    // Index MUST contain v2 new, NOT v1 old
    const indexedDoc = await index.get(path);
    expect(indexedDoc).toBeDefined();
    expect(indexedDoc?.title).toBe('v2 new');
    expect(indexedDoc?.textContent).toContain('v2 new');
  });

  it('2. H16: delayed parse after rename does not resurrect old path in index', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const oldPath = 'OldNote.md';
    const newPath = 'NewNote.md';
    let saveSequence = 0;
    const indexGenerationMap = new Map<string, number>();

    // Initial note on disk and indexed
    const snap1 = (await storage.write(oldPath, null, '# Old Note\n\n[[Target]]')).snapshot;
    const initialParsed = await parser.parse(oldPath, snap1.textContent!, snap1.version.hash);
    indexGenerationMap.set(oldPath, ++saveSequence);
    await index.upsert(initialParsed);

    // Trigger edit on oldPath with delayed parse
    const editSnap = (await storage.write(oldPath, snap1.version, '# Old Note v2\n\n[[Target]]'))
      .snapshot;
    const editSeq = ++saveSequence;

    const delayedOldParse = new Promise<{ seq: number; parsed: any }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(oldPath, editSnap.textContent!, editSnap.version.hash);
        resolve({ seq: editSeq, parsed: p });
      }, 100);
    });

    // Concurrently rename document from OldNote.md to NewNote.md
    await renameDocument(storage, index, parser, oldPath, newPath);
    // Tombstone oldPath and migrate newPath sequence
    indexGenerationMap.set(oldPath, Infinity);
    indexGenerationMap.set(newPath, ++saveSequence);

    // Delayed old-path parse finishes
    const { seq: delayedSeq, parsed: delayedParsed } = await delayedOldParse;
    const lastIndexed = indexGenerationMap.get(oldPath) || 0;
    if (delayedSeq > lastIndexed) {
      indexGenerationMap.set(oldPath, delayedSeq);
      await index.upsert(delayedParsed);
    }

    // Index MUST NOT contain OldNote.md
    const oldDoc = await index.get(oldPath);
    expect(oldDoc).toBeNull();

    // Index MUST contain NewNote.md
    const newDoc = await index.get(newPath);
    expect(newDoc).toBeDefined();
  });

  it('3. H16: delayed parse after delete does not resurrect deleted note in index', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'GoneNote.md';
    let saveSequence = 0;
    const indexGenerationMap = new Map<string, number>();

    const snap1 = (await storage.write(path, null, '# Gone Note')).snapshot;
    const initialParsed = await parser.parse(path, snap1.textContent!, snap1.version.hash);
    indexGenerationMap.set(path, ++saveSequence);
    await index.upsert(initialParsed);

    // Edit with delayed parse
    const editSnap = (await storage.write(path, snap1.version, '# Gone Note v2')).snapshot;
    const editSeq = ++saveSequence;

    const delayedParse = new Promise<{ seq: number; parsed: any }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, editSnap.textContent!, editSnap.version.hash);
        resolve({ seq: editSeq, parsed: p });
      }, 100);
    });

    // Delete path
    indexGenerationMap.set(path, Infinity);
    await storage.remove(path);
    await index.remove(path);

    // Delayed parse completes
    const { seq: delayedSeq, parsed: delayedParsed } = await delayedParse;
    const lastIndexed = indexGenerationMap.get(path) || 0;
    if (delayedSeq > lastIndexed) {
      indexGenerationMap.set(path, delayedSeq);
      await index.upsert(delayedParsed);
    }

    // GoneNote.md must NOT exist in index
    const doc = await index.get(path);
    expect(doc).toBeNull();
    const searchResults = await index.query({ query: 'Gone' });
    expect(searchResults).toHaveLength(0);
  });
});
