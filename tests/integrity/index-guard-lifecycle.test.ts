import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex, renameDocument } from '@okw/index';
import { MemoryVaultStorage } from '@okw/vault';

describe('Index Guard Concurrency, Path Lifecycle & Rebuild Epochs (H15, H16, R4, R5, R6)', () => {
  it('1. H15: strictly monotonic save sequence drops older delayed parse even with equal modifiedAt timestamps', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'Note.md';
    let saveSequence = 0;
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    const rebuildEpoch = 0;

    // Initialize lifecycle
    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);

    // Commit v1 on disk
    const snap1 = (await storage.write(path, null, '# v1 old')).snapshot;
    const seq1 = ++saveSequence;
    const startEpoch1 = pathEpochMap.get(path) ?? 0;
    const startRebuild1 = rebuildEpoch;

    // Commit v2 on disk (simulate equal timestamp / modifiedAt)
    const snap2 = (await storage.write(path, snap1.version, '# v2 new')).snapshot;
    const seq2 = ++saveSequence;
    const startEpoch2 = pathEpochMap.get(path) ?? 0;
    const startRebuild2 = rebuildEpoch;

    // Start parse for v1 (delayed)
    const parseV1Promise = new Promise<{
      seq: number;
      startEpoch: number;
      startRebuild: number;
      parsed: any;
    }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, snap1.textContent!, snap1.version.hash);
        resolve({ seq: seq1, startEpoch: startEpoch1, startRebuild: startRebuild1, parsed: p });
      }, 100);
    });

    // Start parse for v2 (immediate)
    const parseV2 = await parser.parse(path, snap2.textContent!, snap2.version.hash);
    const lastIndexed2 = pathSeqMap.get(path) || 0;
    if (
      startRebuild2 === rebuildEpoch &&
      startEpoch2 === (pathEpochMap.get(path) ?? 0) &&
      seq2 > lastIndexed2
    ) {
      pathSeqMap.set(path, seq2);
      await index.upsert(parseV2);
    }

    // Now delayed v1 parse completes
    const delayed = await parseV1Promise;
    const lastIndexedDelayed = pathSeqMap.get(path) || 0;
    if (
      delayed.startRebuild === rebuildEpoch &&
      delayed.startEpoch === (pathEpochMap.get(path) ?? 0) &&
      delayed.seq > lastIndexedDelayed
    ) {
      pathSeqMap.set(path, delayed.seq);
      await index.upsert(delayed.parsed);
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
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    const rebuildEpoch = 0;

    // Initial note on disk and indexed
    pathEpochMap.set(oldPath, 1);
    pathSeqMap.set(oldPath, 0);
    const snap1 = (await storage.write(oldPath, null, '# Old Note\n\n[[Target]]')).snapshot;
    const initialParsed = await parser.parse(oldPath, snap1.textContent!, snap1.version.hash);
    pathSeqMap.set(oldPath, ++saveSequence);
    await index.upsert(initialParsed);

    // Trigger edit on oldPath with delayed parse
    const editSnap = (await storage.write(oldPath, snap1.version, '# Old Note v2\n\n[[Target]]'))
      .snapshot;
    const editSeq = ++saveSequence;
    const startEpoch = pathEpochMap.get(oldPath) ?? 0;
    const startRebuild = rebuildEpoch;

    const delayedOldParse = new Promise<{
      seq: number;
      startEpoch: number;
      startRebuild: number;
      parsed: any;
    }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(oldPath, editSnap.textContent!, editSnap.version.hash);
        resolve({ seq: editSeq, startEpoch, startRebuild, parsed: p });
      }, 100);
    });

    // Concurrently rename document from OldNote.md to NewNote.md
    await renameDocument(storage, index, parser, oldPath, newPath);
    // Invalidate oldPath lifecycle; initialize newPath lifecycle
    pathEpochMap.set(oldPath, (pathEpochMap.get(oldPath) ?? 0) + 1);
    pathSeqMap.delete(oldPath);
    pathEpochMap.set(newPath, (pathEpochMap.get(newPath) ?? 0) + 1);
    pathSeqMap.set(newPath, ++saveSequence);

    // Delayed old-path parse finishes
    const delayed = await delayedOldParse;
    const lastIndexed = pathSeqMap.get(oldPath) || 0;
    if (
      delayed.startRebuild === rebuildEpoch &&
      delayed.startEpoch === (pathEpochMap.get(oldPath) ?? 0) &&
      delayed.seq > lastIndexed
    ) {
      pathSeqMap.set(oldPath, delayed.seq);
      await index.upsert(delayed.parsed);
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
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    const rebuildEpoch = 0;

    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);

    const snap1 = (await storage.write(path, null, '# Gone Note')).snapshot;
    const initialParsed = await parser.parse(path, snap1.textContent!, snap1.version.hash);
    pathSeqMap.set(path, ++saveSequence);
    await index.upsert(initialParsed);

    // Edit with delayed parse
    const editSnap = (await storage.write(path, snap1.version, '# Gone Note v2')).snapshot;
    const editSeq = ++saveSequence;
    const startEpoch = pathEpochMap.get(path) ?? 0;
    const startRebuild = rebuildEpoch;

    const delayedParse = new Promise<{
      seq: number;
      startEpoch: number;
      startRebuild: number;
      parsed: any;
    }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, editSnap.textContent!, editSnap.version.hash);
        resolve({ seq: editSeq, startEpoch, startRebuild, parsed: p });
      }, 100);
    });

    // Delete path
    pathEpochMap.set(path, (pathEpochMap.get(path) ?? 0) + 1);
    pathSeqMap.delete(path);
    await storage.remove(path);
    await index.remove(path);

    // Delayed parse completes
    const delayed = await delayedParse;
    const lastIndexed = pathSeqMap.get(path) || 0;
    if (
      delayed.startRebuild === rebuildEpoch &&
      delayed.startEpoch === (pathEpochMap.get(path) ?? 0) &&
      delayed.seq > lastIndexed
    ) {
      pathSeqMap.set(path, delayed.seq);
      await index.upsert(delayed.parsed);
    }

    // GoneNote.md must NOT exist in index
    const doc = await index.get(path);
    expect(doc).toBeNull();
    const searchResults = await index.query({ query: 'Gone' });
    expect(searchResults).toHaveLength(0);
  });

  it('4. R4 Case A: legitimate path reuse after delete indexes subsequent edits correctly', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'Foo.md';
    let saveSequence = 0;
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    const rebuildEpoch = 0;

    // 1. Initial Foo.md creation and indexing
    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);
    const snap1 = (await storage.write(path, null, '# Foo Original')).snapshot;
    const p1 = await parser.parse(path, snap1.textContent!, snap1.version.hash);
    pathSeqMap.set(path, ++saveSequence);
    await index.upsert(p1);

    // 2. Delete Foo.md (tombstone / end lifecycle)
    pathEpochMap.set(path, (pathEpochMap.get(path) ?? 0) + 1);
    pathSeqMap.delete(path);
    await storage.remove(path);
    await index.remove(path);

    // 3. Create NEW Foo.md (recreate legitimate lifecycle)
    pathEpochMap.set(path, (pathEpochMap.get(path) ?? 0) + 1);
    pathSeqMap.set(path, 0);
    const snapNew = (await storage.write(path, null, '# Foo NEW\n\nnew body')).snapshot;
    const pNew = await parser.parse(path, snapNew.textContent!, snapNew.version.hash);
    await index.upsert(pNew);

    // 4. Edit and save the recreated Foo.md
    const startEpoch = pathEpochMap.get(path) ?? 0;
    const startRebuild = rebuildEpoch;
    const editSeq = ++saveSequence;
    const snapEdit = (await storage.write(path, snapNew.version, '# Foo NEW\n\nnew body edited'))
      .snapshot;
    const pEdit = await parser.parse(path, snapEdit.textContent!, snapEdit.version.hash);

    const currentPathEpoch = pathEpochMap.get(path) ?? 0;
    const lastIndexed = pathSeqMap.get(path) ?? 0;

    if (startRebuild === rebuildEpoch && startEpoch === currentPathEpoch && editSeq > lastIndexed) {
      pathSeqMap.set(path, editSeq);
      await index.upsert(pEdit);
    }

    // Index MUST contain the edited content of the new lifecycle!
    const doc = await index.get(path);
    expect(doc).toBeDefined();
    expect(doc?.textContent).toContain('new body edited');
  });

  it('5. R4 Case B: legitimate path reuse after rename indexes subsequent edits correctly', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'Bar.md';
    const renamedPath = 'BarRenamed.md';
    let saveSequence = 0;
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    const rebuildEpoch = 0;

    // 1. Initial Bar.md creation and indexing
    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);
    const snap1 = (await storage.write(path, null, '# Bar Original')).snapshot;
    const p1 = await parser.parse(path, snap1.textContent!, snap1.version.hash);
    pathSeqMap.set(path, ++saveSequence);
    await index.upsert(p1);

    // 2. Rename Bar.md to BarRenamed.md
    await renameDocument(storage, index, parser, path, renamedPath);
    pathEpochMap.set(path, (pathEpochMap.get(path) ?? 0) + 1);
    pathSeqMap.delete(path);
    pathEpochMap.set(renamedPath, (pathEpochMap.get(renamedPath) ?? 0) + 1);
    pathSeqMap.set(renamedPath, ++saveSequence);

    // 3. Create BRAND NEW Bar.md
    pathEpochMap.set(path, (pathEpochMap.get(path) ?? 0) + 1);
    pathSeqMap.set(path, 0);
    const snapNew = (await storage.write(path, null, '# Bar BRAND NEW\n\nbrand new content'))
      .snapshot;
    const pNew = await parser.parse(path, snapNew.textContent!, snapNew.version.hash);
    await index.upsert(pNew);

    // 4. Edit and save the new Bar.md
    const startEpoch = pathEpochMap.get(path) ?? 0;
    const startRebuild = rebuildEpoch;
    const editSeq = ++saveSequence;
    const snapEdit = (
      await storage.write(path, snapNew.version, '# Bar BRAND NEW\n\nbrand new content edited')
    ).snapshot;
    const pEdit = await parser.parse(path, snapEdit.textContent!, snapEdit.version.hash);

    const currentPathEpoch = pathEpochMap.get(path) ?? 0;
    const lastIndexed = pathSeqMap.get(path) ?? 0;

    if (startRebuild === rebuildEpoch && startEpoch === currentPathEpoch && editSeq > lastIndexed) {
      pathSeqMap.set(path, editSeq);
      await index.upsert(pEdit);
    }

    // Index MUST contain the edited content
    const doc = await index.get(path);
    expect(doc).toBeDefined();
    expect(doc?.textContent).toContain('brand new content edited');
  });

  it('6. R5: full index rebuild (refreshVault) drops older pre-rebuild delayed upsert', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'RebuildTest.md';
    let saveSequence = 0;
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    let rebuildEpoch = 0;

    // 1. Initial note v1 on disk
    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);
    const snap1 = (await storage.write(path, null, '# Note v1\n\nold body')).snapshot;

    // 2. Start v1 save / parse with delay (capturing rebuildEpoch = 0)
    const startEpoch1 = pathEpochMap.get(path) ?? 0;
    const startRebuild1 = rebuildEpoch;
    const seq1 = ++saveSequence;

    const delayedV1Parse = new Promise<{
      seq: number;
      startEpoch: number;
      startRebuild: number;
      parsed: any;
    }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, snap1.textContent!, snap1.version.hash);
        resolve({ seq: seq1, startEpoch: startEpoch1, startRebuild: startRebuild1, parsed: p });
      }, 100);
    });

    // 3. Disk advances to v2 externally
    await storage.write(path, snap1.version, '# Note v2\n\nnew body');

    // 4. refreshVault runs: rebuildVaultIndex completely rebuilds index and bumps rebuildEpoch
    await rebuildVaultIndex(storage, index, parser);
    rebuildEpoch++;

    const docAfterRebuild = await index.get(path);
    expect(docAfterRebuild?.textContent).toContain('new body');

    // 5. Delayed v1 upsert releases
    const delayed = await delayedV1Parse;
    const lastIndexed = pathSeqMap.get(path) ?? 0;

    let v1Landed = false;
    if (
      delayed.startRebuild === rebuildEpoch &&
      delayed.startEpoch === (pathEpochMap.get(path) ?? 0) &&
      delayed.seq > lastIndexed
    ) {
      pathSeqMap.set(path, delayed.seq);
      await index.upsert(delayed.parsed);
      v1Landed = true;
    }

    // Delayed v1 upsert MUST be dropped because rebuildEpoch changed!
    expect(v1Landed).toBe(false);

    // Final index MUST retain canonical v2 content
    const finalDoc = await index.get(path);
    expect(finalDoc?.textContent).toContain('new body');
    expect(finalDoc?.textContent).not.toContain('old body');
  });

  it('7. R5 variant: folder creation + refreshVault drops older pre-rebuild delayed upsert', async () => {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const path = 'FolderNote.md';
    let saveSequence = 0;
    const pathEpochMap = new Map<string, number>();
    const pathSeqMap = new Map<string, number>();
    let rebuildEpoch = 0;

    pathEpochMap.set(path, 1);
    pathSeqMap.set(path, 0);
    const snap1 = (await storage.write(path, null, '# Folder Note v1')).snapshot;

    const startEpoch1 = pathEpochMap.get(path) ?? 0;
    const startRebuild1 = rebuildEpoch;
    const seq1 = ++saveSequence;

    const delayedV1Parse = new Promise<{
      seq: number;
      startEpoch: number;
      startRebuild: number;
      parsed: any;
    }>((resolve) => {
      setTimeout(async () => {
        const p = await parser.parse(path, snap1.textContent!, snap1.version.hash);
        resolve({ seq: seq1, startEpoch: startEpoch1, startRebuild: startRebuild1, parsed: p });
      }, 100);
    });

    // Create folder and trigger refreshVault
    await storage.createFolder('MyFolder');
    await rebuildVaultIndex(storage, index, parser);
    rebuildEpoch++;

    // Delayed v1 parse lands
    const delayed = await delayedV1Parse;
    const lastIndexed = pathSeqMap.get(path) ?? 0;
    let v1Landed = false;
    if (
      delayed.startRebuild === rebuildEpoch &&
      delayed.startEpoch === (pathEpochMap.get(path) ?? 0) &&
      delayed.seq > lastIndexed
    ) {
      pathSeqMap.set(path, delayed.seq);
      await index.upsert(delayed.parsed);
      v1Landed = true;
    }

    expect(v1Landed).toBe(false);
  });

  it('8. R6: __setStorageWriteDelay single-level indirection does not accumulate latency across resets', async () => {
    const storage = new MemoryVaultStorage('test-vault');

    // Simulate R6 single-level delay wrapper
    let delayMs = 0;
    const uninstrumentedWrite = storage.write.bind(storage);

    storage.write = async (...args: any[]) => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return (uninstrumentedWrite as any)(...args);
    };

    const setDelay = (d: number) => {
      delayMs = d;
    };

    // 1. set(100) -> ~100ms
    setDelay(100);
    const t0 = Date.now();
    await storage.write('T1.md', null, '1');
    const d1 = Date.now() - t0;
    expect(d1).toBeGreaterThanOrEqual(90);

    // 2. set(0) -> <50ms
    setDelay(0);
    const t1 = Date.now();
    await storage.write('T2.md', null, '2');
    const d2 = Date.now() - t1;
    expect(d2).toBeLessThan(50);

    // 3. Repeated set(100), set(200), set(0) -> <50ms (no nesting/accumulation)
    setDelay(100);
    setDelay(200);
    setDelay(0);
    const t2 = Date.now();
    await storage.write('T3.md', null, '3');
    const d3 = Date.now() - t2;
    expect(d3).toBeLessThan(50);
  });
});
