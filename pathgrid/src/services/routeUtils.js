/**
 * Pure helpers that adapt graph/route data for the public navigation UI.
 * Kept separate from React components so the logic is unit-testable.
 */

/** Node types a visitor can pick as a start point or destination. */
export const SELECTABLE_NODE_TYPES = Object.freeze(['entrance', 'room', 'restroom']);

const DEFAULT_CANVAS_PADDING = 60;

/**
 * Locations for the Start/Destination selectors, sorted by floor then name.
 * @param {{nodes: object[]}} graph - merged building graph (nodes carry `floor`)
 */
export const getSelectableLocations = (graph) => {
  if (!graph || !Array.isArray(graph.nodes)) return [];
  return graph.nodes
    .filter((node) => SELECTABLE_NODE_TYPES.includes(node.type))
    .map(({ id, name, floor, type, is_accessible: isAccessible }) => ({
      id,
      name: name ?? id,
      floor,
      type,
      isAccessible: isAccessible !== false,
    }))
    .sort((a, b) => (a.floor - b.floor) || a.name.localeCompare(b.name));
};

/** Groups locations by floor: [{ floor, locations: [...] }] in ascending order. */
export const groupLocationsByFloor = (locations) => {
  const groups = new Map();
  locations.forEach((location) => {
    if (!groups.has(location.floor)) groups.set(location.floor, []);
    groups.get(location.floor).push(location);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([floor, items]) => ({ floor, locations: items }));
};

/**
 * Reads QR-code query parameters (PRD 5.1). Accepts both `start` and the
 * PRD's `startNode` spelling.
 * @param {string | URLSearchParams} search
 * @returns {{ buildingId: string|null, floor: number|null, startNodeId: string|null }}
 */
export const parseQrParams = (search) => {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? '');
  const clean = (value) => {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : trimmed;
  };
  const floorValue = Number.parseInt(params.get('floor') ?? '', 10);
  return {
    buildingId: clean(params.get('building')),
    floor: Number.isInteger(floorValue) ? floorValue : null,
    startNodeId: clean(params.get('start')) ?? clean(params.get('startNode')),
  };
};

/** Fast id -> node lookup. */
export const indexNodes = (graph) => new Map((graph?.nodes ?? []).map((node) => [node.id, node]));

/** Floors visited by a route, in travel order, without repeats in a row. */
export const getRouteFloors = (path) => {
  const floors = [];
  (path ?? []).forEach((node) => {
    if (floors[floors.length - 1] !== node.floor) floors.push(node.floor);
  });
  return floors;
};

/**
 * The floor the route continues on after `activeFloor`, or null when the
 * route ends on (or never visits) the active floor. Used for the PRD 4.2
 * "Switch to Floor X" prompt.
 */
export const getNextRouteFloor = (path, activeFloor) => {
  const floors = getRouteFloors(path);
  const index = floors.lastIndexOf(activeFloor);
  if (index === -1 || index === floors.length - 1) return null;
  return floors[index + 1];
};

/** Consecutive path node pairs that both lie on `floor` (drawable segments). */
export const getPathSegmentsForFloor = (path, floor) => {
  const segments = [];
  for (let i = 0; i < (path?.length ?? 0) - 1; i += 1) {
    if (path[i].floor === floor && path[i + 1].floor === floor) {
      segments.push([path[i], path[i + 1]]);
    }
  }
  return segments;
};

/** Nodes and edges that belong to a single floor of the merged graph. */
export const getFloorGraph = (graph, floor) => {
  const nodes = (graph?.nodes ?? []).filter((node) => node.floor === floor);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (graph?.edges ?? []).filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges };
};

/**
 * Logical canvas size. Prefers building metadata (canvas_width/height) and
 * otherwise fits all node coordinates with padding.
 */
export const getCanvasSize = (building, nodes) => {
  if (Number.isFinite(building?.canvas_width) && Number.isFinite(building?.canvas_height)) {
    return { width: building.canvas_width, height: building.canvas_height };
  }
  const xs = (nodes ?? []).map((node) => node.x);
  const ys = (nodes ?? []).map((node) => node.y);
  if (xs.length === 0) return { width: 1000, height: 600 };
  return {
    width: Math.ceil(Math.max(...xs) + DEFAULT_CANVAS_PADDING),
    height: Math.ceil(Math.max(...ys) + DEFAULT_CANVAS_PADDING),
  };
};

/** "42 m" style label; weights are metres in PathGrid data. */
export const formatDistance = (distance) => {
  if (!Number.isFinite(distance)) return '—';
  return `${Math.round(distance)} m`;
};

/** Identity of a route, used to detect when a facility change altered it. */
export const routeSignature = (result) =>
  (result?.found ? result.path.map((node) => node.id).join('>') : '');

/**
 * User-facing explanation for a failed route.
 */
export const describeRouteFailure = (result, { isWheelchairMode, startNode, targetNode }) => {
  if (!result || result.found) return '';
  const startName = startNode?.name ?? 'the start point';
  const targetName = targetNode?.name ?? 'the destination';

  if (isWheelchairMode && targetNode?.is_accessible === false) {
    return `${targetName} is not step-free accessible.`;
  }
  if (isWheelchairMode && startNode?.is_accessible === false) {
    return `${startName} is not step-free accessible. Choose a different start point.`;
  }
  if (isWheelchairMode) {
    return `No step-free route from ${startName} to ${targetName} right now. `
      + 'An elevator or corridor on the way may be out of service.';
  }
  return `No route from ${startName} to ${targetName} right now. Part of the route may be closed.`;
};
