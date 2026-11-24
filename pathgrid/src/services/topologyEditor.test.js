import {
  applyEdgeOutOfService,
  applyElevatorOutOfService,
  computeEdgeWeight,
  createNode,
  editorReducer,
  initEditorState,
  isTopologyChanged,
  nextNodeId,
  nextTransitionId,
  typeChangeDefaults,
  validateFloorForBuilding,
} from './topologyEditor';
import mockMapData from '../data/mockMapData.json';

const node = (id, x, y, extra = {}) => ({
  id, name: id, x, y, type: 'corridor', is_accessible: true, ...extra,
});

const baseTopology = () => ({
  nodes: [node('A', 0, 0), node('B', 100, 0), node('C', 100, 50)],
  edges: [{ source: 'A', target: 'B', weight: 10, type: 'corridor', is_accessible: true }],
});

const run = (actions, topology = baseTopology()) =>
  actions.reduce((state, action) => editorReducer(state, action), initEditorState(topology));

describe('id and weight helpers', () => {
  test('nextNodeId picks the first free id for the floor and type', () => {
    expect(nextNodeId(2, 'room', new Set())).toBe('F2_ROOM_1');
    expect(nextNodeId(2, 'room', new Set(['F2_ROOM_1', 'F2_ROOM_2']))).toBe('F2_ROOM_3');
    expect(nextNodeId(1, 'elevator', new Set())).toBe('F1_ELEV_1');
  });

  test('nextTransitionId uses ELEV_/STAIRS_ prefixes', () => {
    expect(nextTransitionId('elevator', new Set(['ELEV_1']))).toBe('ELEV_2');
    expect(nextTransitionId('stairs', new Set(['ELEV_1']))).toBe('STAIRS_1');
  });

  test('computeEdgeWeight converts map units to metres', () => {
    expect(computeEdgeWeight({ x: 0, y: 0 }, { x: 30, y: 40 }, 10)).toBe(5);
    expect(computeEdgeWeight({ x: 0, y: 0 }, { x: 33, y: 0 }, 10)).toBe(3.3);
    expect(computeEdgeWeight({ x: 0, y: 0 }, { x: 50, y: 0 }, 0)).toBe(5);
  });
});

describe('createNode / typeChangeDefaults', () => {
  test('stairs are inaccessible and get a transition id', () => {
    expect(createNode({ id: 'S', type: 'stairs', x: 1.4, y: 2.6, transitionId: 'STAIRS_9' })).toEqual({
      id: 'S', name: 'New staircase', x: 1, y: 3, type: 'stairs', is_accessible: false, transition_id: 'STAIRS_9',
    });
  });

  test('elevators start in service', () => {
    expect(createNode({ id: 'E', type: 'elevator', x: 0, y: 0, transitionId: 'ELEV_4' })).toMatchObject({
      type: 'elevator', is_accessible: true, transition_id: 'ELEV_4', out_of_service: false,
    });
  });

  test('changing away from a transition type clears its fields', () => {
    const changes = typeChangeDefaults({ type: 'stairs', transition_id: 'STAIRS_1', is_accessible: false }, 'room');
    expect(changes).toEqual({
      type: 'room', transition_id: undefined, out_of_service: undefined, is_accessible: true,
    });
  });

  test('an existing elevator keeps its transition id', () => {
    const changes = typeChangeDefaults({ type: 'elevator', transition_id: 'ELEV_1' }, 'elevator', { transitionId: 'ELEV_7' });
    expect(changes.transition_id).toBe('ELEV_1');
  });
});

describe('editorReducer', () => {
  test('addNode appends and records history', () => {
    const state = run([{ type: 'addNode', node: node('D', 5, 5) }]);
    expect(state.topology.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.past).toHaveLength(1);
  });

  test('addNode ignores duplicate ids without touching history', () => {
    const initial = initEditorState(baseTopology());
    expect(editorReducer(initial, { type: 'addNode', node: node('A', 9, 9) })).toBe(initial);
  });

  test('addEdge computes weight and refuses self-loops and duplicates', () => {
    const state = run([
      { type: 'addEdge', source: 'B', target: 'C', unitsPerMeter: 10 },
      { type: 'addEdge', source: 'C', target: 'B', unitsPerMeter: 10 },
      { type: 'addEdge', source: 'A', target: 'A', unitsPerMeter: 10 },
    ]);
    expect(state.topology.edges).toHaveLength(2);
    expect(state.topology.edges[1]).toEqual({
      source: 'B', target: 'C', weight: 5, type: 'corridor', is_accessible: true,
    });
    expect(state.past).toHaveLength(1);
  });

  test('edges touching stairs default to inaccessible stairs edges', () => {
    const topology = baseTopology();
    topology.nodes.push(node('S', 0, 50, { type: 'stairs', is_accessible: false, transition_id: 'STAIRS_1' }));
    const state = run([{ type: 'addEdge', source: 'A', target: 'S', unitsPerMeter: 10 }], topology);
    expect(state.topology.edges[1]).toMatchObject({ type: 'stairs', is_accessible: false });
  });

  test('moving a node re-weights its connected edges only', () => {
    const state = run([
      { type: 'addEdge', source: 'B', target: 'C', unitsPerMeter: 10 },
      {
        type: 'updateNode', id: 'B', changes: { x: 0, y: 30 }, unitsPerMeter: 10,
      },
    ]);
    const weights = Object.fromEntries(state.topology.edges.map((e) => [`${e.source}${e.target}`, e.weight]));
    expect(weights).toEqual({ AB: 3, BC: 10.2 });
  });

  test('updateNode removes keys set to undefined and keeps the id', () => {
    const topology = baseTopology();
    topology.nodes[0] = node('A', 0, 0, { type: 'elevator', transition_id: 'ELEV_1', out_of_service: true });
    const state = run([{
      type: 'updateNode', id: 'A', changes: { id: 'HACK', type: 'room', transition_id: undefined, out_of_service: undefined },
    }], topology);
    expect(state.topology.nodes[0]).toEqual({
      id: 'A', name: 'A', x: 0, y: 0, type: 'room', is_accessible: true,
    });
  });

  test('deleteNode cascades to its edges', () => {
    const state = run([{ type: 'deleteNode', id: 'B' }]);
    expect(state.topology.nodes.map((n) => n.id)).toEqual(['A', 'C']);
    expect(state.topology.edges).toEqual([]);
  });

  test('updateEdge and deleteEdge match either direction', () => {
    const updated = run([{
      type: 'updateEdge', source: 'B', target: 'A', changes: { out_of_service: true, source: 'X' },
    }]);
    expect(updated.topology.edges[0]).toMatchObject({ source: 'A', target: 'B', out_of_service: true });
    expect(run([{ type: 'deleteEdge', source: 'B', target: 'A' }]).topology.edges).toEqual([]);
  });

  test('undo and redo walk the history; a new edit clears redo', () => {
    let state = run([{ type: 'addNode', node: node('D', 5, 5) }, { type: 'deleteNode', id: 'A' }]);
    state = editorReducer(state, { type: 'undo' });
    expect(state.topology.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
    state = editorReducer(state, { type: 'redo' });
    expect(state.topology.nodes.map((n) => n.id)).toEqual(['B', 'C', 'D']);
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'addNode', node: node('E', 1, 1) });
    expect(state.future).toEqual([]);
    expect(editorReducer(initEditorState(baseTopology()), { type: 'undo' }).past).toEqual([]);
  });

  test('reset replaces the topology and clears history', () => {
    const state = editorReducer(run([{ type: 'deleteNode', id: 'A' }]), { type: 'reset', topology: baseTopology() });
    expect(state).toEqual(initEditorState(baseTopology()));
  });

  test('never mutates the previous topology', () => {
    const initial = initEditorState(baseTopology());
    const snapshot = JSON.stringify(initial);
    run([{ type: 'deleteNode', id: 'A' }, { type: 'addEdge', source: 'B', target: 'C' }], initial.topology);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(isTopologyChanged(initial.topology, baseTopology())).toBe(false);
  });
});

describe('out-of-service helpers', () => {
  test('applyElevatorOutOfService updates every floor sharing the transition id', () => {
    const { floors, updated } = applyElevatorOutOfService(mockMapData.floors, 'ELEV_1', true);
    expect(updated).toBe(3);
    floors.forEach((floor) => {
      expect(floor.graph_topology.nodes.find((n) => n.transition_id === 'ELEV_1').out_of_service).toBe(true);
    });
    expect(mockMapData.floors[0].graph_topology.nodes.find((n) => n.id === 'F1_ELEV_1').out_of_service).toBe(false);
  });

  test('applyElevatorOutOfService reports zero matches for unknown keys', () => {
    expect(applyElevatorOutOfService(mockMapData.floors, 'NOPE', true).updated).toBe(0);
  });

  test('applyEdgeOutOfService matches either direction and throws for unknown edges', () => {
    const result = applyEdgeOutOfService(baseTopology(), 'B', 'A', true);
    expect(result.edges[0].out_of_service).toBe(true);
    expect(() => applyEdgeOutOfService(baseTopology(), 'A', 'C', true)).toThrow(/No edge/);
  });
});

describe('validateFloorForBuilding', () => {
  const floors = mockMapData.floors;
  const floor1 = floors[0].graph_topology;

  test('the mock floors are valid', () => {
    expect(validateFloorForBuilding(floors, 1, floor1)).toEqual([]);
  });

  test('rejects ids already used on another floor', () => {
    const topology = { ...floor1, nodes: [...floor1.nodes, node('F2_HALL_1', 5, 5)] };
    expect(validateFloorForBuilding(floors, 1, topology)).toEqual([
      'Node id "F2_HALL_1" is already used on another floor.',
    ]);
  });

  test('rejects a transition id used twice on one floor', () => {
    const topology = {
      ...floor1,
      nodes: [...floor1.nodes, node('F1_ELEV_9', 5, 5, { type: 'elevator', transition_id: 'ELEV_1' })],
    };
    expect(validateFloorForBuilding(floors, 1, topology)[0]).toMatch(/Transition id "ELEV_1" is used by 2 nodes/);
  });

  test('passes through single-floor validation errors', () => {
    expect(validateFloorForBuilding(floors, 1, { nodes: [{ id: 'X' }], edges: [] })[0]).toMatch(/numeric/);
  });
});
