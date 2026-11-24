import { useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { Maximize, Minus, Plus } from 'lucide-react';
import { drawFloor, isOutOfServiceElevator } from './mapRenderer';
import { getPathSegmentsForFloor } from '../services/routeUtils';

/** Extra resolution so the map stays crisp when zoomed in, capped for memory. */
const getRenderScale = () => {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return Math.min(dpr * 2, 3);
};

const useFloorPlanImage = (url) => {
  const [image, setImage] = useState(null);
  useEffect(() => {
    setImage(null);
    if (!url) return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (!cancelled) setImage(img); };
    img.onerror = () => { if (!cancelled) setImage(null); };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);
  return image;
};

const ZoomButton = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="flex h-12 w-12 items-center justify-center text-slate-800 transition hover:bg-slate-100 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-blue-700 active:bg-slate-200"
  >
    {children}
  </button>
);

/**
 * Pannable, pinch-zoomable canvas rendering one floor of the building.
 *
 * @param {object} props
 * @param {number} props.floor - floor number being displayed
 * @param {object[]} props.nodes - nodes on this floor
 * @param {object[]} props.edges - edges between nodes on this floor
 * @param {object[]} [props.routePath] - full multi-floor path from findShortestPath()
 * @param {string} [props.startNodeId]
 * @param {string} [props.targetNodeId]
 * @param {number} props.width - logical map width (node coordinate space)
 * @param {number} props.height - logical map height
 * @param {string} [props.floorPlanImageUrl] - optional blueprint drawn beneath the graph
 */
export default function MapCanvas({
  floor,
  nodes,
  edges,
  routePath = [],
  startNodeId = null,
  targetNodeId = null,
  width,
  height,
  floorPlanImageUrl = '',
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const transformRef = useRef(null);
  const image = useFloorPlanImage(floorPlanImageUrl);

  const routeSegments = useMemo(() => getPathSegmentsForFloor(routePath, floor), [routePath, floor]);

  // Draw whenever the scene changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;
    const scale = getRenderScale();
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawFloor(ctx, {
      width, height, nodes, edges, routeSegments, startNodeId, targetNodeId, image,
    });
  }, [width, height, nodes, edges, routeSegments, startNodeId, targetNodeId, image]);

  // Fit the whole floor into view on floor change and when the viewport resizes.
  useEffect(() => {
    const fit = () => transformRef.current?.fitToView?.({ animationTime: 150 });
    fit();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [floor, width, height]);

  const outOfServiceCount = nodes.filter(isOutOfServiceElevator).length;
  const ariaLabel = [
    `Map of floor ${floor}.`,
    routeSegments.length > 0 ? 'Your route is highlighted in blue.' : 'No route shown on this floor.',
    outOfServiceCount > 0
      ? `${outOfServiceCount} elevator${outOfServiceCount > 1 ? 's are' : ' is'} out of service on this floor.`
      : '',
    'Step-by-step directions are listed in the route panel.',
  ].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className="absolute inset-0 touch-none bg-slate-200">
      <TransformWrapper
        ref={transformRef}
        minScale={0.2}
        maxScale={6}
        centerOnInit
        centerZoomedOut
        limitToBounds
        doubleClick={{ mode: 'zoomIn', step: 0.7 }}
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
                style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
                className="rounded-lg shadow-md"
              />
            </TransformComponent>

            <div className="absolute left-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-lg">
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
