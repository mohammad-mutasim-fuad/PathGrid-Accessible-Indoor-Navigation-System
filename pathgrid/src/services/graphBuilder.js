/**
 * Pure helpers that turn per-floor Firestore documents into the single
 * multi-floor graph consumed by aStarEngine.js (PRD Section 4.2).
 *
 * Each floor document stores its own packed `graph_topology`. Elevators and
 * stairs that span several levels share a `transition_id` (e.g. "ELEV_1");
 * vertical edges between consecutive floors are generated here so they never
 * have to be duplicated across documents.
 */

export const DEFAULT_TRANSITION_WEIGHTS = Object.freeze({
  elevator: 10,
  stairs: 15,
});

/** Highest floor number firestore.rules accepts (floor_number / total_floors <= 200). */
export const MAX_FLOOR_NUMBER = 200;

/**
 * The floor that "Add floor" creates: one above the highest existing floor,
 * or 1 for a building without floors. Throws past MAX_FLOOR_NUMBER.
 * @param {number[]} floorNumbers - existing floor numbers (any order)
 */
export const getNextFloorNumber = (floorNumbers) => {
  const existing = (floorNumbers ?? []).filter((n) => Number.isInteger(n));
  const next = existing.length === 0 ? 1 : Math.max(...existing) + 1;
  if (next > MAX_FLOOR_NUMBER) {
    throw new RangeError(`A building can have at most ${MAX_FLOOR_NUMBER} floors.`);
  }
  return next;
};

/** Firestore document id for a floor, e.g. ("ENG_MAIN", 1) -> "ENG_MAIN_FL01". */
export const floorDocId = (buildingId, floorNumber) => {
  if (!buildingId || typeof buildingId !== 'string') {
    throw new TypeError('buildingId must be a non-empty string.');
  }
  if (!Number.isInteger(floorNumber) || floorNumber < 0) {
    throw new TypeError('floorNumber must be a non-negative integer.');
  }
  return `${buildingId}_FL${String(floorNumber).padStart(2, '0')}`;
};

/**
 * Validates a single floor's graph_topology.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateTopology = (topology) => {
  const errors = [];

  if (!topology || !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)) {
    return { valid: false, errors: ['graph_topology must contain "nodes" and "edges" arrays.'] };
  }

  const ids = new Set();
  topology.nodes.forEach((node, index) => {
    const label = `nodes[${index}]`;
    if (!node || typeof node.id !== 'string' || node.id === '') {
      errors.push(`${label} must have a non-empty string "id".`);
      return;
    }
    if (ids.has(node.id)) errors.push(`Duplicate node id "${node.id}".`);
    ids.add(node.id);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      errors.push(`Node "${node.id}" must have numeric "x" and "y" coordinates.`);
    }
    if (typeof node.type !== 'string' || node.type === '') {
      errors.push(`Node "${node.id}" must have a "type".`);
    }
    if ((node.type === 'elevator' || node.type === 'stairs') && !node.transition_id) {
      errors.push(`Node "${node.id}" (${node.type}) needs a "transition_id" to link floors.`);
    }
  });

  topology.edges.forEach((edge, index) => {
    const label = `edges[${index}]`;
    if (!edge || !ids.has(edge.source)) errors.push(`${label} has unknown source "${edge?.source}".`);
    if (!edge || !ids.has(edge.target)) errors.push(`${label} has unknown target "${edge?.target}".`);
    if (edge && edge.source === edge.target) errors.push(`${label} is a self-loop on "${edge.source}".`);
    if (edge && edge.weight !== undefined && (!Number.isFinite(edge.weight) || edge.weight < 0)) {
      errors.push(`${label} weight must be a non-negative number.`);
    }
  });

  return { valid: errors.length === 0, errors };
};

/**
 * Merges floor documents into one graph for aStarEngine.
 *
 * - Every node gets a `floor` field taken from its document's floor_number.
 * - Node ids must be unique across the whole building.
 * - Consecutive floors are linked through nodes sharing a `transition_id`.
 *   Vertical stairs edges are inaccessible; elevator edges inherit the
 *   accessibility of their endpoints. Out-of-service elevators stay on the
 *   node, where aStarEngine treats them as impassable.
 *
 * @param {object[]} floorDocs - documents from the `floors` collection
 * @param {{ elevator?: number, stairs?: number }} [transitionWeights]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export const buildBuildingGraph = (floorDocs, transitionWeights = {}) => {
  if (!Array.isArray(floorDocs)) throw new TypeError('floorDocs must be an array.');

  const weights = { ...DEFAULT_TRANSITION_WEIGHTS, ...transitionWeights };
  const sortedFloors = [...floorDocs].sort((a, b) => a.floor_number - b.floor_number);

  const nodes = [];
  const edges = [];
  const seenIds = new Set();
  const transitions = new Map();

  sortedFloors.forEach((floorDoc) => {
    const topology = floorDoc.graph_topology ?? { nodes: [], edges: [] };

    topology.nodes.forEach((rawNode) => {
      if (seenIds.has(rawNode.id)) {
        throw new Error(
          `Node id "${rawNode.id}" appears on more than one floor; ids must be unique per building.`,
        );
      }
      seenIds.add(rawNode.id);
      const node = { ...rawNode, floor: floorDoc.floor_number };
      nodes.push(node);

      if (node.transition_id) {
        if (!transitions.has(node.transition_id)) transitions.set(node.transition_id, []);
        transitions.get(node.transition_id).push(node);
      }
    });

    topology.edges.forEach((edge) => edges.push({ ...edge }));
  });

  transitions.forEach((group, transitionId) => {
    for (let i = 0; i < group.length - 1; i += 1) {
      const lower = group[i];
      const upper = group[i + 1];
      if (lower.floor === upper.floor) {
        throw new Error(`transition_id "${transitionId}" is used twice on floor ${lower.floor}.`);
      }
      const type = lower.type === 'stairs' || upper.type === 'stairs' ? 'stairs' : lower.type;
      const perFloor = weights[type] ?? weights.stairs;
      edges.push({
        source: lower.id,
        target: upper.id,
        weight: perFloor * Math.abs(upper.floor - lower.floor),
        type,
        is_accessible:
          type !== 'stairs' && lower.is_accessible !== false && upper.is_accessible !== false,
        transition_id: transitionId,
      });
    }
  });

  return { nodes, edges };
};
