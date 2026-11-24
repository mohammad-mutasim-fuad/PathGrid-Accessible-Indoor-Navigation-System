import { useEffect, useRef } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { Maximize, Minus, Plus } from 'lucide-react';
import { drawFloor, getRenderScale } from '../mapRenderer';
import { ZoomButton } from '../MapCanvas';
import useFloorPlanImage from '../../hooks/useFloorPlanImage';

const DRAG_THRESHOLD_PX = 5;
const NODE_HIT_PX = 16;
const EDGE_HIT_PX = 8;
const SELECTION_COLOR = '#f59e0b';
const CONNECT_COLOR = '#7c3aed';

/** Distance from point p to segment ab. */
const distanceToSegment = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Finds the node or edge under a logical point, honouring zoom level. */
export const hitTest = (point, nodes, edges, scale) => {
  const nodeRadius = Math.max(10, NODE_HIT_PX / scale);
  let bestNode = null;
  let bestDistance = Infinity;
  nodes.forEach((node) => {
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance <= nodeRadius && distance < bestDistance) {
      bestNode = node;
      bestDistance = distance;
    }
  });
  if (bestNode) return { nodeId: bestNode.id, edge: null };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeRadius = Math.max(6, EDGE_HIT_PX / scale);
  const edge = edges.find((candidate) => {
    const a = nodeById.get(candidate.source);
    const b = nodeById.get(candidate.target);
    return a && b && distanceToSegment(point, a, b) <= edgeRadius;
  });
  return { nodeId: null, edge: edge ?? null };
};

const drawSelectionOverlay = (ctx, { nodes, selection, connectSourceId }) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  if (selection?.kind === 'edge') {
    const a = nodeById.get(selection.source);
    const b = nodeById.get(selection.target);
    if (a && b) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  const ring = (node, color, dashed) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    ctx.arc(node.x, node.y, 19, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  if (selection?.kind === 'node' && nodeById.has(selection.id)) ring(nodeById.get(selection.id), SELECTION_COLOR, false);
  if (connectSourceId && nodeById.has(connectSourceId)) ring(nodeById.get(connectSourceId), CONNECT_COLOR, true);
};

/**
 * Canvas for the topology editor. Reports clicks in logical map coordinates
 * together with whatever node/edge was hit; panning drags are ignored.
 *
 * @param {object} props
 * @param {object[]} props.nodes
 * @param {object[]} props.edges
 * @param {number} props.width
 * @param {number} props.height
 * @param {string} [props.floorPlanImageUrl]
 * @param {{kind:'node',id}|{kind:'edge',source,target}|null} props.selection
 * @param {string|null} props.connectSourceId
 * @param {string} props.cursor - CSS cursor for the active tool
 * @param {(hit: {x, y, nodeId, edge}) => void} props.onCanvasClick
 * @param {string} props.ariaLabel
 */
export default function EditorCanvas({
  nodes, edges, width, height, floorPlanImageUrl = '', selection, connectSourceId,
  cursor = 'default', onCanvasClick, ariaLabel,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const transformRef = useRef(null);
  const pointerDownRef = useRef(null);
  const image = useFloorPlanImage(floorPlanImageUrl);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;
    const scale = getRenderScale();
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawFloor(ctx, {
      width, height, nodes, edges, routeSegments: [], startNodeId: null, targetNodeId: null, image,
    });
    drawSelectionOverlay(ctx, { nodes, selection, connectSourceId });
  }, [width, height, nodes, edges, image, selection, connectSourceId]);

  useEffect(() => {
    const fit = () => transformRef.current?.fitToView?.({ animationTime: 0 });
    fit();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [width, height]);

  const handlePointerDown = (event) => {
    pointerDownRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleClick = (event) => {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD_PX) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = rect.width / width;
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
    onCanvasClick({ ...point, ...hitTest(point, nodes, edges, scale) });
  };

  return (
    <div ref={containerRef} className="relative h-full w-full touch-none overflow-hidden rounded-xl border border-slate-300 bg-slate-200">
      <TransformWrapper
        ref={transformRef}
        minScale={0.2}
        maxScale={8}
        centerOnInit
        centerZoomedOut
        limitToBounds
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.15 }}
        onInit={(ref) => ref.fitToView?.({ animationTime: 0 })}
      >
        {({ zoomIn, zoomOut, fitToView }) => (
          <>
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: `${width}px`, height: `${height}px` }}
            >
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={ariaLabel}
                onPointerDown={handlePointerDown}
                onClick={handleClick}
                style={{
                  width: `${width}px`, height: `${height}px`, display: 'block', cursor,
                }}
                className="bg-white shadow-md"
              />
            </TransformComponent>
            <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-lg">
              <ZoomButton label="Zoom in" onClick={() => zoomIn(0.4)}>
                <Plus aria-hidden="true" className="h-5 w-5" />
              </ZoomButton>
              <div className="h-px bg-slate-200" />
              <ZoomButton label="Zoom out" onClick={() => zoomOut(0.4)}>
                <Minus aria-hidden="true" className="h-5 w-5" />
              </ZoomButton>
              <div className="h-px bg-slate-200" />
              <ZoomButton label="Fit floor to screen" onClick={() => fitToView?.({ animationTime: 200 })}>
                <Maximize aria-hidden="true" className="h-5 w-5" />
              </ZoomButton>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
