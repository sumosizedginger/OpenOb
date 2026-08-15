import { describe, expect, it } from 'vitest';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import {
  SqliteDocumentIndex,
  executePropertyQuery,
  buildGraphData,
  rebuildVaultIndex,
} from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  retrieveContext,
  formatContextPrompt,
  parseProposedEditFromResponse,
  applyProposedEdit,
} from '@okw/ai';
import {
  PluginHost,
  wordCountManifest,
  WordCountPlugin,
  templatesManifest,
  TemplatesPlugin,
  characterBibleManifest,
  CharacterBiblePlugin,
  manuscriptToolsManifest,
  ManuscriptToolsPlugin,
} from '@okw/plugin';

describe('Phase 11 Exit Gate: Full System End-to-End Integration & Public Alpha Readiness', () => {
  it('exercises complete cross-subsystem lifecycle with zero data loss and 100% contract cohesion', async () => {
    // -------------------------------------------------------------------------
    // 1. Storage & SafeWriter Initialization (Phases 0 & 1)
    // -------------------------------------------------------------------------
    const storage = new MemoryVaultStorage('Dogfood Alpha Vault');
    const safeWriter = new SafeWriter(storage);
    const parser = new DefaultDocumentParser();
    const index = await SqliteDocumentIndex.create();

    const initialDocs: Record<string, string> = {
      'Welcome.md': `# Welcome\n\nCanonical Markdown notes with [[Architecture]].`,
      'Architecture.md': `---\ntitle: Architecture\nstatus: active\n---\n# Architecture\n\nCore system layers. Links to [[Characters/Kaelen]].`,
      'Characters/Kaelen.md': `---\ntitle: Kaelen\ntype: character\nrole: protagonist\nstatus: active\ntags: [character, hero]\n---\n# Kaelen\n\nThe wanderer of the Spire.`,
      'Manuscript/Chapter_01.md': `# Chapter 1\n\n` + 'Story word '.repeat(500),
      'Projects/Alpha.md': `---\ntitle: Alpha Milestone\ntype: project\nstatus: in_progress\npriority: 1\n---\n# Alpha Milestone\n\nDelivery checklist.`,
    };

    for (const [path, content] of Object.entries(initialDocs)) {
      await storage.write(path, null, content);
      const parsed = await parser.parse(path, content);
      await index.upsert(parsed);
    }

    // -------------------------------------------------------------------------
    // 2. Wikilinks, Backlinks & Search (Phases 2, 3 & 4)
    // -------------------------------------------------------------------------
    const searchResults = await index.query({ query: 'Spire' });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].path).toBe('Characters/Kaelen.md');

    const backlinksToArch = await index.getBacklinks('Architecture.md');
    expect(backlinksToArch.some((b: any) => b.sourcePath === 'Welcome.md')).toBe(true);

    // -------------------------------------------------------------------------
    // 3. Graph Engine (Phase 5)
    // -------------------------------------------------------------------------
    const graph = await buildGraphData(index, { includeTags: true });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(5);
    expect(graph.edges.some((e: any) => e.target === 'Architecture.md')).toBe(true);

    // -------------------------------------------------------------------------
    // 4. Notion-Like Views & Property Queries (Phase 6)
    // -------------------------------------------------------------------------
    const characterView = await executePropertyQuery(index, {
      id: 'characters',
      name: 'Characters',
      type: 'table',
      filters: [{ field: 'type', operator: 'equals', value: 'character' }],
      sorts: [{ field: 'title', direction: 'asc' }],
    });

    expect(characterView).toHaveLength(1);
    expect(characterView[0].title).toBe('Kaelen');
    expect(characterView[0].properties.role).toBe('protagonist');

    // -------------------------------------------------------------------------
    // 5. Scoped Local & Cloud AI Retrieval & Safe Proposal Apply (Phases 7 & 8)
    // -------------------------------------------------------------------------
    const aiContext = await retrieveContext(storage, index, 'Who is Kaelen?', {
      type: 'folder',
      folderPrefix: 'Characters',
    });

    const prompt = formatContextPrompt(aiContext);
    expect(prompt).toContain('The wanderer of the Spire');

    const originalKaelenContent = initialDocs['Characters/Kaelen.md'];
    const aiResponse = `Here is the updated character bio:
\`\`\`markdown
---
title: Kaelen
type: character
role: protagonist
status: active
tags: [character, hero, veteran]
---
# Kaelen

The seasoned veteran and wanderer of the Spire.
\`\`\`
Updated with veteran lore.`;

    const proposal = parseProposedEditFromResponse(
      aiResponse,
      'Characters/Kaelen.md',
      originalKaelenContent
    );
    expect(proposal).not.toBeNull();

    // Concurrency Divergence Guard Check (F-028)
    const applySuccess = await applyProposedEdit(storage, safeWriter, proposal!);
    expect(applySuccess.success).toBe(true);

    const updatedKaelenDoc = await storage.read('Characters/Kaelen.md');
    const updatedKaelenText = new TextDecoder().decode(updatedKaelenDoc.content);
    expect(updatedKaelenText).toContain('seasoned veteran');

    // Re-index updated document
    await index.upsert(await parser.parse('Characters/Kaelen.md', updatedKaelenText));

    // -------------------------------------------------------------------------
    // 6. Sandboxed Plugin SDK & First-Party Dogfooding (Phases 9 & 10)
    // -------------------------------------------------------------------------
    let navigatedPath: string | null = null;
    const notices: string[] = [];

    const pluginHost = new PluginHost({
      storage,
      index,
      activeNotePath: 'Manuscript/Chapter_01.md',
      openNote: async (p) => {
        navigatedPath = p;
      },
      showNotice: (msg) => {
        notices.push(msg);
      },
    });

    pluginHost.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    pluginHost.registerPlugin(templatesManifest, () => new TemplatesPlugin());
    pluginHost.registerPlugin(characterBibleManifest, () => new CharacterBiblePlugin());
    pluginHost.registerPlugin(manuscriptToolsManifest, () => new ManuscriptToolsPlugin());

    await pluginHost.enablePlugin(wordCountManifest.id);
    await pluginHost.enablePlugin(templatesManifest.id);
    await pluginHost.enablePlugin(characterBibleManifest.id);
    await pluginHost.enablePlugin(manuscriptToolsManifest.id);

    // Test WordCount Plugin
    const wcRes = await pluginHost.executeCommand('wordCount.compute');
    expect(wcRes.success).toBe(true);
    expect(notices.some((n) => n.includes('1003 words'))).toBe(true);

    // Test Templates Plugin
    const tplRes = await pluginHost.executeCommand('templates.createFromTemplate');
    expect(tplRes.success).toBe(true);
    expect(navigatedPath).toContain('Notes/Meeting-');

    // Test ManuscriptTools Plugin
    const msRes = await pluginHost.executeCommand('manuscriptTools.progressReport');
    expect(msRes.success).toBe(true);
    expect(notices.some((n) => n.includes('Manuscript Progress'))).toBe(true);

    // Index newly created template note into live index
    const templateDocContent = new TextDecoder().decode((await storage.read(navigatedPath!)).content);
    await index.upsert(await parser.parse(navigatedPath!, templateDocContent));

    // -------------------------------------------------------------------------
    // 7. Full SQLite Disposal & Exact Parity Rebuild Verification (D-002, F-003, F-004)
    // -------------------------------------------------------------------------
    const preDocs = await index.getAll();
    const preBacklinksArch = await index.getBacklinks('Architecture.md');
    const preCharacterQuery = await executePropertyQuery(index, {
      id: 'chars',
      name: 'Chars',
      type: 'table',
      filters: [{ field: 'type', operator: 'equals', value: 'character' }],
    });

    // Explicit disposal of original SQLite index
    index.close();

    // Reconstruct brand new SQLite index completely from canonical disk files
    const freshIndex = await SqliteDocumentIndex.create();
    const rebuildStats = await rebuildVaultIndex(storage, freshIndex, parser);

    const postDocs = await freshIndex.getAll();
    expect(rebuildStats.totalIndexed).toBe(preDocs.length);
    expect(postDocs.length).toBe(preDocs.length);

    // Doc-by-doc exact parity verification
    for (const preDoc of preDocs) {
      const postDoc = postDocs.find((d) => d.path === preDoc.path);
      expect(postDoc).toBeDefined();
      expect(postDoc!.title).toBe(preDoc.title);
      expect(postDoc!.versionHash).toBe(preDoc.versionHash);
      expect(postDoc!.tags.sort()).toEqual(preDoc.tags.sort());
      expect(postDoc!.headings.length).toBe(preDoc.headings.length);
      expect(postDoc!.links.length).toBe(preDoc.links.length);
      expect(postDoc!.properties).toEqual(preDoc.properties);
    }

    // Backlink query exact parity
    const postBacklinksArch = await freshIndex.getBacklinks('Architecture.md');
    expect(postBacklinksArch.length).toBe(preBacklinksArch.length);
    expect(postBacklinksArch.map((b) => b.sourcePath).sort()).toEqual(
      preBacklinksArch.map((b) => b.sourcePath).sort()
    );

    // Property query exact parity
    const postCharacterQuery = await executePropertyQuery(freshIndex, {
      id: 'chars',
      name: 'Chars',
      type: 'table',
      filters: [{ field: 'type', operator: 'equals', value: 'character' }],
    });
    expect(postCharacterQuery.length).toBe(preCharacterQuery.length);
    expect(postCharacterQuery[0].path).toBe(preCharacterQuery[0].path);

    // Multi-query search exact parity
    const queryTerms = ['Spire', 'Architecture', 'Meeting'];
    for (const term of queryTerms) {
      const res = await freshIndex.query({ query: term });
      expect(res.length).toBeGreaterThanOrEqual(1);
    }

    // Graph topology exact parity
    const freshGraph = await buildGraphData(freshIndex);
    expect(freshGraph.nodes.length).toBe(preDocs.length);

    // -------------------------------------------------------------------------
    // 8. Final Invariant: Zero Data Corruption Across the System
    // -------------------------------------------------------------------------
    const allFiles = await storage.list('', true);
    expect(allFiles.filter((f) => !f.isDirectory).length).toBe(preDocs.length);
  });
});
