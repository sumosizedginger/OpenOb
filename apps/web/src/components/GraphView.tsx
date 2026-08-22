import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DocumentIndex, GraphData, GraphEdge, GraphNode, VaultPath } from '@okw/core';
import { buildGraphData } from '@okw/index';
import { Search, ZoomIn, ZoomOut, Maximize2, Filter, Tag, Share2, X, Sparkles } from 'lucide-react';

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
  '#7c6dfa', // periwinkle
  '#10b981', // emerald
  '#38bdf8', // sky
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#8b5cf6', // violet
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

  // Load graph data
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

    void fetchGraph();
    return () => {
      isMounted = false;
    };
  }, [
    index,
    activeNotePath,
    refreshKey,
    includeTags,
    hideOrphans,
    searchQuery,
    localMode,
    maxDepth,
  ]);

  // Handle ResizeObserver for dynamic DPR canvas
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
      const color = node.isTagNode ? '#a855f7' : groupColorMap.get(node.group) || '#7c6dfa';

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

  // Persistent Physics animation loop
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
          ctx.strokeStyle = isHovered
            ? '#7c6dfa'
            : isDimmed
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(255,255,255,0.12)';
          ctx.lineWidth = isHovered ? 2 : 1;
        } else if (edge.kind === 'tag') {
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = isHovered
            ? '#a855f7'
            : isDimmed
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.08)';
          ctx.lineWidth = isHovered ? 1.5 : 0.8;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = isHovered
            ? '#7c6dfa'
            : isDimmed
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(255,255,255,0.14)';
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
          ctx.fillStyle = '#7c6dfa';
          ctx.shadowColor = '#7c6dfa';
          ctx.shadowBlur = 12;
        } else if (node.isTagNode) {
          ctx.fillStyle = isDimmed ? 'rgba(168, 85, 247, 0.2)' : '#a855f7';
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = isDimmed ? `${node.color}30` : node.color;
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
          ctx.font =
            isHovered || isActive
              ? 'bold 12px var(--font-sans, sans-serif)'
              : '11px var(--font-sans, sans-serif)';
          ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.2)' : '#f0f2f5';
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

  // Coordinate helper
  const screenToWorld = (screenX: number, screenY: number) => {
    const { x: panX, y: panY, scale } = transformRef.current;
    return {
      x: (screenX - panX) / scale,
      y: (screenY - panY) / scale,
    };
  };

  // Mouse Handlers
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
      dragStartRef.current = {
        x: clickX - transformRef.current.x,
        y: clickY - transformRef.current.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const world = screenToWorld(clickX, clickY);

    if (draggedNodeRef.current) {
      dragDistanceRef.current +=
        Math.abs(world.x - draggedNodeRef.current.x) + Math.abs(world.y - draggedNodeRef.current.y);
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingRef.current) {
      const newX = clickX - dragStartRef.current.x;
      const newY = clickY - dragStartRef.current.y;
      dragDistanceRef.current +=
        Math.abs(newX - transformRef.current.x) + Math.abs(newY - transformRef.current.y);
      transformRef.current.x = newX;
      transformRef.current.y = newY;
      return;
    }

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
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--surface-canvas)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          backgroundColor: 'var(--surface-sidebar)',
          borderBottom: '1px solid var(--border-subtle)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Share2 size={14} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {localMode ? 'Local Graph' : 'Interactive Graph'}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-canvas)',
              color: 'var(--text-muted)',
            }}
          >
            {graphData.nodes.length} nodes · {graphData.edges.length} edges
          </span>
        </div>

        {/* Filter & Options */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={12}
              style={{ position: 'absolute', left: '8px', top: '7px', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search graph..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: '24px',
                paddingRight: '8px',
                paddingTop: '3px',
                paddingBottom: '3px',
                fontSize: '11px',
                backgroundColor: 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                outline: 'none',
                width: '110px',
              }}
            />
          </div>

          <button
            onClick={() => setIncludeTags(!includeTags)}
            className={`btn-icon ${includeTags ? 'active' : ''}`}
            style={{ width: '24px', height: '24px' }}
            title="Toggle Tag Nodes"
          >
            <Tag size={12} />
          </button>

          <button
            onClick={() => setHideOrphans(!hideOrphans)}
            className={`btn-icon ${hideOrphans ? 'active' : ''}`}
            style={{ width: '24px', height: '24px' }}
            title="Hide Unconnected Notes"
          >
            <Filter size={12} />
          </button>

          {isLocal && (
            <button
              onClick={() => setMaxDepth(maxDepth === 1 ? 2 : 1)}
              className="btn btn-ghost"
              style={{ padding: '2px 6px', fontSize: '11px' }}
              title="Graph Depth Radius"
            >
              Depth {maxDepth}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="btn-icon"
              style={{ width: '24px', height: '24px' }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
          style={{ width: '100%', height: '100%', cursor: 'grab', display: 'block' }}
        />

        {/* Zoom Controls Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '2px',
            boxShadow: 'var(--shadow-md)',
            zIndex: 10,
          }}
        >
          <button
            onClick={() => {
              transformRef.current.scale = Math.min(3, transformRef.current.scale * 1.2);
            }}
            className="btn-icon"
            style={{ width: '24px', height: '24px' }}
            title="Zoom In"
          >
            <ZoomIn size={13} />
          </button>
          <button
            onClick={() => {
              transformRef.current.scale = Math.max(0.2, transformRef.current.scale * 0.8);
            }}
            className="btn-icon"
            style={{ width: '24px', height: '24px' }}
            title="Zoom Out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            onClick={resetView}
            className="btn-icon"
            style={{ width: '24px', height: '24px' }}
            title="Reset View"
          >
            <Maximize2 size={13} />
          </button>
        </div>

        {/* Tooltip Overlay */}
        {tooltipNode && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-lg)',
              padding: '8px 12px',
              boxShadow: 'var(--shadow-lg)',
              fontSize: '12px',
              zIndex: 10,
              maxWidth: '260px',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {tooltipNode.isTagNode ? (
                <Tag size={13} style={{ color: '#a855f7' }} />
              ) : (
                <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} />
              )}
              <span>{tooltipNode.title}</span>
            </div>
            {!tooltipNode.isTagNode && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tooltipNode.path}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '6px',
                paddingTop: '6px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '10px',
                color: 'var(--text-muted)',
              }}
            >
              <span>{tooltipNode.val} connections</span>
              {!tooltipNode.isTagNode && tooltipNode.group !== 'root' && (
                <span
                  style={{
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-sidebar)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {tooltipNode.group}
                </span>
              )}
              {tooltipNode.tags.length > 0 && !tooltipNode.isTagNode && (
                <span style={{ color: 'var(--accent-primary)' }}>
                  #{tooltipNode.tags.join(' #')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
