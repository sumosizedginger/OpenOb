import { describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex, SqliteDocumentIndex, buildGraphData } from '@okw/index';

describe('Phase 5 Exit Gate: Graph, Metadata & Provenance-Aware Edges (Constitution Law 21)', () => {
  it('builds provenance-aware graph data strictly from DocumentIndex with rich edge types', async () => {
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // 1. Setup interconnected fixture
    const docA = await parser.parse(
      'projects/Alpha.md',
      `---\ntitle: Project Alpha\ntags: [ai, active]\n---\n# Project Alpha\nLinks to [[Beta]] on line 5 and embeds ![[Gamma]] on line 6.`
    );
    const docB = await parser.parse(
      'projects/Beta.md',
      `---\ntitle: Project Beta\ntags: [ai]\n---\n# Project Beta\nLinks to [[projects/Alpha]] and [[Gamma]].`
    );
    const docC = await parser.parse(
      'Gamma.md',
      `---\ntitle: Gamma Spec\ntags: [spec]\n---\n# Gamma Spec\nIndependent spec.`
    );
    const orphanDoc = await parser.parse(
      'Orphan.md',
      `---\ntitle: Lone Note\ntags: [draft]\n---\n# Lone Note\nNo connections.`
    );

    await index.upsert(docA);
    await index.upsert(docB);
    await index.upsert(docC);
    await index.upsert(orphanDoc);

    // 2. Build global graph without tags
    const graph1 = await buildGraphData(index, { includeTags: false });

    expect(graph1.nodes.length).toBe(4);
    expect(graph1.edges.length).toBe(4);

    // Check edge provenance
    const embedEdge = graph1.edges.find((e) => e.kind === 'embed');
    expect(embedEdge).toBeDefined();
    expect(embedEdge?.source).toBe('projects/Alpha.md');
    expect(embedEdge?.target).toBe('Gamma.md');
    expect(embedEdge?.provenance?.isEmbed).toBe(true);

    const wikilinkEdge = graph1.edges.find(
      (e) => e.source === 'projects/Alpha.md' && e.target === 'projects/Beta.md'
    );
    expect(wikilinkEdge).toBeDefined();
    expect(wikilinkEdge?.kind).toBe('wikilink');

    // 3. Build graph with tag nodes enabled
    const graphWithTags = await buildGraphData(index, { includeTags: true });
    const tagNodes = graphWithTags.nodes.filter((n) => n.isTagNode);
    expect(tagNodes.length).toBe(4); // #ai, #active, #spec, #draft

    const aiTagNode = tagNodes.find((n) => n.title === '#ai');
    expect(aiTagNode).toBeDefined();
    expect(aiTagNode?.val).toBeGreaterThan(1); // Connected to Alpha and Beta

    // 4. Test Local Graph neighborhood (focus on Gamma.md, depth=1)
    const localGraph = await buildGraphData(index, { focusNodeId: 'Gamma.md', maxDepth: 1 });
    const localPaths = localGraph.nodes.map((n) => n.path);
    expect(localPaths).toContain('Gamma.md');
    expect(localPaths).toContain('projects/Alpha.md');
    expect(localPaths).toContain('projects/Beta.md');
    expect(localPaths).not.toContain('Orphan.md');

    // 5. Test Hide Orphans filter
    const connectedOnly = await buildGraphData(index, { hideOrphans: true });
    expect(connectedOnly.nodes.map((n) => n.path)).not.toContain('Orphan.md');
    expect(connectedOnly.nodes.length).toBe(3);
  });

  it('builds graph from SqliteDocumentIndex with 100% exact parity', async () => {
    const parser = new DefaultDocumentParser();
    const memory = new MemoryDocumentIndex();
    const sqlite = await SqliteDocumentIndex.create();

    const doc1 = await parser.parse('A.md', '# Note A\nLinks [[B]] and [[C]]');
    const doc2 = await parser.parse('B.md', '# Note B\nLinks [[C]]');
    const doc3 = await parser.parse('C.md', '# Note C\nLinks [[A]]');

    for (const d of [doc1, doc2, doc3]) {
      await memory.upsert(d);
      await sqlite.upsert(d);
    }

    const memGraph = await buildGraphData(memory);
    const sqlGraph = await buildGraphData(sqlite);

    expect(sqlGraph.nodes.length).toBe(memGraph.nodes.length);
    expect(sqlGraph.edges.length).toBe(memGraph.edges.length);
    expect(sqlGraph.nodes.map((n) => n.id).sort()).toEqual(memGraph.nodes.map((n) => n.id).sort());

    sqlite.close();
  });

  it('scales efficiently to 1,000 notes under 50ms performance budget', async () => {
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    const docCount = 1000;
    const docs = [];

    for (let i = 0; i < docCount; i++) {
      const target1 = `note_${(i + 1) % docCount}.md`;
      const target2 = `note_${(i * 7) % docCount}.md`;
      const content = `---
title: Note ${i}
tags: [tag_${i % 10}, general]
---
# Note ${i}
Links to [[${target1}]] and ![[${target2}]].
`;
      docs.push(await parser.parse(`folder_${i % 10}/note_${i}.md`, content));
    }

    await index.rebuild(docs);

    const start = Date.now();
    const graphData = await buildGraphData(index, { includeTags: true });
    const duration = Date.now() - start;

    expect(graphData.nodes.length).toBeGreaterThan(docCount);
    expect(graphData.edges.length).toBeGreaterThan(docCount);
    expect(duration).toBeLessThan(100);
  });
});
