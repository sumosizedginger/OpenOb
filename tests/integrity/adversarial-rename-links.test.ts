import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, SqliteDocumentIndex, renameDocument } from '@okw/index';

describe('Phase 4 Exit Gate: Adversarial Rename & Link Refactoring (F-010 / F-011)', () => {
  it('safely renames note and refactors all incoming wikilinks with subpaths and aliases in MemoryIndex', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // 1. Setup initial documents
    const docAContent = `# Alpha\r\n\r\nThis note is Alpha. See [[Alpha#Roadmap|Alpha Plan]] for details.\r\n\r\n## Roadmap\r\nPlans here.`;
    const docBContent = `# Beta\r\n\r\nReferences [[Alpha]] and [[Alpha#Roadmap|My Custom Roadmap]] and ![[Alpha]].`;
    const docCContent = `# Sub Folder Note\r\n\r\nRelative link to [[Alpha]] in root.`;

    await storage.write('Alpha.md', undefined, docAContent);
    await storage.write('Beta.md', undefined, docBContent);
    await storage.write('sub/Gamma.md', undefined, docCContent);

    await index.upsert(await parser.parse('Alpha.md', docAContent));
    await index.upsert(await parser.parse('Beta.md', docBContent));
    await index.upsert(await parser.parse('sub/Gamma.md', docCContent));

    // Check initial backlinks
    const initialBacklinks = await index.getBacklinks('Alpha.md');
    expect(initialBacklinks.length).toBe(4); // 3 from Beta (link + subpath + embed), 1 from Gamma

    // 2. Perform safe rename: Alpha.md -> Omega.md
    const result = await renameDocument(storage, index, parser, 'Alpha.md', 'Omega.md', {
      updateLinks: true,
    });

    expect(result.oldPath).toBe('Alpha.md');
    expect(result.newPath).toBe('Omega.md');
    expect(result.updatedFiles).toContain('Beta.md');
    expect(result.updatedFiles).toContain('sub/Gamma.md');

    // 3. Verify referencing files content on disk
    const updatedBeta = await storage.readText('Beta.md');
    expect(updatedBeta).toBe(
      `# Beta\r\n\r\nReferences [[Omega]] and [[Omega#Roadmap|My Custom Roadmap]] and ![[Omega]].`
    );

    const updatedGamma = await storage.readText('sub/Gamma.md');
    expect(updatedGamma).toBe(`# Sub Folder Note\r\n\r\nRelative link to [[Omega]] in root.`);

    // 4. Verify renamed note self-reference was updated
    const updatedOmega = await storage.readText('Omega.md');
    expect(updatedOmega).toBe(
      `# Alpha\r\n\r\nThis note is Alpha. See [[Omega#Roadmap|Alpha Plan]] for details.\r\n\r\n## Roadmap\r\nPlans here.`
    );

    // 5. Verify index state
    const oldBacklinks = await index.getBacklinks('Alpha.md');
    expect(oldBacklinks.length).toBe(0);

    const newBacklinks = await index.getBacklinks('Omega.md');
    expect(newBacklinks.length).toBe(4);
    expect(newBacklinks.map((b) => b.sourcePath)).toEqual([
      'Beta.md',
      'Beta.md',
      'Beta.md',
      'sub/Gamma.md',
    ]);
  });

  it('safely renames note across directories in SqliteDocumentIndex with exact link target_path updates', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = await SqliteDocumentIndex.create();

    const docA = `# Algorithms\n\nAdvanced graph algorithms.`;
    const docB = `# Research\n\nStudy [[Algorithms]] before continuing.`;

    await storage.write('notes/Algorithms.md', undefined, docA);
    await storage.write('Research.md', undefined, docB);

    await index.upsert(await parser.parse('notes/Algorithms.md', docA));
    await index.upsert(await parser.parse('Research.md', docB));

    // Rename to deep folder
    const result = await renameDocument(
      storage,
      index,
      parser,
      'notes/Algorithms.md',
      'computer_science/core/GraphAlgorithms.md',
      { updateLinks: true }
    );

    expect(result.rewrittenLinkCount).toBe(1);

    // Verify disk content
    const updatedResearch = await storage.readText('Research.md');
    expect(updatedResearch).toBe(`# Research\n\nStudy [[GraphAlgorithms]] before continuing.`);

    // Verify SQLite index backlink accuracy
    const backlinks = await index.getBacklinks('computer_science/core/GraphAlgorithms.md');
    expect(backlinks.length).toBe(1);
    expect(backlinks[0].sourcePath).toBe('Research.md');
    expect(backlinks[0].rawLink).toBe('[[GraphAlgorithms]]');

    index.close();
  });

  it('preserves CRLF line endings and handles cyclic link graphs during note renames', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // Cyclic graph: A -> B -> C -> A
    const docA = 'Line 1\r\nLine 2 [[NodeB#Part1|Second Node]]\r\nLine 3';
    const docB = 'Line 1\r\nLine 2 [[NodeC]]\r\nLine 3';
    const docC = 'Line 1\r\nLine 2 [[NodeA]]\r\nLine 3';

    await storage.write('NodeA.md', undefined, docA);
    await storage.write('NodeB.md', undefined, docB);
    await storage.write('NodeC.md', undefined, docC);

    await index.upsert(await parser.parse('NodeA.md', docA));
    await index.upsert(await parser.parse('NodeB.md', docB));
    await index.upsert(await parser.parse('NodeC.md', docC));

    // Rename NodeB -> NodeB_Prime
    await renameDocument(storage, index, parser, 'NodeB.md', 'NodeB_Prime.md');

    const updatedA = await storage.readText('NodeA.md');
    expect(updatedA).toBe('Line 1\r\nLine 2 [[NodeB_Prime#Part1|Second Node]]\r\nLine 3');
    expect(updatedA.includes('\r\n')).toBe(true);

    // Verify cyclic backlinks
    const bBacklinks = await index.getBacklinks('NodeB_Prime.md');
    expect(bBacklinks.length).toBe(1);
    expect(bBacklinks[0].sourcePath).toBe('NodeA.md');

    const cBacklinks = await index.getBacklinks('NodeC.md');
    expect(cBacklinks.length).toBe(1);
    expect(cBacklinks[0].sourcePath).toBe('NodeB_Prime.md');
  });

  it('proves code blocks and inline code are immune to wikilink rewriting (P4-4 / F-010)', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const targetDoc = '# Target Note\nContent';
    const sampleDoc = `---
title: Code Sample Document
---

Real reference: [[Target Note]]

\`\`\`markdown
Here is a sample wikilink that must not be changed: [[Target Note]]
\`\`\`

Here is inline code: \`[[Target Note]]\` which also stays untouched.

Another real reference: [[Target Note|Custom Display]]
`;

    await storage.write('Target Note.md', undefined, targetDoc);
    await storage.write('Sample.md', undefined, sampleDoc);

    await index.upsert(await parser.parse('Target Note.md', targetDoc));
    await index.upsert(await parser.parse('Sample.md', sampleDoc));

    // Rename target
    await renameDocument(storage, index, parser, 'Target Note.md', 'New Target.md');

    const updatedSample = await storage.readText('Sample.md');

    // Real links are rewritten
    expect(updatedSample).toContain('Real reference: [[New Target]]');
    expect(updatedSample).toContain('Another real reference: [[New Target|Custom Display]]');

    // Code blocks and inline spans are untouched!
    expect(updatedSample).toContain(
      '```markdown\nHere is a sample wikilink that must not be changed: [[Target Note]]\n```'
    );
    expect(updatedSample).toContain('`[[Target Note]]`');
  });

  it('prevents silent overwrite on concurrent external modification and rolls back (P4-1 / P4-2 / F-001)', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const docA = '# Note A\nContent';
    const docB = '# Note B\nLinks to [[Note A]]';

    await storage.write('Note A.md', undefined, docA);
    await storage.write('Note B.md', undefined, docB);

    await index.upsert(await parser.parse('Note A.md', docA));
    await index.upsert(await parser.parse('Note B.md', docB));

    // Intercept storage.write to simulate concurrent external modification of Note B
    const originalWrite = storage.write.bind(storage);
    let injectedConflict = false;

    storage.write = async (path, expectedVersion, content) => {
      if (path === 'Note B.md' && !injectedConflict) {
        injectedConflict = true;
        // External process writes to Note B right before rename reaches it
        await originalWrite('Note B.md', undefined, '# Note B\nEXTERNAL EDIT while renaming!');
      }
      return originalWrite(path, expectedVersion, content);
    };

    // Attempting rename should detect version conflict and abort
    await expect(
      renameDocument(storage, index, parser, 'Note A.md', 'Note A Renamed.md')
    ).rejects.toThrow();

    // Verify external edit was NOT overwritten
    const finalB = await storage.readText('Note B.md');
    expect(finalB).toBe('# Note B\nEXTERNAL EDIT while renaming!');

    // Verify rollback restored Note A
    expect(await storage.exists('Note A.md')).toBe(true);
    expect(await storage.exists('Note A Renamed.md')).toBe(false);
  });

  it('proves incremental SQLite vs Memory index link re-resolution parity (P4-3)', async () => {
    const memory = new MemoryDocumentIndex();
    const sqlite = await SqliteDocumentIndex.create();
    const parser = new DefaultDocumentParser();

    // Document 1 references [[c]]
    const doc1 = await parser.parse('a/b.md', '# Note B\nLinks [[c]]');
    await memory.upsert(doc1);
    await sqlite.upsert(doc1);

    // Document 2 is root c.md
    const doc2 = await parser.parse('c.md', '# Root C\nContent');
    await memory.upsert(doc2);
    await sqlite.upsert(doc2);

    // Both should agree that c.md has backlink from a/b.md
    const memBacklinks = await memory.getBacklinks('c.md');
    const sqlBacklinks = await sqlite.getBacklinks('c.md');
    expect(sqlBacklinks).toEqual(memBacklinks);
    expect(sqlBacklinks.length).toBe(1);

    // Now insert Document 3: a/c.md (relative path priority over root c.md)
    const doc3 = await parser.parse('a/c.md', '# Relative C\nContent');
    await memory.upsert(doc3);
    await sqlite.upsert(doc3);

    // Due to relative priority, a/b.md now targets a/c.md instead of root c.md
    const memRel = await memory.getBacklinks('a/c.md');
    const sqlRel = await sqlite.getBacklinks('a/c.md');
    expect(sqlRel).toEqual(memRel);
    expect(sqlRel.length).toBe(1);

    // Root c.md should now have 0 backlinks in both
    const memRoot = await memory.getBacklinks('c.md');
    const sqlRoot = await sqlite.getBacklinks('c.md');
    expect(sqlRoot).toEqual(memRoot);
    expect(sqlRoot.length).toBe(0);

    sqlite.close();
  });

  it('handles Unicode normalization and non-ASCII character targets cleanly', async () => {
    const storage = new MemoryVaultStorage();
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const cafeNFC = 'Café.md'.normalize('NFC');
    const cafeDoc = '# Café Guide\nFrench coffee culture.';
    const refDoc = `# Travel\nVisit the [[${cafeNFC.replace('.md', '')}]] today.`;

    await storage.write(cafeNFC, undefined, cafeDoc);
    await storage.write('Travel.md', undefined, refDoc);

    await index.upsert(await parser.parse(cafeNFC, cafeDoc));
    await index.upsert(await parser.parse('Travel.md', refDoc));

    // Verify initial backlink
    const bl = await index.getBacklinks(cafeNFC);
    expect(bl.length).toBe(1);

    // Rename to another Unicode name
    const newNameNFC = 'Bistrô.md'.normalize('NFC');
    await renameDocument(storage, index, parser, cafeNFC, newNameNFC);

    const updatedTravel = await storage.readText('Travel.md');
    expect(updatedTravel).toContain('[[Bistrô]]');

    const newBl = await index.getBacklinks(newNameNFC);
    expect(newBl.length).toBe(1);
  });
});
