import { describe, expect, it } from 'vitest';
import {
  FileSnapshot,
  FileStat,
  FileVersion,
  VaultEntry,
  VaultPath,
  VaultStorage,
  WriteResult,
} from '@okw/core';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser, updateDocumentFrontmatter } from '@okw/markdown';
import { MemoryDocumentIndex } from '@okw/index';

/**
 * SlowVaultStorage wraps MemoryVaultStorage to simulate real-world slow I/O
 * (e.g. 100ms write latency) to deterministically exercise async overlapping operations.
 */
class SlowVaultStorage implements VaultStorage {
  readonly name: string;
  readonly inner: MemoryVaultStorage;
  writeDelayMs: number;

  constructor(name: string = 'SlowVault', writeDelayMs: number = 100) {
    this.name = name;
    this.inner = new MemoryVaultStorage(name);
    this.writeDelayMs = writeDelayMs;
  }

  async read(path: VaultPath): Promise<FileSnapshot> {
    return this.inner.read(path);
  }

  async readText(path: VaultPath): Promise<string> {
    return this.inner.readText(path);
  }

  async write(
    path: VaultPath,
    expectedVersion: FileVersion | null | undefined,
    content: Uint8Array | string
  ): Promise<WriteResult> {
    if (this.writeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    }
    return this.inner.write(path, expectedVersion, content);
  }

  async remove(path: VaultPath): Promise<void> {
    return this.inner.remove(path);
  }

  async list(prefix?: string, recursive?: boolean): Promise<VaultEntry[]> {
    return this.inner.list(prefix, recursive);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  async stat(path: VaultPath): Promise<FileStat | null> {
    return this.inner.stat(path);
  }

  async createFolder(path: VaultPath): Promise<void> {
    return this.inner.createFolder(path);
  }

  async move(from: VaultPath, to: VaultPath, overwrite?: boolean): Promise<void> {
    return this.inner.move(from, to, overwrite);
  }
}

describe('Browser Concurrency Probes (F1, F2, F3 / Probes A, B, D, E)', () => {
  it('Probe A: Typing during slow save does not drop edit; re-arms save and reaches disk', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    // Initial note creation
    const initialSnap = await safeWriter.safeSave('NoteA.md', '# Note A - Version 1');

    // Simulate tab state
    let tab = {
      path: 'NoteA.md',
      content: '# Note A - Version 1',
      isDirty: false,
      initialSnapshot: initialSnap.snapshot,
    };
    let isSaving = false;
    let pendingSave = false;
    let saveStatus: 'saved' | 'saving' | 'modified' | 'conflict' = 'saved';

    // Hook save logic with F1 fix
    const runSave = async () => {
      if (isSaving) {
        pendingSave = true;
        return;
      }
      isSaving = true;
      saveStatus = 'saving';
      const contentToSave = tab.content;
      try {
        const res = await safeWriter.safeSave('NoteA.md', contentToSave, {
          expectedVersion: tab.initialSnapshot.version,
        });

        const isStillMatching = tab.content === contentToSave;
        tab.isDirty = !isStillMatching;
        tab.initialSnapshot = res.snapshot;

        const parsed = await parser.parse('NoteA.md', contentToSave, res.snapshot.version.hash);
        await index.upsert(parsed);

        if (!tab.isDirty) {
          saveStatus = 'saved';
        } else {
          saveStatus = 'modified';
        }
      } finally {
        isSaving = false;
        if (pendingSave) {
          pendingSave = false;
          await runSave();
        }
      }
    };

    // 1. Start slow save of Version 1
    const savePromise = runSave();

    // 2. User types Version 2 at t=20ms while save is in-flight
    await new Promise((r) => setTimeout(r, 20));
    tab.content = '# Note A - Version 2 (Typed during save)';
    tab.isDirty = true;
    saveStatus = 'modified';

    // 3. User attempts autosave/manual save while in-flight
    await runSave();

    // 4. Wait for all in-flight and pending saves to complete
    await savePromise;
    await new Promise((r) => setTimeout(r, 150));

    // Assert Probe A invariants:
    // - Editor buffer equals disk content
    // - isDirty is false once matching
    // - saveStatus is truthfully 'saved'
    const diskText = await storage.readText('NoteA.md');
    expect(diskText).toBe('# Note A - Version 2 (Typed during save)');
    expect(tab.content).toBe(diskText);
    expect(tab.isDirty).toBe(false);
    expect(saveStatus).toBe('saved');
  });

  it('Probe B: Tab switch during slow save does not clobber switched tab preview, backlinks, or status', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();

    // Seed Note A and Note B
    const snapA = await safeWriter.safeSave('Welcome.md', '# Welcome Note');
    const snapB = await safeWriter.safeSave('Characters/Kaelen.md', '# Kaelen Note');

    let activeTabPath: VaultPath = 'Welcome.md';
    let tabA = { path: 'Welcome.md', content: '# Welcome Note - Edited', isDirty: true, initialSnapshot: snapA.snapshot };
    let tabB = { path: 'Characters/Kaelen.md', content: '# Kaelen Note - Typed in B', isDirty: true, initialSnapshot: snapB.snapshot };

    let parsedDoc: any = null;
    let backlinks: any[] = [];
    let saveStatus: string = 'modified';
    let isSaving = false;

    const saveNoteA = async () => {
      isSaving = true;
      const savingPath = 'Welcome.md';
      const contentToSave = tabA.content;

      try {
        const res = await safeWriter.safeSave(savingPath, contentToSave, {
          expectedVersion: tabA.initialSnapshot.version,
        });
        tabA.initialSnapshot = res.snapshot;
        tabA.isDirty = tabA.content !== contentToSave;

        const parsed = await parser.parse(savingPath, contentToSave, res.snapshot.version.hash);
        await index.upsert(parsed);

        // F2 Guard: only update active UI state if activeTabPath still matches savingPath
        if (activeTabPath === savingPath) {
          parsedDoc = parsed;
          backlinks = await index.getBacklinks(savingPath);
          saveStatus = tabA.isDirty ? 'modified' : 'saved';
        }
      } finally {
        isSaving = false;
      }
    };

    // 1. Start slow save for Welcome.md
    const savePromiseA = saveNoteA();

    // 2. User switches to Characters/Kaelen.md at t=20ms
    await new Promise((r) => setTimeout(r, 20));
    activeTabPath = 'Characters/Kaelen.md';
    const parsedB = await parser.parse('Characters/Kaelen.md', tabB.content);
    parsedDoc = parsedB;
    backlinks = await index.getBacklinks('Characters/Kaelen.md');
    saveStatus = 'modified';

    // 3. Await Note A save completion
    await savePromiseA;

    // Assert Probe B invariants:
    // - Active parsedDoc is still Kaelen.md (not clobbered by Welcome.md)
    // - Backlinks for Kaelen.md intact
    // - saveStatus is still 'modified' for dirty tab B
    expect(parsedDoc.path).toBe('Characters/Kaelen.md');
    expect(activeTabPath).toBe('Characters/Kaelen.md');
    expect(tabB.isDirty).toBe(true);
    expect(saveStatus).toBe('modified');
  });

  it('Probe D: Typing during property mutation preserves human text and surfaces conflict', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const snap = await safeWriter.safeSave('NoteProps.md', '---\nstatus: draft\n---\n# Note Props\nInitial text.');

    let tab = {
      path: 'NoteProps.md',
      content: '---\nstatus: draft\n---\n# Note Props\nInitial text.',
      isDirty: false,
      initialSnapshot: snap.snapshot,
    };
    let conflictData: any = null;

    const mutateProperty = async (key: string, value: string) => {
      const preEditContent = tab.content;
      const parsed = { properties: { status: 'draft' } };
      const updated = updateDocumentFrontmatter(preEditContent, { ...parsed.properties, [key]: value });

      const saveRes = await safeWriter.safeSave('NoteProps.md', updated, {
        expectedVersion: tab.initialSnapshot.version,
      });

      // Post-await commit check (F3)
      if (tab.content !== preEditContent) {
        // User typed while save was in-flight! Preserve human text, mark dirty, surface conflict
        tab.isDirty = true;
        tab.initialSnapshot = saveRes.snapshot;
        conflictData = { path: 'NoteProps.md', diskContent: updated };
        return;
      }

      tab.content = updated;
      tab.isDirty = false;
      tab.initialSnapshot = saveRes.snapshot;
    };

    // 1. Start slow property mutation
    const propPromise = mutateProperty('status', 'published');

    // 2. Human types into buffer at t=20ms
    await new Promise((r) => setTimeout(r, 20));
    tab.content = '---\nstatus: draft\n---\n# Note Props\nInitial text.\nHuman typed this important paragraph!';
    tab.isDirty = true;

    // 3. Await property update completion
    await propPromise;

    // Assert Probe D invariants:
    // - Human typed text is NOT lost from buffer
    // - Tab remains dirty
    // - Conflict is surfaced with disk content
    expect(tab.content).toContain('Human typed this important paragraph!');
    expect(tab.isDirty).toBe(true);
    expect(conflictData).not.toBeNull();
    expect(conflictData.path).toBe('NoteProps.md');
    expect(conflictData.diskContent).toContain('status: published');
  });

  it('Probe E: Typing during AI proposed edit application preserves human work and surfaces conflict', async () => {
    const storage = new SlowVaultStorage('test-vault', 100);
    const safeWriter = new SafeWriter(storage);
    const snap = await safeWriter.safeSave('AIProposal.md', '# Original AI Proposal Doc');

    let tab = {
      path: 'AIProposal.md',
      content: '# Original AI Proposal Doc',
      isDirty: false,
      initialSnapshot: snap.snapshot,
    };
    let conflictData: any = null;

    const applyAIEdit = async (proposal: { originalContent: string; proposedContent: string }) => {
      const preEditContent = tab.content;
      if (preEditContent.trim() !== proposal.originalContent.trim()) {
        conflictData = { path: 'AIProposal.md', diskContent: preEditContent };
        return { success: false, error: 'Pre-check divergence' };
      }

      const saveRes = await safeWriter.safeSave('AIProposal.md', proposal.proposedContent, {
        expectedVersion: tab.initialSnapshot.version,
      });

      // Post-await commit check (F3)
      if (tab.content !== preEditContent) {
        // User typed while save was in-flight! Preserve human text
        tab.isDirty = true;
        tab.initialSnapshot = saveRes.snapshot;
        conflictData = { path: 'AIProposal.md', diskContent: proposal.proposedContent };
        return { success: false, error: 'Post-await divergence' };
      }

      tab.content = proposal.proposedContent;
      tab.isDirty = false;
      tab.initialSnapshot = saveRes.snapshot;
      return { success: true };
    };

    // 1. Start slow AI edit apply
    const aiPromise = applyAIEdit({
      originalContent: '# Original AI Proposal Doc',
      proposedContent: '# AI Enhanced Doc Title\n\nAI generated analysis.',
    });

    // 2. Human types during AI save at t=20ms
    await new Promise((r) => setTimeout(r, 20));
    tab.content = '# Original AI Proposal Doc\n\nHuman edits that should never be silently discarded.';
    tab.isDirty = true;

    // 3. Await AI apply completion
    const result = await aiPromise;

    // Assert Probe E invariants:
    // - AI apply reports conflict / false
    // - Human text survived intact in buffer
    // - Tab remains dirty
    // - Conflict is surfaced with AI proposed text on disk
    expect(result.success).toBe(false);
    expect(tab.content).toContain('Human edits that should never be silently discarded.');
    expect(tab.isDirty).toBe(true);
    expect(conflictData).not.toBeNull();
    expect(conflictData.path).toBe('AIProposal.md');
    expect(conflictData.diskContent).toContain('AI Enhanced Doc Title');
  });
});
