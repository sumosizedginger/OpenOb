import {
  FileSnapshot,
  VaultPath,
  VaultStorage,
} from '@okw/core';
import { updateDocumentFrontmatter } from '@okw/markdown';
import { SafeWriter } from './safe-writer.js';

export interface NoteState {
  path: VaultPath;
  bufferContent: string;
  bufferGeneration: number;
  committedSnapshot: FileSnapshot | null;
  saveStatus: 'saved' | 'saving' | 'modified' | 'conflict';
  conflictData: { path: VaultPath; diskContent?: string } | null;
}

interface NoteInternalState extends NoteState {
  isWriting: boolean;
  pendingForce: boolean;
  waiters: Array<{ resolve: (s: FileSnapshot | null) => void; reject: (err: any) => void }>;
}

export type NoteStateListener = (state: NoteState) => void;

/**
 * NoteWriteCoordinator manages deterministic serialized persistence and authoritative
 * version chaining per note, fully decoupled from React render and state flush timing.
 * (Solves G1, G2 / F1, F3).
 */
export class NoteWriteCoordinator {
  private storage: VaultStorage;
  private safeWriter: SafeWriter;
  private notes: Map<VaultPath, NoteInternalState> = new Map();
  private listeners: Set<NoteStateListener> = new Set();

  constructor(storage: VaultStorage, safeWriter?: SafeWriter) {
    this.storage = storage;
    this.safeWriter = safeWriter ?? new SafeWriter(storage);
  }

  setStorage(storage: VaultStorage, safeWriter?: SafeWriter): void {
    this.storage = storage;
    this.safeWriter = safeWriter ?? new SafeWriter(storage);
    this.notes.clear();
  }

  addListener(listener: NoteStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(state: NoteInternalState): void {
    const copy: NoteState = {
      path: state.path,
      bufferContent: state.bufferContent,
      bufferGeneration: state.bufferGeneration,
      committedSnapshot: state.committedSnapshot,
      saveStatus: state.saveStatus,
      conflictData: state.conflictData,
    };
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch (err) {
        console.error('[NoteWriteCoordinator] Listener error:', err);
      }
    }
  }

  getNoteState(path: VaultPath): NoteState | undefined {
    const s = this.notes.get(path);
    if (!s) return undefined;
    return {
      path: s.path,
      bufferContent: s.bufferContent,
      bufferGeneration: s.bufferGeneration,
      committedSnapshot: s.committedSnapshot,
      saveStatus: s.saveStatus,
      conflictData: s.conflictData,
    };
  }

  initNote(path: VaultPath, snapshot: FileSnapshot, content: string): NoteState {
    const diskText = snapshot.textContent ?? new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.content);
    const isDirty = diskText !== content;
    const state: NoteInternalState = {
      path,
      bufferContent: content,
      bufferGeneration: 0,
      committedSnapshot: snapshot,
      saveStatus: isDirty ? 'modified' : 'saved',
      conflictData: null,
      isWriting: false,
      pendingForce: false,
      waiters: [],
    };
    this.notes.set(path, state);
    this.notify(state);
    return state;
  }

  setBuffer(path: VaultPath, newContent: string): NoteState {
    let state = this.notes.get(path);
    if (!state) {
      state = {
        path,
        bufferContent: newContent,
        bufferGeneration: 1,
        committedSnapshot: null,
        saveStatus: 'modified',
        conflictData: null,
        isWriting: false,
        pendingForce: false,
        waiters: [],
      };
      this.notes.set(path, state);
    } else {
      state.bufferContent = newContent;
      state.bufferGeneration++;
      const committedText = state.committedSnapshot?.textContent ?? '';
      const isDirty = committedText !== newContent;
      if (state.saveStatus !== 'saving') {
        state.saveStatus = isDirty ? 'modified' : 'saved';
      }
    }
    this.notify(state);
    return state;
  }

  removeNote(path: VaultPath): void {
    this.notes.delete(path);
  }

  renameNote(oldPath: VaultPath, newPath: VaultPath): void {
    const state = this.notes.get(oldPath);
    if (state) {
      this.notes.delete(oldPath);
      state.path = newPath;
      this.notes.set(newPath, state);
    }
  }

  /**
   * Serialized save for a note with authoritative version chaining.
   * If user types during the save, the queue pump loop automatically saves
   * the latest buffer using the newly committed disk snapshot version.
   */
  save(path: VaultPath, force = false): Promise<FileSnapshot | null> {
    const state = this.notes.get(path);
    if (!state) return Promise.resolve(null);

    if (force) {
      state.pendingForce = true;
    }

    const promise = new Promise<FileSnapshot | null>((resolve, reject) => {
      state.waiters.push({ resolve, reject });
    });

    if (!state.isWriting) {
      this.pump(path);
    }

    return promise;
  }

  private async pump(path: VaultPath): Promise<void> {
    const state = this.notes.get(path);
    if (!state || state.isWriting) return;

    state.isWriting = true;

    while (true) {
      const current = this.notes.get(path);
      if (!current) break;

      const contentToSave = current.bufferContent;
      const force = current.pendingForce;
      current.pendingForce = false;
      const expectedVersion = force
        ? undefined
        : current.committedSnapshot?.version || null;

      current.saveStatus = 'saving';
      this.notify(current);

      let resSnapshot: FileSnapshot | null = null;
      let error: any = null;

      try {
        const res = await this.safeWriter.safeSave(path, contentToSave, {
          expectedVersion,
          force,
        });

        // Immediately update authoritative disk snapshot
        current.committedSnapshot = res.snapshot;
        resSnapshot = res.snapshot;

        const stillDirty = current.bufferContent !== contentToSave;
        if (!stillDirty) {
          current.saveStatus = 'saved';
          current.conflictData = null;
        } else {
          current.saveStatus = 'modified';
        }
        this.notify(current);
      } catch (err: any) {
        error = err;
        if (err.code === 'CONFLICT' || err.name === 'ConflictError') {
          current.saveStatus = 'conflict';
          try {
            const diskText = await this.storage.readText(path);
            current.conflictData = { path, diskContent: diskText };
          } catch {
            current.conflictData = { path };
          }
        } else {
          console.error(`[NoteWriteCoordinator] Save error for "${path}":`, err);
          current.saveStatus = 'modified';
        }
        this.notify(current);
      }

      // Drain all waiters that queued prior to this save completion
      const waitersToDrain = current.waiters.splice(0, current.waiters.length);
      for (const w of waitersToDrain) {
        if (error) {
          w.reject(error);
        } else {
          w.resolve(resSnapshot);
        }
      }

      if (error) {
        break;
      }

      // Check if another iteration is needed (e.g. user typed during save or more waiters arrived)
      if (
        current.bufferContent === contentToSave &&
        !current.pendingForce &&
        current.waiters.length === 0
      ) {
        break;
      }
    }

    const finalState = this.notes.get(path);
    if (finalState) {
      finalState.isWriting = false;
    }
  }

  /**
   * Serialized frontmatter property mutation with deterministic rebase/commit.
   */
  async updateProperty(
    path: VaultPath,
    key: string,
    value: any,
    parser: { parse: (p: string, c: string) => Promise<any> }
  ): Promise<void> {
    const state = this.notes.get(path);
    let content = state ? state.bufferContent : await this.storage.readText(path);

    const parsed = await parser.parse(path, content);
    const currentProps = parsed.properties || {};
    const newProps = { ...currentProps };
    if (value === null || value === undefined) {
      delete newProps[key];
    } else {
      newProps[key] = value;
    }

    if (state) {
      // Apply new properties onto current buffer
      state.bufferContent = updateDocumentFrontmatter(state.bufferContent, newProps);
      state.bufferGeneration++;
      this.notify(state);
      await this.save(path, false);

      // If user typed during save, re-ensure newProps is preserved on latest buffer
      const currentBuffer = state.bufferContent;
      const rebased = updateDocumentFrontmatter(currentBuffer, newProps);
      if (rebased !== currentBuffer) {
        state.bufferContent = rebased;
        state.bufferGeneration++;
        this.notify(state);
        await this.save(path, false);
      }
    } else {
      const snap = await this.storage.read(path);
      const updated = updateDocumentFrontmatter(content, newProps);
      await this.safeWriter.safeSave(path, updated, { expectedVersion: snap.version });
    }
  }

  /**
   * Serialized AI proposed edit application with human-precedence divergence protection.
   */
  async applyAI(
    proposal: { path: VaultPath; originalContent: string; proposedContent: string }
  ): Promise<{ success: boolean; error?: string }> {
    const path = proposal.path;
    const state = this.notes.get(path);

    if (state) {
      if (state.bufferContent.trim() !== proposal.originalContent.trim()) {
        state.conflictData = { path, diskContent: state.bufferContent };
        this.notify(state);
        return {
          success: false,
          error: 'Conflict: Note buffer was modified after AI proposal was generated.',
        };
      }

      const initialGen = state.bufferGeneration;
      state.bufferContent = proposal.proposedContent;
      state.bufferGeneration++;
      this.notify(state);

      try {
        await this.save(path, false);

        // Check if user typed while save was executing
        if (state.bufferGeneration !== initialGen + 1) {
          state.saveStatus = 'modified';
          state.conflictData = { path, diskContent: proposal.proposedContent };
          this.notify(state);
          return {
            success: false,
            error: 'Conflict: Note buffer was modified while AI proposed edit was being applied.',
          };
        }

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const snapshot = await this.storage.read(path);
      const diskText =
        snapshot.textContent ||
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.content);
      if (diskText.trim() !== proposal.originalContent.trim()) {
        return {
          success: false,
          error: 'Conflict: Note on disk was modified after AI proposal was generated.',
        };
      }
      await this.safeWriter.safeSave(path, proposal.proposedContent, {
        expectedVersion: snapshot.version,
      });
      return { success: true };
    }
  }
}
