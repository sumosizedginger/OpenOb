import {
  DocumentIndex,
  GraphData,
  GraphEdge,
  GraphFilterOptions,
  GraphNode,
  ParsedDocument,
} from '@okw/core';
import { DefaultLinkResolver } from './link-resolver.js';

/**
 * Builds provenance-aware graph data strictly from DocumentIndex (Constitution Law 21).
 * Supports global graph, local graph neighborhood extraction, tag nodes, and filtering.
 */
export async function buildGraphData(
  index: DocumentIndex,
  options: GraphFilterOptions = {}
): Promise<GraphData> {
  const allDocs = await index.getAll();
  const docMap = new Map<string, ParsedDocument>();

  for (const doc of allDocs) {
    docMap.set(doc.path, doc);
    docMap.set(doc.id, doc);
  }

  // 1. Filter documents based on query, folder, and tags
  let filteredDocs = allDocs;

  if (options.folders && options.folders.length > 0) {
    filteredDocs = filteredDocs.filter((doc) =>
      options.folders!.some((folder) => {
        const norm = folder.replace(/\/+$/, '');
        return doc.path === norm || doc.path.startsWith(`${norm}/`);
      })
    );
  }

  if (options.filterTags && options.filterTags.length > 0) {
    filteredDocs = filteredDocs.filter((doc) =>
      options.filterTags!.some((t) => doc.tags.includes(t))
    );
  }

  if (options.searchQuery && options.searchQuery.trim()) {
    const q = options.searchQuery.trim().toLowerCase();
    filteredDocs = filteredDocs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.path.toLowerCase().includes(q) ||
        doc.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  const validPathSet = new Set(filteredDocs.map((d) => d.path));

  // 2. Build edges with provenance using fast batch resolver
  const resolver = new DefaultLinkResolver(() => allDocs);
  const edges: GraphEdge[] = [];
  const edgeKeySet = new Set<string>();
  const degreeMap = new Map<string, number>();

  for (const doc of filteredDocs) {
    for (const link of doc.links) {
      const res = resolver.resolve(doc.path, link.target);
      if (res.resolved && res.targetPath && validPathSet.has(res.targetPath)) {
        if (res.targetPath === doc.path) continue; // Skip self-edges in graph view

        const kind = link.isEmbed ? 'embed' : 'wikilink';
        const edgeKey = `${doc.path}->${res.targetPath}:${kind}:${link.line}`;

        if (!edgeKeySet.has(edgeKey)) {
          edgeKeySet.add(edgeKey);
          edges.push({
            source: doc.path,
            target: res.targetPath,
            kind,
            provenance: {
              line: link.line,
              isEmbed: link.isEmbed,
            },
          });

          degreeMap.set(doc.path, (degreeMap.get(doc.path) || 0) + 1);
          degreeMap.set(res.targetPath, (degreeMap.get(res.targetPath) || 0) + 1);
        }
      }
    }
  }

  // 3. Optional tag nodes & edges
  const tagNodes: GraphNode[] = [];
  if (options.includeTags) {
    const tagToDocs = new Map<string, string[]>();
    for (const doc of filteredDocs) {
      for (const tag of doc.tags) {
        const list = tagToDocs.get(tag) || [];
        list.push(doc.path);
        tagToDocs.set(tag, list);
      }
    }

    for (const [tag, docPaths] of tagToDocs.entries()) {
      const tagId = `tag:#${tag}`;
      tagNodes.push({
        id: tagId,
        path: tagId,
        title: `#${tag}`,
        tags: [tag],
        val: docPaths.length + 1,
        group: 'tag',
        isTagNode: true,
      });

      for (const docPath of docPaths) {
        edges.push({
          source: docPath,
          target: tagId,
          kind: 'tag',
          provenance: { tag },
        });
        degreeMap.set(docPath, (degreeMap.get(docPath) || 0) + 1);
      }
    }
  }

  // 4. Build document nodes
  let nodes: GraphNode[] = filteredDocs.map((doc) => {
    const folderParts = doc.path.split('/');
    const group = folderParts.length > 1 ? folderParts[0] : 'root';
    const degree = degreeMap.get(doc.path) || 0;

    return {
      id: doc.path,
      path: doc.path,
      title: doc.title,
      tags: doc.tags,
      val: Math.max(1, degree),
      group,
      properties: doc.properties,
      isTagNode: false,
    };
  });

  if (options.includeTags) {
    nodes = [...nodes, ...tagNodes];
  }

  // 5. Local Graph extraction (focusNodeId & maxDepth)
  if (options.focusNodeId) {
    const maxDepth = options.maxDepth ?? 1;
    const visited = new Set<string>([options.focusNodeId]);
    let currentLevel = new Set<string>([options.focusNodeId]);

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
    }

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel = new Set<string>();
      for (const nodeId of currentLevel) {
        const neighbors = adj.get(nodeId);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              nextLevel.add(neighbor);
            }
          }
        }
      }
      currentLevel = nextLevel;
      if (currentLevel.size === 0) break;
    }

    nodes = nodes.filter((n) => visited.has(n.id));
    const visitedSet = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: edges.filter((e) => visitedSet.has(e.source) && visitedSet.has(e.target)),
    };
  }

  // 6. Hide orphans filter
  if (options.hideOrphans) {
    nodes = nodes.filter((n) => (degreeMap.get(n.id) || 0) > 0);
    const nodeSet = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target)),
    };
  }

  return { nodes, edges };
}
