import { useEffect, useRef } from 'react';
import { drawEndpointMarker, drawNodeSymbol } from './mapRenderer';
import { MAP_COLORS as C } from './mapStyles';

const SIZE = 44;
const MID = SIZE / 2;

const LINE_STYLES = {
  route: [[C.routeHalo, 14, []], [C.route, 8, []]],
  corridor: [[C.corridor, 7, []]],
  inaccessible: [[C.inaccessible, 4, [3, 7]]],
  closed: [[C.outOfService, 4, [10, 6]]],
};

const NODE_SAMPLES = {
  room: { type: 'room' },
  inaccessibleRoom: { type: 'room', is_accessible: false },
  entrance: { type: 'entrance' },
  restroom: { type: 'restroom' },
  elevator: { type: 'elevator' },
  elevatorOutOfService: { type: 'elevator', out_of_service: true },
  stairs: { type: 'stairs' },
};

const drawSwatch = (ctx, kind) => {
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (LINE_STYLES[kind]) {
    ctx.lineCap = 'round';
    LINE_STYLES[kind].forEach(([color, width, dash]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(6, MID);
      ctx.lineTo(SIZE - 6, MID);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    return;
  }
  if (kind === 'start') {
    drawEndpointMarker(ctx, { x: MID, y: MID }, 'start');
    return;
  }
  if (kind === 'target') {
    drawEndpointMarker(ctx, { x: MID, y: SIZE - 6 }, 'target');
    return;
  }
  if (NODE_SAMPLES[kind]) drawNodeSymbol(ctx, { x: MID, y: MID, ...NODE_SAMPLES[kind] });
};

/**
 * Small canvas showing a map symbol exactly as the map draws it.
 * @param {{ kind: string }} props - a LEGEND_ITEMS key from mapStyles.js
 */
export default function LegendSwatch({ kind }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = SIZE * scale;
    canvas.height = SIZE * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSwatch(ctx, kind);
  }, [kind]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: `${SIZE}px`, height: `${SIZE}px` }}
      className="shrink-0 rounded-lg border border-slate-200"
    />
  );
}
