/**
 * End-to-end cross-floor routing: nodes are linked exactly as the Map Editor
 * links them (planVerticalLink / planVerticalUnlink), the building graph is
 * built with buildBuildingGraph, and routes come from aStarEngine.
 */
import { buildBuildingGraph } from './graphBuilder';
import { findShortestPath } from './aStarEngine';
import {
  applyLinkedNodeUpdates, planVerticalLink, planVerticalUnlink,
} from './topologyEditor';

const corridor = (source, target, weight, extra = {}) => ({
  source, target, weight, type: 'corridor', is_accessible: true, ...extra,
});

/*
 * Floor 1: A (entrance) — H1 — S1 (stairs, STAIRS_A)
 *                          \— E1 (elevator, ELEV_A)
 * Floor 2: S2 (stairs, STAIRS_B) — H2 — T (target room) — E2 (elevator, ELEV_B)
 * Floors start UNLINKED (different transition ids).
 * Via stairs: 10 + 10 + 15 (stairs) + 10 + 15 = 60
 * Via elevator: 10 + 30 + 10 (elevator) + 15 = 65
 */
const baseFloors = () => [
  {
    building_id: 'B',
    floor_number: 1,
    graph_topology: {
      nodes: [
        { id: 'A', name: 'Entrance', x: 0, y: 300, type: 'entrance', is_accessible: true },
        { id: 'H1', name: 'Hall 1', x: 100, y: 300, type: 'corridor', is_accessible: true },
        { id: 'S1', name: 'Stairs 1', x: 100, y: 400, type: 'stairs', is_accessible: false, transition_id: 'STAIRS_A' },
        {
          id: 'E1', name: 'Lift 1', x: 400, y: 300, type: 'elevator', is_accessible: true, out_of_service: false, transition_id: 'ELEV_A',
        },
      ],
      edges: [
        corridor('A', 'H1', 10),
        corridor('H1', 'S1', 10, { type: 'stairs', is_accessible: false }),
        corridor('H1', 'E1', 30),
      ],
    },
  },
  {
    building_id: 'B',
    floor_number: 2,
    graph_topology: {
      nodes: [
        { id: 'S2', name: 'Stairs 2', x: 100, y: 400, type: 'stairs', is_accessible: false, transition_id: 'STAIRS_B' },
        { id: 'H2', name: 'Hall 2', x: 100, y: 300, type: 'corridor', is_accessible: true },
        { id: 'T', name: 'Lab 201', x: 250, y: 300, type: 'room', is_accessible: true },
        {
          id: 'E2', name: 'Lift 2', x: 400, y: 300, type: 'elevator', is_accessible: true, out_of_service: false, transition_id: 'ELEV_B',
        },
      ],
      edges: [
        corridor('S2', 'H2', 10, { type: 'stairs', is_accessible: false }),
        corridor('H2', 'T', 15),
        corridor('T', 'E2', 15),
      ],
    },
  },
];

const takenIds = (floors) => new Set(floors.flatMap((f) => f.graph_topology.nodes.map((n) => n.transition_id)).filter(Boolean));

const patchNode = (floors, floorNumber, nodeId, changes) => floors.map((f) => (f.floor_number !== floorNumber ? f : {
  ...f,
  graph_topology: {
    ...f.graph_topology,
    nodes: f.graph_topology.nodes.map((n) => (n.id === nodeId ? { ...n, ...changes } : n)),
  },
}));

/** Links (floorNumber, nodeId) to (targetFloor, targetId) the way the editor does. */
const link = (floors, floorNumber, nodeId, targetFloor, targetId) => {
  const floorDoc = floors.find((f) => f.floor_number === floorNumber);
  const node = floorDoc.graph_topology.nodes.find((n) => n.id === nodeId);
  const target = floors.find((f) => f.floor_number === targetFloor).graph_topology.nodes.find((n) => n.id === targetId);
  const plan = planVerticalLink({
    floors, floorNumber, topology: floorDoc.graph_topology, node, target: { floor: targetFloor, node: target }, takenTransitionIds: takenIds(floors),
  });
  if (plan.error) throw new Error(plan.error);
  let next = plan.nodeChanges ? patchNode(floors, floorNumber, nodeId, plan.nodeChanges) : floors;
  if (plan.linkedUpdate) next = applyLinkedNodeUpdates(next, [plan.linkedUpdate]);
  return next;
};

const unlink = (floors, floorNumber, nodeId) => {
  const node = floors.find((f) => f.floor_number === floorNumber).graph_topology.nodes.find((n) => n.id === nodeId);
  return patchNode(floors, floorNumber, nodeId, planVerticalUnlink({ node, takenTransitionIds: takenIds(floors) }));
};

const route = (floors, wheelchair) => findShortestPath(buildBuildingGraph(floors), 'A', 'T', wheelchair);
const ids = (result) => result.path.map((n) => n.id);

describe('cross-floor routing through editor-made links', () => {
  test('unlinked floors are unreachable in both modes', () => {
    expect(route(baseFloors(), false).found).toBe(false);
    expect(route(baseFloors(), true).found).toBe(false);
  });

  test('linked staircases carry standard routes, but never wheelchair routes', () => {
    const floors = link(baseFloors(), 2, 'S2', 1, 'S1');

    const standard = route(floors, false);
    expect(ids(standard)).toEqual(['A', 'H1', 'S1', 'S2', 'H2', 'T']);
    expect(standard.totalDistance).toBe(60);
    expect(standard.directions.find((s) => s.maneuver === 'change-floor').instruction).toBe('Take Stairs 1 to floor 2');

    const wheelchair = route(floors, true);
    expect(wheelchair.found).toBe(false);
  });

  test('linked elevators carry wheelchair routes (and standard routes when no stairs exist)', () => {
    const floors = link(baseFloors(), 1, 'E1', 2, 'E2');

    const wheelchair = route(floors, true);
    expect(ids(wheelchair)).toEqual(['A', 'H1', 'E1', 'E2', 'T']);
    expect(wheelchair.totalDistance).toBe(65);
    expect(wheelchair.directions.find((s) => s.maneuver === 'change-floor').instruction).toBe('Take Lift 1 to floor 2');

    const standard = route(floors, false);
    expect(ids(standard)).toEqual(['A', 'H1', 'E1', 'E2', 'T']);
  });

  test('with both linked: standard takes the shorter stairs, wheelchair takes the elevator', () => {
    const floors = link(link(baseFloors(), 2, 'S2', 1, 'S1'), 1, 'E1', 2, 'E2');

    expect(ids(route(floors, false))).toContain('S1');
    const wheelchair = route(floors, true);
    expect(ids(wheelchair)).toEqual(['A', 'H1', 'E1', 'E2', 'T']);
    expect(wheelchair.path.some((n) => n.type === 'stairs')).toBe(false);
  });

  test('an out-of-service elevator blocks wheelchair routing; walkers still use the stairs', () => {
    let floors = link(link(baseFloors(), 2, 'S2', 1, 'S1'), 1, 'E1', 2, 'E2');
    floors = patchNode(floors, 1, 'E1', { out_of_service: true });

    expect(route(floors, true).found).toBe(false);
    expect(ids(route(floors, false))).toEqual(['A', 'H1', 'S1', 'S2', 'H2', 'T']);
  });

  test('unlinking the stairs makes standard routes fall back to the elevator', () => {
    let floors = link(link(baseFloors(), 2, 'S2', 1, 'S1'), 1, 'E1', 2, 'E2');
    floors = unlink(floors, 2, 'S2');

    expect(ids(route(floors, false))).toEqual(['A', 'H1', 'E1', 'E2', 'T']);
  });

  test('linking to a node without an id gives both the same new id', () => {
    const floors = patchNode(baseFloors(), 2, 'S2', { transition_id: undefined });
    const linked = link(floors, 1, 'S1', 2, 'S2');
    const s2 = linked[1].graph_topology.nodes.find((n) => n.id === 'S2');
    expect(s2.transition_id).toBe('STAIRS_A');
    expect(route(linked, false).found).toBe(true);
  });

  test('regression: a staircase sharing an elevator\'s id does not create an elevator link', () => {
    const floors = patchNode(baseFloors(), 2, 'S2', { transition_id: 'ELEV_A' });
    const graph = buildBuildingGraph(floors);
    expect(graph.edges.some((e) => [e.source, e.target].includes('E1') && [e.source, e.target].includes('S2'))).toBe(false);
    expect(route(floors, true).found).toBe(false);
  });
});
