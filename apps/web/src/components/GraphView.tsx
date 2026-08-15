import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DocumentIndex, GraphData, GraphEdge, GraphNode, VaultPath } from '@okw/core';
import { buildGraphData } from '@okw/index';
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Filter,
  Tag,
  Share2,
  X,
  Sparkles,
} from 'lucide-react';

interface GraphViewProps {
  index: DocumentIndex;
  activeNotePath?: VaultPath | null;
  refreshKey?: any;
  onNavigate: (path: VaultPath) => void;
  onClose?: () => void;
  isLocal?: boolean;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface SimEdge {
  source: SimNode;
  target: SimNode;
  kind: GraphEdge['kind'];
}

// Harmonious palette for node groups
const GROUP_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
];

export const GraphView: React.FC<GraphViewProps> = ({
  index,
  activeNotePath,
  refreshKey,
  onNavigate,
  onClose,
  isLocal = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Filter & view state
  const [includeTags, setIncludeTags] = useState(false);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [maxDepth, setMaxDepth] = useState(isLocal ? 1 : 2);
  const localMode = isLocal;

  // Graph data & tooltip state
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [tooltipNode, setTooltipNode] = useState<SimNode | null>(null);

  // Refs for persistent non-restarting physics loop (P5-4)
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);
  const draggedNodeRef = useRef<SimNode | null>(null);
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const dprRef = useRef(1);

  // Color map for folder groups
  const groupColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    for (const node of graphData.nodes) {
      if (node.isTagNode) {
        map.set('tag', '#a855f7');
      } else if (!map.has(node.group)) {
        map.set(node.group, GROUP_COLORS[colorIdx % GROUP_COLORS.length]);
        colorIdx++;
      }
    }
    return map;
  }, [graphData]);

  // Load graph data when filters, active note, or refreshKey changes (P5-6)
  useEffect(() => {
    let isMounted = true;
    const fetchGraph = async () => {
      const data = await buildGraphData(index, {
        includeTags,
        hideOrphans,
        searchQuery: searchQuery.trim() ? searchQuery : undefined,
        focusNodeId: localMode && activeNotePath ? activeNotePath : undefined,
        maxDepth: localMode ? maxDepth : undefined,
      });

      if (isMounted) {
        setGraphData(data);
      }
    };

    fetchGraph();
    return () => {
      isMounted = false;
    };
  }, [index, activeNotePath, refreshKey, includeTags, hideOrphans, searchQuery, localMode, maxDepth]);

  // Handle ResizeObserver for crisp Retina / dynamic DPR canvas rendering (P5-5)
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        dprRef.current = dpr;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        if (transformRef.current.x === 0 && transformRef.current.y === 0) {
          transformRef.current.x = width / 2;
          transformRef.current.y = height / 2;
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Initialize simulation nodes & edges
  useEffect(() => {
    const container = containerRef.current;
    const width = container?.clientWidth || 600;
    const height = container?.clientHeight || 500;

    const existingMap = new Map(simNodesRef.current.map((n) => [n.id, n]));

    const simNodes: SimNode[] = graphData.nodes.map((node) => {
      const existing = existingMap.get(node.id);
      const radius = node.isTagNode ? 5 : Math.min(18, Math.max(6, 4 + Math.sqrt(node.val) * 3));
      const color = node.isTagNode ? '#a855f7' : groupColorMap.get(node.group) || '#3b82f6';

      return {
        ...node,
        x: existing ? existing.x : width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: existing ? existing.y : height / 2 + (Math.random() - 0.5) * height * 0.6,
        vx: 0,
        vy: 0,
        radius,
        color,
      };
    });

    const nodeLookup = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = [];

    for (const edge of graphData.edges) {
      const src = nodeLookup.get(edge.source);
      const tgt = nodeLookup.get(edge.target);
      if (src && tgt) {
        simEdges.push({ source: src, target: tgt, kind: edge.kind });
      }
    }

    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;
  }, [graphData, groupColorMap]);

  // Persistent Physics animation loop (P5-4: does NOT restart on hover!)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let alpha = 1.0;
    const alphaMin = 0.001;
    const alphaDecay = 0.02;

    const render = () => {
      const container = containerRef.current;
      const cssWidth = container?.clientWidth || 600;
      const cssHeight = container?.clientHeight || 500;
      const dpr = dprRef.current;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const nodes = simNodesRef.current;
      const edges = simEdgesRef.current;

      // 1. Run physics step if simulation is warm
      if (alpha > alphaMin || draggedNodeRef.current) {
        // Repulsion (Coulomb)
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const n2 = nodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const distSq = dx * dx + dy * dy || 1;
            const dist = Math.sqrt(distSq);

            if (dist < 400) {
              const force = (alpha * 1200) / distSq;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              n1.vx -= fx;
              n1.vy -= fy;
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }

        // Attraction (Springs)
        const targetLen = isLocal ? 70 : 90;
        for (const edge of edges) {
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - targetLen) * 0.05 * alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          edge.source.vx += fx;
          edge.source.vy += fy;
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }

        // Center gravity & velocity damping
        for (const node of nodes) {
          if (node === draggedNodeRef.current) continue;
          node.vx += (cssWidth / 2 - node.x) * 0.001 * alpha;
          node.vy += (cssHeight / 2 - node.y) * 0.001 * alpha;

          node.vx *= 0.85;
          node.vy *= 0.85;

          node.x += node.vx;
          node.y += node.vy;
        }

        alpha *= 1 - alphaDecay;
      }

      // 2. Draw canvas
      ctx.save();
      const { x: panX, y: panY, scale } = transformRef.current;
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      const currentHovered = hoveredNodeRef.current;
      const connectedNodeIds = new Set<string>();
      if (currentHovered) {
        connectedNodeIds.add(currentHovered.id);
        for (const edge of edges) {
          if (edge.source.id === currentHovered.id) connectedNodeIds.add(edge.target.id);
          if (edge.target.id === currentHovered.id) connectedNodeIds.add(edge.source.id);
        }
      }

      // Draw Edges
      for (const edge of edges) {
        const isHovered =
          currentHovered &&
          (edge.source.id === currentHovered.id || edge.target.id === currentHovered.id);
        const isDimmed = currentHovered && !isHovered;

        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);

        if (edge.kind === 'embed') {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isHovered ? '#60a5fa' : isDimmed ? '#33415540' : '#475569';
          ctx.lineWidth = isHovered ? 2 : 1;
        } else if (edge.kind === 'tag') {
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = isHovered ? '#c084fc' : isDimmed ? '#33415530' : '#64748b60';
          ctx.lineWidth = isHovered ? 1.5 : 0.8;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = isHovered ? '#93c5fd' : isDimmed ? '#33415540' : '#47556980';
          ctx.lineWidth = isHovered ? 2 : 1.2;
        }

        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Nodes
      for (const node of nodes) {
        const isHovered = currentHovered?.id === node.id;
        const isConnected = connectedNodeIds.has(node.id);
        const isDimmed = currentHovered && !isConnected;
        const isActive = node.path === activeNotePath;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

        if (isActive) {
          ctx.fillStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 12;
        } else if (node.isTagNode) {
          ctx.fillStyle = isDimmed ? '#a855f740' : '#a855f7';
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = isDimmed ? `${node.color}40` : node.color;
          ctx.shadowBlur = isHovered ? 10 : 0;
          ctx.shadowColor = node.color;
        }

        ctx.fill();
        ctx.shadowBlur = 0;

        if (isHovered || isActive) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label
        const showLabel = scale > 0.8 || isHovered || isActive || node.val > 3;
        if (showLabel) {
          ctx.font = isHovered || isActive ? 'bold 12px Inter, sans-serif' : '11px Inter, sans-serif';
          ctx.fillStyle = isDimmed ? '#94a3b850' : '#f1f5f9';
          ctx.textAlign = 'center';
          ctx.fillText(node.title, node.x, node.y + node.radius + 14);
        }
      }

      ctx.restore();
      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [activeNotePath, isLocal]);

  // Coordinate helper: Canvas screen coords -> graph world coords (P5-5)
  const screenToWorld = (screenX: number, screenY: number) => {
    const { x: panX, y: panY, scale } = transformRef.current;
    return {
      x: (screenX - panX) / scale,
      y: (screenY - panY) / scale,
    };
  };

  // Canvas Mouse Interactions (Pan, Zoom, Drag, Hover, Click)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const world = screenToWorld(clickX, clickY);

    dragDistanceRef.current = 0;

    const hitNode = simNodesRef.current.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (hitNode) {
      draggedNodeRef.current = hitNode;
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: clickX - transformRef.current.x, y: clickY - transformRef.current.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const world = screenToWorld(clickX, clickY);

    if (draggedNodeRef.current) {
      dragDistanceRef.current += Math.abs(world.x - draggedNodeRef.current.x) + Math.abs(world.y - draggedNodeRef.current.y);
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingRef.current) {
      const newX = clickX - dragStartRef.current.x;
      const newY = clickY - dragStartRef.current.y;
      dragDistanceRef.current += Math.abs(newX - transformRef.current.x) + Math.abs(newY - transformRef.current.y);
      transformRef.current.x = newX;
      transformRef.current.y = newY;
      return;
    }

    // Hover detection without restarting simulation loop (P5-4)
    const hitNode = simNodesRef.current.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    hoveredNodeRef.current = hitNode || null;
    setTooltipNode(hitNode || null);
  };

  const handleMouseUp = () => {
    if (draggedNodeRef.current) {
      draggedNodeRef.current = null;
    }
    isDraggingRef.current = false;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Suppress click navigation if user was dragging (P5-7)
    if (dragDistanceRef.current > 5) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const world = screenToWorld(clickX, clickY);

    const hitNode = simNodesRef.current.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (hitNode && !hitNode.isTagNode) {
      onNavigate(hitNode.path);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const currentScale = transformRef.current.scale;
    const newScale = Math.min(3, Math.max(0.2, currentScale * zoomFactor));

    transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * (newScale / currentScale);
    transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * (newScale / currentScale);
    transformRef.current.scale = newScale;
  };

  const resetView = () => {
    const container = containerRef.current;
    if (!container) return;
    transformRef.current = {
      x: container.clientWidth / 2,
      y: container.clientHeight / 2,
      scale: 1,
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none border border-slate-800/80 rounded-lg"
    >
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 z-10">
        <div className="flex items-center gap-2">
          <Share2 className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold tracking-wide text-slate-200">
            {localMode ? 'Local Graph' : 'Interactive Graph'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            {graphData.nodes.length} nodes · {graphData.edges.length} edges
          </span>
        </div>

        {/* Filter & Options */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Search graph..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-sky-500 w-32 focus:w-44 transition-all"
            />
          </div>

          <button
            onClick={() => setIncludeTags(!includeTags)}
            className={`p-1.5 rounded text-xs flex items-center gap-1 border transition-colors ${
              includeTags
                ? 'bg-purple-950/60 border-purple-600/60 text-purple-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Tag Nodes"
          >
            <Tag className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setHideOrphans(!hideOrphans)}
            className={`p-1.5 rounded text-xs flex items-center gap-1 border transition-colors ${
              hideOrphans
                ? 'bg-sky-950/60 border-sky-600/60 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Hide Unconnected Notes"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>

          {isLocal && (
            <button
              onClick={() => setMaxDepth(maxDepth === 1 ? 2 : 1)}
              className="px-2 py-1 rounded text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
              title="Graph Depth Radius"
            >
              Depth {maxDepth}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative flex-1 w-full h-full">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
          className="w-full h-full cursor-grab active:cursor-grabbing block"
        />

        {/* Zoom Controls Overlay */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded p-1 shadow-lg z-10">
          <button
            onClick={() => {
              transformRef.current.scale = Math.min(3, transformRef.current.scale * 1.2);
            }}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              transformRef.current.scale = Math.max(0.2, transformRef.current.scale * 0.8);
            }}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetView}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
            title="Reset View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Tooltip Overlay */}
        {tooltipNode && (
          <div className="absolute top-3 left-3 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg p-2.5 shadow-xl text-xs z-10 max-w-xs animate-in fade-in duration-150">
            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
              {tooltipNode.isTagNode ? (
                <Tag className="w-3.5 h-3.5 text-purple-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              )}
              {tooltipNode.title}
            </div>
            {!tooltipNode.isTagNode && (
              <div className="text-[11px] text-slate-400 truncate mt-0.5">{tooltipNode.path}</div>
            )}
            <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
              <span>{tooltipNode.val} connections</span>
              {!tooltipNode.isTagNode && tooltipNode.group !== 'root' && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                  {tooltipNode.group}
                </span>
              )}
              {tooltipNode.tags.length > 0 && !tooltipNode.isTagNode && (
                <span className="text-purple-400">#{tooltipNode.tags.join(' #')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
