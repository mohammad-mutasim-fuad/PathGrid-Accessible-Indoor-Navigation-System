/**
 * Pure topology-editing logic for the admin map editor and admin data layer.
 * No React, no Firebase: every function returns new objects and never
 * mutates its input.
 */
import {
  buildBuildingGraph, isVerticalNode, transitionGroupKey, validateTopology,
} from './graphBuilder';

export const NODE_TYPES = Object.freeze(['room', 'corridor', 'entrance', 'restroom', 'elevator', 'stairs']);
export const EDGE_TYPES = Object.freeze(['corridor', 'ramp', 'stairs', 'elevator']);
export const TRANSITION_TYPES = Object.freeze(['elevator', 'stairs']);

const HISTORY_LIMIT = 50;
const DEFAULT_UNITS_PER_METER = 10;

const ID_CODES = {
  room: 'ROOM',
  corridor: 'HALL',
  entrance: 'ENTR',
  restroom: 'WC',
  elevator: 'ELEV',
  stairs: 'STAIRS',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------------- */
/* Identity helpers                                                           */
/* ------------------------------------------------------------------------- */

export const edgeKey = (edge) => `${edge.source}->${edge.target}`;

/** True when `edge` connects a and b in either direction. */
export const connects = (edge, a, b) =>
  (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);

/**
 * Next free node id such as "F2_ROOM_3". `takenIds` must contain ids from
 * every floor, because ids are unique per building.
 */
export const nextNodeId = (floorNumber, type, takenIds) => {
  const prefix = `F${floorNumber}_${ID_CODES[type] ?? 'NODE'}_`;
  let n = 1;
  while (takenIds.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};

/** Next free transition id such as "ELEV_3" or "STAIRS_2". */
export const nextTransitionId = (type, takenTransitionIds) => {
  const prefix = type === 'stairs' ? 'STAIRS_' : 'ELEV_';
  let n = 1;
  while (takenTransitionIds.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};

/** Edge weight in metres from node coordinates, rounded to 0.1 m. */
export const computeEdgeWeight = (a, b, unitsPerMeter = DEFAULT_UNITS_PER_METER) => {
  const scale = unitsPerMeter > 0 ? unitsPerMeter : DEFAULT_UNITS_PER_METER;
  return Math.round((Math.hypot(a.x - b.x, a.y - b.y) / scale) * 10) / 10;
};

/* ------------------------------------------------------------------------- */
/* Node construction                                                          */
/* ------------------------------------------------------------------------- */

const TYPE_LABELS = {
  room: 'New room',
  corridor: 'Corridor point',
  entrance: 'New entrance',
  restroom: 'Restroom',
  elevator: 'New elevator',
  stairs: 'New staircase',
};

/**
 * Property changes needed when a node becomes `type`. Keys set to undefined
 * are removed by the reducer.
 *
 * @param {object} node - current node (may be empty for a brand new node)
 * @param {string} type
 * @param {{ transitionId?: string }} [options] - id to use if one is needed
 */
export const typeChangeDefaults = (node, type, { transitionId } = {}) => {
  const changes = { type };
  if (type === 'stairs') {
    changes.is_accessible = false;
    changes.transition_id = node.type === 'stairs' && node.transition_id ? node.transition_id : transitionId;
    changes.out_of_service = undefined;
  } else if (type === 'elevator') {
    changes.is_accessible = true;
    changes.transition_id = node.type === 'elevator' && node.transition_id ? node.transition_id : transitionId;
    changes.out_of_service = node.out_of_service === true;
  } else {
    changes.transition_id = undefined;
    changes.out_of_service = undefined;
    if (node.type === 'stairs' || node.is_accessible === undefined) changes.is_accessible = true;
  }
  return changes;
};

/** Builds a new node with sensible defaults for its type. */
export const createNode = ({ id, type, x, y, name, transitionId }) => {
  const base = { id, name: name ?? TYPE_LABELS[type] ?? 'New node', x: Math.round(x), y: Math.round(y) };
  const node = { ...base, ...typeChangeDefaults({}, type, { transitionId }) };
  Object.keys(node).forEach((key) => node[key] === undefined && delete node[key]);
  return node;
};

/** Default edge type/accessibility derived from its endpoints. */
const defaultEdgeProps = (a, b) => {
  if (a.type === 'stairs' || b.type === 'stairs') return { type: 'stairs', is_accessible: false };
  return { type: 'corridor', is_accessible: true };
};

/* ------------------------------------------------------------------------- */
/* Editor reducer (with undo/redo history)                                    */
/* ------------------------------------------------------------------------- */

const emptyTopology = () => ({ nodes: [], edges: [] });

export const initEditorState = (topology) => ({
  topology: clone(topology ?? emptyTopology()),
  past: [],
  future: [],
});

const withoutUndefined = (object) => {
  const result = { ...object };
  Object.keys(result).forEach((key) => result[key] === undefined && delete result[key]);
  return result;
};

/** Applies a topology transformation; returns null for a no-op. */
const transform = (topology, action) => {
  const { nodes, edges } = topology;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  switch (action.type) {
    case 'addNode': {
      if (!action.node?.id || nodeById.has(action.node.id)) return null;
      return { nodes: [...nodes, action.node], edges };
    }

    case 'updateNode': {
      const current = nodeById.get(action.id);
      if (!current) return null;
      const updated = withoutUndefined({ ...current, ...action.changes, id: current.id });
      if (JSON.stringify(updated) === JSON.stringify(current)) return null;
      const moved = updated.x !== current.x || updated.y !== current.y;
      const nextNodes = nodes.map((node) => (node.id === action.id ? updated : node));
      const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));
      const nextEdges = moved
        ? edges.map((edge) => (edge.source === action.id || edge.target === action.id
          ? {
            ...edge,
            weight: computeEdgeWeight(
              nextNodeById.get(edge.source),
              nextNodeById.get(edge.target),
              action.unitsPerMeter,
            ),
          }
          : edge))
        : edges;
      return { nodes: nextNodes, edges: nextEdges };
    }

    case 'deleteNode': {
      if (!nodeById.has(action.id)) return null;
      return {
        nodes: nodes.filter((node) => node.id !== action.id),
        edges: edges.filter((edge) => edge.source !== action.id && edge.target !== action.id),
      };
    }

    case 'addEdge': {
      const a = nodeById.get(action.source);
      const b = nodeById.get(action.target);
      if (!a || !b || a.id === b.id) return null;
      if (edges.some((edge) => connects(edge, a.id, b.id))) return null;
      const edge = {
        source: a.id,
        target: b.id,
        weight: computeEdgeWeight(a, b, action.unitsPerMeter),
        ...defaultEdgeProps(a, b),
      };
      return { nodes, edges: [...edges, edge] };
    }

    case 'updateEdge': {
      const index = edges.findIndex((edge) => connects(edge, action.source, action.target));
      if (index === -1) return null;
      const updated = withoutUndefined({
        ...edges[index],
        ...action.changes,
        source: edges[index].source,
        target: edges[index].target,
      });
      if (JSON.stringify(updated) === JSON.stringify(edges[index])) return null;
      return { nodes, edges: edges.map((edge, i) => (i === index ? updated : edge)) };
    }

    case 'deleteEdge': {
      const nextEdges = edges.filter((edge) => !connects(edge, action.source, action.target));
      return nextEdges.length === edges.length ? null : { nodes, edges: nextEdges };
    }

    default:
      return null;
  }
};

/**
 * Editor reducer. Actions:
 *   reset {topology}                      – load a floor (clears history)
 *   addNode {node}                        – node from createNode()
 *   updateNode {id, changes, unitsPerMeter} – moving a node re-weights its edges
 *   deleteNode {id}                       – also removes connected edges
 *   addEdge {source, target, unitsPerMeter}
 *   updateEdge {source, target, changes}
 *   deleteEdge {source, target}
 *   undo / redo
 */
export const editorReducer = (state, action) => {
  switch (action.type) {
    case 'reset':
      return initEditorState(action.topology);
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        topology: previous,
        past: state.past.slice(0, -1),
        future: [state.topology, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { topology: next, past: [...state.past, state.topology], future: rest };
    }
    default: {
      const next = transform(state.topology, action);
      if (!next) return state;
      return {
        topology: next,
        past: [...state.past, state.topology].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
  }
};

/* ------------------------------------------------------------------------- */
/* Out-of-service updates (shared by the demo repository)                     */
/* ------------------------------------------------------------------------- */

/**
 * Marks every elevator node matching `key` (transition_id or node id) on all
 * floors. Returns new floor docs and the number of matching nodes.
 */
export const applyElevatorOutOfService = (floors, key, outOfService) => {
  let updated = 0;
  const nextFloors = floors.map((floor) => {
    const topology = floor.graph_topology ?? emptyTopology();
    let changed = false;
    const nodes = topology.nodes.map((node) => {
      if (node.type !== 'elevator' || (node.transition_id !== key && node.id !== key)) return node;
      updated += 1;
      if (node.out_of_service === outOfService) return node;
      changed = true;
      return { ...node, out_of_service: outOfService };
    });
    return changed ? { ...floor, graph_topology: { ...topology, nodes } } : floor;
  });
  return { floors: nextFloors, updated };
};

/** Marks the edge between a and b (either direction). Throws if missing. */
export const applyEdgeOutOfService = (topology, a, b, outOfService) => {
  let found = false;
  const edges = topology.edges.map((edge) => {
    if (!connects(edge, a, b)) return edge;
    found = true;
    return { ...edge, out_of_service: outOfService };
  });
  if (!found) throw new Error(`No edge between "${a}" and "${b}".`);
  return { ...topology, edges };
};

/* ------------------------------------------------------------------------- */
/* Cross-floor (vertical) links                                               */
/* ------------------------------------------------------------------------- */

const nodeLabel = (node) => node?.name ?? node?.id;

/**
 * Applies queued node changes on other floors ([{ floorNumber, nodeId,
 * changes }]) to floor documents. Returns new documents; unaffected floors
 * keep their identity.
 */
export const applyLinkedNodeUpdates = (floors, updates) => {
  if (!updates || updates.length === 0) return floors;
  return floors.map((floor) => {
    const forFloor = updates.filter((u) => u.floorNumber === floor.floor_number);
    if (forFloor.length === 0) return floor;
    const topology = floor.graph_topology ?? { nodes: [], edges: [] };
    const nodes = topology.nodes.map((node) => {
      const update = forFloor.find((u) => u.nodeId === node.id);
      return update ? { ...node, ...update.changes } : node;
    });
    return { ...floor, graph_topology: { ...topology, nodes } };
  });
};

/** Another node (not `exceptId`) in `nodes` already using `transitionId`. */
const findTransitionClash = (nodes, transitionId, exceptId) =>
  nodes.find((n) => n.id !== exceptId && n.transition_id === transitionId) ?? null;

/**
 * Works out how to link `node` (on `floorNumber`, being edited as `topology`)
 * to `target` ({ floor, node }) on another floor, so both share one
 * transition_id and the link can never be one-sided:
 *
 *  - target has a transition_id → `node` adopts it (current floor only;
 *    the target's own links to other floors are preserved).
 *  - target has none → the target adopts `node`'s id (or a new one), which
 *    is returned as `linkedUpdate` to be saved atomically with this floor.
 *
 * @returns {{ nodeChanges: object|null, linkedUpdate: object|null, error: string|null }}
 */
export const planVerticalLink = ({
  floors, floorNumber, topology, node, target, takenTransitionIds,
}) => {
  const fail = (error) => ({ nodeChanges: null, linkedUpdate: null, error });
  if (!isVerticalNode(node)) return fail('Only stairs and elevators can be linked across floors.');
  if (!target?.node || target.floor === floorNumber) return fail('Choose a node on another floor.');
  if (target.node.type !== node.type) {
    return fail(`A ${node.type === 'stairs' ? 'staircase' : 'elevator'} can only link to another ${node.type === 'stairs' ? 'staircase' : 'elevator'}.`);
  }

  if (target.node.transition_id) {
    const shared = target.node.transition_id;
    const clash = findTransitionClash(topology.nodes, shared, node.id);
    if (clash) return fail(`"${nodeLabel(clash)}" on this floor is already part of that ${node.type === 'stairs' ? 'staircase' : 'elevator'}.`);
    return {
      nodeChanges: node.transition_id === shared ? null : { transition_id: shared },
      linkedUpdate: null,
      error: null,
    };
  }

  const shared = node.transition_id || nextTransitionId(node.type, takenTransitionIds);
  const targetFloorNodes = floors.find((f) => f.floor_number === target.floor)?.graph_topology?.nodes ?? [];
  const clash = findTransitionClash(targetFloorNodes, shared, target.node.id);
  if (clash) return fail(`Floor ${target.floor} already has "${nodeLabel(clash)}" in this ${node.type === 'stairs' ? 'staircase' : 'elevator'}.`);
  return {
    nodeChanges: node.transition_id ? null : { transition_id: shared },
    linkedUpdate: { floorNumber: target.floor, nodeId: target.node.id, changes: { transition_id: shared } },
    error: null,
  };
};

/** Detaches `node` from its shaft by giving it a fresh, unused transition_id. */
export const planVerticalUnlink = ({ node, takenTransitionIds }) => ({
  transition_id: nextTransitionId(node.type, takenTransitionIds),
});

/* ------------------------------------------------------------------------- */
/* Validation                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Validates one floor's topology both on its own and in the context of the
 * whole building (unique ids across floors, one node per transition_id per
 * floor).
 *
 * @returns {string[]} list of problems; empty when valid
 */
export const validateFloorForBuilding = (floors, floorNumber, topology) => {
  const { errors } = validateTopology(topology);
  if (errors.length > 0) return errors;

  const transitionCounts = new Map();
  topology.nodes.forEach((node) => {
    if (node.transition_id) {
      transitionCounts.set(node.transition_id, (transitionCounts.get(node.transition_id) ?? 0) + 1);
    }
  });
  const problems = [];
  transitionCounts.forEach((count, id) => {
    if (count > 1) problems.push(`Transition id "${id}" is used by ${count} nodes on this floor.`);
  });

  const otherIds = new Set();
  const otherVertical = new Map(); // transition_id -> { type, floor, name }
  floors
    .filter((floor) => floor.floor_number !== floorNumber)
    .forEach((floor) => (floor.graph_topology?.nodes ?? []).forEach((node) => {
      otherIds.add(node.id);
      if (isVerticalNode(node) && node.transition_id && !otherVertical.has(node.transition_id)) {
        otherVertical.set(node.transition_id, { type: node.type, floor: floor.floor_number, name: nodeLabel(node) });
      }
    }));
  topology.nodes.forEach((node) => {
    if (otherIds.has(node.id)) problems.push(`Node id "${node.id}" is already used on another floor.`);
    // An elevator and a staircase must not share a transition_id: they would
    // look linked in the editor but never connect in routing.
    const other = isVerticalNode(node) && node.transition_id ? otherVertical.get(node.transition_id) : null;
    if (other && transitionGroupKey(node) !== `${other.type}:${node.transition_id}`) {
      problems.push(
        `Transition id "${node.transition_id}" on ${node.type} "${nodeLabel(node)}" is used by `
        + `${other.type} "${other.name}" on floor ${other.floor}. Elevators and stairs cannot share an id.`,
      );
    }
  });

  if (problems.length > 0) return problems;

  try {
    const isNewFloor = !floors.some((floor) => floor.floor_number === floorNumber);
    const merged = isNewFloor
      ? [...floors, { floor_number: floorNumber, graph_topology: topology }]
      : floors.map((floor) => (floor.floor_number === floorNumber ? { ...floor, graph_topology: topology } : floor));
    buildBuildingGraph(merged);
  } catch (error) {
    problems.push(error.message);
  }
  return problems;
};

/** True when two topologies differ. */
export const isTopologyChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
