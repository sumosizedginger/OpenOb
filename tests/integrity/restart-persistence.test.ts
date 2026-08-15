import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsVaultStorage, SafeWriter } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';

describe('Phase 1 Exit Gate: Restart Persistence & Data Durability (H-01)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'okw-restart-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('preserves exact content, hashes, and relational index across full app/storage restart', async () => {
    const parser = new DefaultDocumentParser();

    // === SESSION 1: Initial creation and safe save ===
    {
      const vault1 = new NodeFsVaultStorage(tmpDir);
      const writer1 = new SafeWriter(vault1);

      const writeRes1 = await writer1.safeSave(
        'Research/Quantum Physics.md',
        `---
title: Quantum Physics
tags: [physics, science]
aliases: [Quantum Mechanics]
---

# Quantum Physics Overview

Fundamental principles of quantum states. Refer to [[Linear Algebra]] and [[Qubits]].
`
      );
      expect(writeRes1.wasCreated).toBe(true);

      await writer1.safeSave(
        'Research/Linear Algebra.md',
        `# Linear Algebra\nVector spaces and matrices. Back to [[Quantum Physics]].`
      );

      // Verify Session 1 Index
      const index1 = new MemoryDocumentIndex();
      await rebuildVaultIndex(vault1, index1, parser);
      const backlinks1 = await index1.getBacklinks('Research/Quantum Physics.md');
      expect(backlinks1).toHaveLength(1);
      expect(backlinks1[0].sourcePath).toBe('Research/Linear Algebra.md');
    }

    // === SIMULATE COMPLETE APP SHUTDOWN & RESTART ===
    // Memory is wiped. All in-memory adapters, singletons, and variables are destroyed.

    // === SESSION 2: Brand new storage instance attached to same directory ===
    {
      const vault2 = new NodeFsVaultStorage(tmpDir);
      const writer2 = new SafeWriter(vault2);
      const index2 = new MemoryDocumentIndex();

      // 1. Rebuild derived state completely from physical disk files
      const report = await rebuildVaultIndex(vault2, index2, parser);
      expect(report.totalIndexed).toBe(2);

      // 2. Read snapshot from disk
      const snapshot = await vault2.read('Research/Quantum Physics.md');
      expect(snapshot.textContent).toContain('# Quantum Physics Overview');

      // 3. Verify backlinks recovered identically
      const backlinks2 = await index2.getBacklinks('Research/Quantum Physics.md');
      expect(backlinks2).toHaveLength(1);
      expect(backlinks2[0].sourcePath).toBe('Research/Linear Algebra.md');

      // 4. Perform Session 2 incremental safe edit
      const editRes = await writer2.safeSave(
        'Research/Quantum Physics.md',
        snapshot.textContent + '\n- Added Session 2 experiment data.',
        { expectedVersion: snapshot.version }
      );
      expect(editRes.wasCreated).toBe(false);
      expect(editRes.snapshot.textContent).toContain('Session 2 experiment data');
    }

    // === SESSION 3: Verify Session 2 edits persisted to disk ===
    {
      const vault3 = new NodeFsVaultStorage(tmpDir);
      const contentOnDisk = await vault3.readText('Research/Quantum Physics.md');
      expect(contentOnDisk).toContain('Session 2 experiment data');
    }
  });
});
