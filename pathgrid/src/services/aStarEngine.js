/**
 * PathGrid A* pathfinding engine (PRD Section 4).
 *
 * Pure, dependency-free ES6+ module. It runs entirely on the client and never
 * touches the network, so routing keeps working offline.
 *
 * Graph shape (matches Firestore `graph_topology`):
 *   nodes: [{ id, name, x, y, type, is_accessible, out_of_service?, floor? }]
 *   edges: [{ source, target, weight?, type, is_accessible, out_of_service?, directed? }]
 *
 * Edges are bidirectional unless `directed: true`. A missing `weight` falls
 * back to the Euclidean distance between the two endpoints.
 */

const STRAIGHT_THRESHOLD_DEG = 30;
const U_TURN_THRESHOLD_DEG = 150;

/* ------------------------------------------------------------------------- */
/* Min-heap priority queue                                                    */
/* ------------------------------------------------------------------------- */

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value, priority) {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  sinkDown(index) {
    let i = index;
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (right < n && this.items[right].priority < this.items[smallest].priority) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
      i = smallest;
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Graph preparation                                                          */
/* ------------------------------------------------------------------------- */

const euclidean = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const getFloor = (node) => node.floor ?? node.floor_number ?? null;

const isOutOfServiceElevator = (node) =>
  node.type === 'elevator' && node.out_of_service === true;

/**
 * Returns true when a node or edge must be removed for wheelchair users.
 */
const isInaccessible = (item) => item.type === 'stairs' || item.is_accessible === false;

/**
 * Prunes the raw graph according to the routing mode.
 *
 * - Out-of-service elevators and out-of-service edges are impassable
 *   (infinite weight) in every mode, since a broken elevator is broken for
 *   everyone.
 * - Wheelchair mode additionally removes every node/edge whose
 *   `type === 'stairs'` or `is_accessible === false`.
 * - Any edge that touches a removed node is dropped as well.
 */
export const filterGraph = (graphData, isWheelchairModeActive = false) => {
  const nodes = graphData.nodes.filter((node) => {
    if (isOutOfServiceElevator(node)) return false;
    if (isWheelchairModeActive && isInaccessible(node)) return false;
    return true;
  });

  const allowedIds = new Set(nodes.map((node) => node.id));

  const edges = graphData.edges.filter((edge) => {
    if (!allowedIds.has(edge.source) || !allowedIds.has(edge.target)) return false;
    if (edge.out_of_service === true) return false;
    if (isWheelchairModeActive && isInaccessible(edge)) return false;
    return true;
  });

  return { nodes, edges };
};

/**
 * Builds an adjacency map: nodeId -> Map(neighbourId -> cheapest weight).
 */
const buildAdjacency = (nodes, edges, nodeById) => {
  const adjacency = new Map(nodes.map((node) => [node.id, new Map()]));

  const addArc = (from, to, weight) => {
    const neighbours = adjacency.get(from);
    const existing = neighbours.get(to);
    if (existing === undefined || weight < existing) neighbours.set(to, weight);
  };

  edges.forEach((edge) => {
    const weight = Number.isFinite(edge.weight)
      ? edge.weight
      : euclidean(nodeById.get(edge.source), nodeById.get(edge.target));
    if (weight < 0) {
      throw new RangeError(`Edge ${edge.source}->${edge.target} has a negative weight.`);
    }
    addArc(edge.source, edge.target, weight);
    if (!edge.directed) addArc(edge.target, edge.source, weight);
  });

  return adjacency;
};

/**
 * Edge weights are not guaranteed to be in pixel units (e.g. PRD sample edge
 * N101->N102 spans 80px but weighs 15). To keep the Euclidean heuristic
 * admissible and consistent we scale it by the smallest weight/distance ratio
 * found across all usable edges.
 */
const computeHeuristicScale = (adjacency, nodeById) => {
  let scale = Infinity;
  adjacency.forEach((neighbours, fromId) => {
    const from = nodeById.get(fromId);
    neighbours.forEach((weight, toId) => {
      const to = nodeById.get(toId);
      // Vertical transitions (same x/y, different floors) carry no planar
      // distance and therefore don't constrain the scale.
      const distance = euclidean(from, to);
      if (distance > 0) scale = Math.min(scale, weight / distance);
    });
  });
  return Number.isFinite(scale) ? scale : 0;
};

/* ------------------------------------------------------------------------- */
/* Turn-by-turn directions                                                    */
/* ------------------------------------------------------------------------- */

const labelOf = (node) => node.name ?? node.id;

/**
 * Signed turn angle in degrees between two heading vectors in canvas
 * coordinates (y grows downward). Positive = right turn, negative = left.
 */
const turnAngle = (from, via, to) => {
  const v1x = via.x - from.x;
  const v1y = via.y - from.y;
  const v2x = to.x - via.x;
  const v2y = to.y - via.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
};

const classifyTurn = (angle) => {
  const magnitude = Math.abs(angle);
  if (magnitude <= STRAIGHT_THRESHOLD_DEG) return 'straight';
  if (magnitude >= U_TURN_THRESHOLD_DEG) return 'u-turn';
  return angle > 0 ? 'right' : 'left';
};

const TURN_TEXT = {
  straight: (to) => `Continue straight to ${to}`,
  left: (to) => `Turn left toward ${to}`,
  right: (to) => `Turn right toward ${to}`,
  'u-turn': (to) => `Turn around toward ${to}`,
};

/**
 * Converts an ordered node path into human-readable navigation steps.
 * Each step describes the move from `fromNodeId` to `toNodeId`; the final
 * step is an `arrive` marker.
 */
export const buildDirections = (path, adjacency) => {
  if (path.length === 0) return [];

  const steps = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const distance = adjacency.get(from.id).get(to.id);
    const prev = i > 0 ? path[i - 1] : null;
    const floorChange = getFloor(from) !== getFloor(to);
    const prevOnSameFloor = prev !== null && getFloor(prev) === getFloor(from);

    let maneuver;
    let instruction;

    if (floorChange) {
      maneuver = 'change-floor';
      instruction = `Take ${labelOf(from)} to floor ${getFloor(to)}`;
    } else if (prev === null) {
      maneuver = 'depart';
      instruction = `Start at ${labelOf(from)} and head toward ${labelOf(to)}`;
    } else if (!prevOnSameFloor || euclidean(prev, from) === 0 || euclidean(from, to) === 0) {
      // Just arrived on a new floor (or degenerate geometry): no prior heading.
      maneuver = 'continue';
      instruction = `Head toward ${labelOf(to)}`;
    } else {
      maneuver = classifyTurn(turnAngle(prev, from, to));
      instruction = TURN_TEXT[maneuver](labelOf(to));
    }

    steps.push({ maneuver, instruction, fromNodeId: from.id, toNodeId: to.id, distance });
  }

  const destination = path[path.length - 1];
  steps.push({
    maneuver: 'arrive',
    instruction: `Arrive at ${labelOf(destination)}`,
    fromNodeId: destination.id,
    toNodeId: destination.id,
    distance: 0,
  });

  return steps;
};

/* ------------------------------------------------------------------------- */
/* Public API                                                                 */
/* ------------------------------------------------------------------------- */

const notFound = (reason) => ({
  found: false,
  path: [],
  totalDistance: Infinity,
  directions: [],
  reason,
});

/**
 * Finds the cheapest route between two nodes using A*.
 *
 * @param {{nodes: object[], edges: object[]}} graphData - graph topology
 * @param {string} startNodeId
 * @param {string} targetNodeId
 * @param {boolean} [isWheelchairModeActive=false]
 * @returns {{
 *   found: boolean,
 *   path: object[],          // ordered node objects, start -> target
 *   totalDistance: number,   // sum of edge weights (Infinity when not found)
 *   directions: object[],    // { maneuver, instruction, fromNodeId, toNodeId, distance }
 *   reason?: string          // why no route exists, when found === false
 * }}
 */
export const findShortestPath = (
  graphData,
  startNodeId,
  targetNodeId,
  isWheelchairModeActive = false,
) => {
  if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
    throw new TypeError('graphData must be an object with "nodes" and "edges" arrays.');
  }

  const rawIds = new Set(graphData.nodes.map((node) => node.id));
  if (!rawIds.has(startNodeId)) return notFound(`Start node "${startNodeId}" does not exist.`);
  if (!rawIds.has(targetNodeId)) return notFound(`Target node "${targetNodeId}" does not exist.`);

  const { nodes, edges } = filterGraph(graphData, isWheelchairModeActive);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  if (!nodeById.has(startNodeId)) {
    return notFound(`Start node "${startNodeId}" is unavailable in the current routing mode.`);
  }
  if (!nodeById.has(targetNodeId)) {
    return notFound(`Target node "${targetNodeId}" is unavailable in the current routing mode.`);
  }

  const adjacency = buildAdjacency(nodes, edges, nodeById);
  const target = nodeById.get(targetNodeId);
  const scale = computeHeuristicScale(adjacency, nodeById);
  const heuristic = (node) => scale * euclidean(node, target);

  const gScore = new Map([[startNodeId, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push(startNodeId, heuristic(nodeById.get(startNodeId)));

  while (open.size > 0) {
    const { value: currentId } = open.pop();
    if (closed.has(currentId)) continue;

    if (currentId === targetNodeId) {
      const path = [];
      for (let id = targetNodeId; id !== undefined; id = cameFrom.get(id)) {
        path.unshift(nodeById.get(id));
      }
      return {
        found: true,
        path,
        totalDistance: gScore.get(targetNodeId),
        directions: buildDirections(path, adjacency),
      };
    }

    closed.add(currentId);
    const currentG = gScore.get(currentId);

    adjacency.get(currentId).forEach((weight, neighbourId) => {
      if (closed.has(neighbourId)) return;
      const tentative = currentG + weight;
      const known = gScore.get(neighbourId);
      if (known === undefined || tentative < known) {
        gScore.set(neighbourId, tentative);
        cameFrom.set(neighbourId, currentId);
        open.push(neighbourId, tentative + heuristic(nodeById.get(neighbourId)));
      }
    });
  }

  return notFound('No route exists between the selected locations.');
};

export default findShortestPath;
