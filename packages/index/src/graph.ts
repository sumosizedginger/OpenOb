import {
  DocumentIndex,
  GraphData,
  GraphEdge,
  GraphFilterOptions,
  GraphNode,
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

  const validPathSet = new Set<string>();
  for (let i = 0; i < filteredDocs.length; i++) {
    validPathSet.add(filteredDocs[i].path);
  }

  // 2. Build edges with provenance using single-pass fast resolver
  const resolver = new DefaultLinkResolver(() => allDocs);
  const edges: GraphEdge[] = [];
  const edgeKeySet = new Set<string>();
  const degreeMap = new Map<string, number>();

  for (let d = 0; d < filteredDocs.length; d++) {
    const doc = filteredDocs[d];
    const links = doc.links;
    for (let l = 0; l < links.length; l++) {
      const link = links[l];
      const res = resolver.resolve(doc.path, link.target);
      if (res.resolved && res.targetPath && validPathSet.has(res.targetPath)) {
        if (res.targetPath === doc.path) continue; // Skip self-edges

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
    for (let d = 0; d < filteredDocs.length; d++) {
      const doc = filteredDocs[d];
      for (let t = 0; t < doc.tags.length; t++) {
        const tag = doc.tags[t];
        let list = tagToDocs.get(tag);
        if (!list) {
          list = [];
          tagToDocs.set(tag, list);
        }
        list.push(doc.path);
      }
    }

    for (const [tag, docPaths] of tagToDocs.entries()) {
      const tagNodeId = `tag:${tag}`;
      tagNodes.push({
        id: tagNodeId,
        path: tagNodeId,
        title: `#${tag}`,
        tags: [tag],
        val: docPaths.length,
        group: 'tag',
        isTagNode: true,
      });

      for (let p = 0; p < docPaths.length; p++) {
        const docPath = docPaths[p];
        edges.push({
          source: docPath,
          target: tagNodeId,
          kind: 'tag',
          provenance: { tag },
        });
        degreeMap.set(docPath, (degreeMap.get(docPath) || 0) + 1);
      }
    }
  }

  // 4. Construct Node Objects
  let nodes: GraphNode[] = filteredDocs.map((doc) => {
    const segments = doc.path.split('/');
    const group = segments.length > 1 ? segments[0] : 'root';
    const val = degreeMap.get(doc.path) || 0;

    return {
      id: doc.path,
      path: doc.path,
      title: doc.title,
      tags: doc.tags,
      val: Math.max(1, val),
      group,
      properties: doc.properties,
      isTagNode: false,
    };
  });

  if (options.includeTags) {
    nodes = nodes.concat(tagNodes);
  }

  // 5. Hide Orphans filter
  if (options.hideOrphans) {
    const connectedIds = new Set<string>();
    for (let e = 0; e < edges.length; e++) {
      connectedIds.add(edges[e].source);
      connectedIds.add(edges[e].target);
    }
    nodes = nodes.filter((n) => connectedIds.has(n.id));
  }

  // 6. Local Graph Neighborhood Extraction (BFS)
  if (options.focusNodeId) {
    const focusId = options.focusNodeId;
    const maxDepth = options.maxDepth ?? 1;

    const adjacency = new Map<string, Set<string>>();
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }

    const visited = new Set<string>([focusId]);
    let currentLevel = new Set<string>([focusId]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel = new Set<string>();
      for (const node of currentLevel) {
        const neighbors = adjacency.get(node);
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
    const localNodeIds = new Set(nodes.map((n) => n.id));
    const localEdges = edges.filter(
      (e) => localNodeIds.has(e.source) && localNodeIds.has(e.target)
    );

    return {
      nodes,
      edges: localEdges,
    };
  }

  return {
    nodes,
    edges,
  };
}
