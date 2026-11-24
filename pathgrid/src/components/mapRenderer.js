/**
 * Imperative HTML5 Canvas drawing for one floor of the indoor map.
 * Coordinates are logical map units (same as node x/y); the caller applies
 * any device-pixel scaling to the context before calling drawFloor().
 */
import { MAP_COLORS as C } from './mapStyles';

const GRID_SPACING = 50;
const LABEL_FONT = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GLYPH_FONT = '700 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LABELLED_TYPES = new Set(['room', 'restroom', 'entrance', 'elevator', 'stairs']);

/** Extra canvas resolution so maps stay crisp when zoomed in, capped for memory. */
export const getRenderScale = () => {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return Math.min(dpr * 2, 3);
};

export const isOutOfServiceElevator = (node) =>
  node?.type === 'elevator' && node.out_of_service === true;

const roundedRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const drawBackground = (ctx, width, height, image) => {
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, width, height);
  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
};

/** Visual status of an edge: 'closed' | 'inaccessible' | 'open'. */
export const edgeStatus = (edge, nodeById) => {
  const a = nodeById.get(edge.source);
  const b = nodeById.get(edge.target);
  if (edge.out_of_service === true || isOutOfServiceElevator(a) || isOutOfServiceElevator(b)) {
    return 'closed';
  }
  if (edge.type === 'stairs' || edge.is_accessible === false) return 'inaccessible';
  return 'open';
};

const EDGE_STYLES = {
  open: { color: C.corridor, width: 7, dash: [] },
  inaccessible: { color: C.inaccessible, width: 4, dash: [3, 7] },
  closed: { color: C.outOfService, width: 4, dash: [10, 6] },
};

const drawEdges = (ctx, edges, nodeById) => {
  ctx.lineCap = 'round';
  edges.forEach((edge) => {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) return;
    const style = EDGE_STYLES[edgeStatus(edge, nodeById)];
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
};

const drawArrowhead = (ctx, a, b) => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 40) return;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(angle);
  ctx.fillStyle = C.routeHalo;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-4, -4.5);
  ctx.lineTo(-4, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawRoute = (ctx, segments) => {
  if (segments.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  [[C.routeHalo, 14], [C.route, 8]].forEach(([color, width]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    segments.forEach(([a, b]) => {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();
  });
  segments.forEach(([a, b]) => drawArrowhead(ctx, a, b));
};

const drawGlyphText = (ctx, text, x, y) => {
  ctx.fillStyle = C.glyph;
  ctx.font = GLYPH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
};

const drawStairsGlyph = (ctx, x, y) => {
  ctx.strokeStyle = C.glyph;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 5);
  ctx.lineTo(x - 2, y + 5);
  ctx.lineTo(x - 2, y + 1);
  ctx.lineTo(x + 2, y + 1);
  ctx.lineTo(x + 2, y - 3);
  ctx.lineTo(x + 6, y - 3);
  ctx.lineTo(x + 6, y - 6);
  ctx.stroke();
};

const drawElevatorGlyph = (ctx, x, y) => {
  ctx.fillStyle = C.glyph;
  ctx.beginPath();
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x - 4.5, y - 1.5);
  ctx.lineTo(x + 4.5, y - 1.5);
  ctx.closePath();
  ctx.moveTo(x, y + 7);
  ctx.lineTo(x - 4.5, y + 1.5);
  ctx.lineTo(x + 4.5, y + 1.5);
  ctx.closePath();
  ctx.fill();
};

/** Draws a single node symbol centred at (node.x, node.y). Exported for the legend. */
export const drawNodeSymbol = (ctx, node) => {
  const { x, y } = node;
  ctx.setLineDash([]);

  switch (node.type) {
    case 'corridor': {
      ctx.fillStyle = C.corridorNode;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'stairs': {
      roundedRect(ctx, x - 11, y - 11, 22, 22, 4);
      ctx.fillStyle = C.stairs;
      ctx.fill();
      drawStairsGlyph(ctx, x, y);
      return;
    }
    case 'elevator': {
      const broken = isOutOfServiceElevator(node);
      roundedRect(ctx, x - 11, y - 11, 22, 22, 4);
      ctx.fillStyle = broken ? C.elevatorDisabled : C.elevator;
      ctx.fill();
      drawElevatorGlyph(ctx, x, y);
      if (broken) {
        ctx.strokeStyle = C.outOfService;
        ctx.lineWidth = 3;
        roundedRect(ctx, x - 13, y - 13, 26, 26, 5);
        ctx.stroke();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - 13, y - 13);
        ctx.lineTo(x + 13, y + 13);
        ctx.moveTo(x + 13, y - 13);
        ctx.lineTo(x - 13, y + 13);
        ctx.stroke();
      }
      return;
    }
    case 'entrance': {
      roundedRect(ctx, x - 11, y - 11, 22, 22, 11);
      ctx.fillStyle = node.is_accessible === false ? C.inaccessible : C.entrance;
      ctx.fill();
      drawGlyphText(ctx, 'IN', x, y);
      return;
    }
    case 'restroom': {
      ctx.fillStyle = C.restroom;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      drawGlyphText(ctx, 'WC', x, y);
      return;
    }
    default: {
      const accessible = node.is_accessible !== false;
      ctx.fillStyle = accessible ? C.room : C.inaccessibleRoomFill;
      ctx.strokeStyle = accessible ? C.roomStroke : C.inaccessible;
      ctx.lineWidth = 2.5;
      if (!accessible) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
};

const LABEL_EDGE_MARGIN = 6;

const drawLabel = (ctx, node, canvasWidth, canvasHeight, hasPin = false) => {
  const text = isOutOfServiceElevator(node) ? `${node.name} - OUT OF SERVICE` : node.name;
  if (!text) return;
  const above = node.y < canvasHeight / 2;
  // A destination pin rises ~36 units above its node; lift the label clear of it.
  const ty = above ? node.y - (hasPin ? 40 : 20) : node.y + 20;
  ctx.font = LABEL_FONT;
  // Keep the whole label inside the canvas so edge nodes aren't clipped.
  const half = ctx.measureText(text).width / 2;
  const tx = Math.min(
    Math.max(node.x, half + LABEL_EDGE_MARGIN),
    canvasWidth - half - LABEL_EDGE_MARGIN,
  );
  ctx.textAlign = 'center';
  ctx.textBaseline = above ? 'bottom' : 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.labelHalo;
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = isOutOfServiceElevator(node) ? C.outOfService : C.label;
  ctx.fillText(text, tx, ty);
};

/** Start marker (ring) or destination marker (pin). Exported for the legend. */
export const drawEndpointMarker = (ctx, node, kind) => {
  const { x, y } = node;
  ctx.setLineDash([]);
  if (kind === 'start') {
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.routeHalo;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.start;
    ctx.stroke();
    ctx.fillStyle = C.start;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Destination pin: tip rests on the node.
  ctx.fillStyle = C.target;
  ctx.strokeStyle = C.routeHalo;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - 4, y - 8, x - 12, y - 14, x - 12, y - 22);
  ctx.arc(x, y - 22, 12, Math.PI, 0);
  ctx.bezierCurveTo(x + 12, y - 14, x + 4, y - 8, x, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.routeHalo;
  ctx.beginPath();
  ctx.arc(x, y - 22, 4.5, 0, Math.PI * 2);
  ctx.fill();
};

/**
 * Draws a complete floor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ width, height, nodes, edges, routeSegments, startNodeId, targetNodeId, image }} scene
 */
export const drawFloor = (ctx, scene) => {
  const {
    width, height, nodes, edges, routeSegments, startNodeId, targetNodeId, image,
  } = scene;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  drawBackground(ctx, width, height, image);
  drawEdges(ctx, edges, nodeById);
  drawRoute(ctx, routeSegments);
  nodes.forEach((node) => drawNodeSymbol(ctx, node));
  nodes
    .filter((node) => LABELLED_TYPES.has(node.type))
    .forEach((node) => drawLabel(ctx, node, width, height, node.id === targetNodeId));

  const start = nodeById.get(startNodeId);
  const target = nodeById.get(targetNodeId);
  if (start) drawEndpointMarker(ctx, start, 'start');
  if (target) drawEndpointMarker(ctx, target, 'target');
};
