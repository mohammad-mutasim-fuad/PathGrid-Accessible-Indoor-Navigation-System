import { findShortestPath, filterGraph } from './aStarEngine';

/**
 * Two-floor fixture.
 *
 *   Floor 1:  A(0,0) --10-- B(10,0) --20-- E1(30,0)
 *                              |
 *                         S1(10,10)  [stairs]
 *   Floor 2:              S2(10,10) --20-- T(10,30)
 *                                        /
 *                         E2(30,0) --40-
 *
 *   Stairs route:   A-B-S1-S2-T  = 10 + 10 + 5 + 20 = 45
 *   Elevator route: A-B-E1-E2-T  = 10 + 20 + 5 + 40 = 75
 */
const buildGraph = ({ elevatorOutOfService = false } = {}) => ({
  nodes: [
    { id: 'A', name: 'Main Entrance', x: 0, y: 0, floor: 1, type: 'entrance', is_accessible: true },
    { id: 'B', name: 'Hallway B', x: 10, y: 0, floor: 1, type: 'hallway', is_accessible: true },
    { id: 'S1', name: 'Staircase A', x: 10, y: 10, floor: 1, type: 'stairs', is_accessible: false },
    {
      id: 'E1', name: 'Elevator 1', x: 30, y: 0, floor: 1, type: 'elevator',
      is_accessible: true, out_of_service: elevatorOutOfService,
    },
    { id: 'S2', name: 'Staircase A', x: 10, y: 10, floor: 2, type: 'stairs', is_accessible: false },
    {
      id: 'E2', name: 'Elevator 1', x: 30, y: 0, floor: 2, type: 'elevator',
      is_accessible: true, out_of_service: elevatorOutOfService,
    },
    { id: 'T', name: 'Lab 201', x: 10, y: 30, floor: 2, type: 'room', is_accessible: true },
  ],
  edges: [
    { source: 'A', target: 'B', weight: 10, type: 'corridor', is_accessible: true },
    { source: 'B', target: 'S1', weight: 10, type: 'corridor', is_accessible: true },
    { source: 'S1', target: 'S2', weight: 5, type: 'stairs', is_accessible: false },
    { source: 'S2', target: 'T', weight: 20, type: 'corridor', is_accessible: true },
    { source: 'B', target: 'E1', weight: 20, type: 'corridor', is_accessible: true },
    { source: 'E1', target: 'E2', weight: 5, type: 'elevator', is_accessible: true },
    { source: 'E2', target: 'T', weight: 40, type: 'corridor', is_accessible: true },
  ],
});

const ids = (result) => result.path.map((node) => node.id);

describe('findShortestPath – normal routing', () => {
  test('takes the cheapest route (via stairs) when wheelchair mode is off', () => {
    const result = findShortestPath(buildGraph(), 'A', 'T', false);

    expect(result.found).toBe(true);
    expect(ids(result)).toEqual(['A', 'B', 'S1', 'S2', 'T']);
    expect(result.totalDistance).toBe(45);
  });

  test('returns full node objects in order', () => {
    const result = findShortestPath(buildGraph(), 'A', 'B');
    expect(result.path[0]).toMatchObject({ id: 'A', name: 'Main Entrance' });
    expect(result.path[1]).toMatchObject({ id: 'B', name: 'Hallway B' });
  });

  test('edges are bidirectional', () => {
    const result = findShortestPath(buildGraph(), 'T', 'A');
    expect(ids(result)).toEqual(['T', 'S2', 'S1', 'B', 'A']);
    expect(result.totalDistance).toBe(45);
  });

  test('start === target yields a zero-length route', () => {
    const result = findShortestPath(buildGraph(), 'A', 'A');
    expect(result.found).toBe(true);
    expect(ids(result)).toEqual(['A']);
    expect(result.totalDistance).toBe(0);
    expect(result.directions).toEqual([
      expect.objectContaining({ maneuver: 'arrive', instruction: 'Arrive at Main Entrance' }),
    ]);
  });

  test('finds the optimal route even when weights are much smaller than pixel distances', () => {
    // An unscaled Euclidean heuristic would wrongly pick the geometrically
    // short S-M1-T route (cost 100) over the cheap detour S-M2-T (cost 2).
    const graph = {
      nodes: [
        { id: 'S', x: 0, y: 0, type: 'room', is_accessible: true },
        { id: 'M1', x: 50, y: 0, type: 'hallway', is_accessible: true },
        { id: 'M2', x: 0, y: 500, type: 'hallway', is_accessible: true },
        { id: 'T', x: 100, y: 0, type: 'room', is_accessible: true },
      ],
      edges: [
        { source: 'S', target: 'M1', weight: 50, type: 'corridor', is_accessible: true },
        { source: 'M1', target: 'T', weight: 50, type: 'corridor', is_accessible: true },
        { source: 'S', target: 'M2', weight: 1, type: 'corridor', is_accessible: true },
        { source: 'M2', target: 'T', weight: 1, type: 'corridor', is_accessible: true },
      ],
    };
    const result = findShortestPath(graph, 'S', 'T');
    expect(ids(result)).toEqual(['S', 'M2', 'T']);
    expect(result.totalDistance).toBe(2);
  });

  test('falls back to Euclidean distance when an edge has no weight', () => {
    const graph = {
      nodes: [
        { id: 'P', x: 0, y: 0, type: 'room', is_accessible: true },
        { id: 'Q', x: 3, y: 4, type: 'room', is_accessible: true },
      ],
      edges: [{ source: 'P', target: 'Q', type: 'corridor', is_accessible: true }],
    };
    expect(findShortestPath(graph, 'P', 'Q').totalDistance).toBe(5);
  });

  test('reports unknown and unreachable nodes without throwing', () => {
    const graph = buildGraph();
    graph.nodes.push({ id: 'ISO', x: 99, y: 99, floor: 1, type: 'room', is_accessible: true });

    const missing = findShortestPath(graph, 'A', 'NOPE');
    expect(missing.found).toBe(false);
    expect(missing.reason).toMatch(/does not exist/);

    const unreachable = findShortestPath(graph, 'A', 'ISO');
    expect(unreachable).toMatchObject({ found: false, path: [], totalDistance: Infinity, directions: [] });
  });

  test('throws on malformed graph data', () => {
    expect(() => findShortestPath(null, 'A', 'B')).toThrow(TypeError);
    expect(() => findShortestPath({ nodes: [] }, 'A', 'B')).toThrow(TypeError);
  });
});

describe('findShortestPath – wheelchair stair avoidance', () => {
  test('routes through the elevator instead of the stairs', () => {
    const result = findShortestPath(buildGraph(), 'A', 'T', true);

    expect(result.found).toBe(true);
    expect(ids(result)).toEqual(['A', 'B', 'E1', 'E2', 'T']);
    expect(result.totalDistance).toBe(75);
    expect(result.path.some((node) => node.type === 'stairs')).toBe(false);
  });

  test('prunes stairs nodes, stairs edges and is_accessible === false items', () => {
    const graph = buildGraph();
    graph.nodes.push({ id: 'R', x: 0, y: 5, floor: 1, type: 'room', is_accessible: false });
    graph.edges.push({ source: 'A', target: 'T', weight: 1, type: 'ramp', is_accessible: false });

    const { nodes, edges } = filterGraph(graph, true);
    const nodeIds = nodes.map((node) => node.id);

    expect(nodeIds).not.toContain('S1');
    expect(nodeIds).not.toContain('S2');
    expect(nodeIds).not.toContain('R');
    expect(edges.some((edge) => edge.type === 'stairs')).toBe(false);
    expect(edges.some((edge) => edge.is_accessible === false)).toBe(false);
    expect(edges.some((edge) => edge.source === 'S1' || edge.target === 'S1')).toBe(false);
  });

  test('ignores an inaccessible shortcut edge even if it is the cheapest', () => {
    const graph = buildGraph();
    graph.edges.push({ source: 'A', target: 'T', weight: 1, type: 'corridor', is_accessible: false });

    expect(findShortestPath(graph, 'A', 'T', false).totalDistance).toBe(1);
    expect(ids(findShortestPath(graph, 'A', 'T', true))).toEqual(['A', 'B', 'E1', 'E2', 'T']);
  });

  test('a stairs start node is unavailable in wheelchair mode', () => {
    const result = findShortestPath(buildGraph(), 'S1', 'T', true);
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/unavailable/);
  });
});

describe('findShortestPath – out-of-service elevators', () => {
  test('blocks the only accessible route, so wheelchair routing fails', () => {
    const result = findShortestPath(buildGraph({ elevatorOutOfService: true }), 'A', 'T', true);

    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.totalDistance).toBe(Infinity);
  });

  test('is impassable in normal mode too; walkers are routed via stairs', () => {
    const graph = buildGraph({ elevatorOutOfService: true });
    // Make the elevator the cheaper option so we know it is actively avoided.
    graph.edges.find((edge) => edge.source === 'E2').weight = 1;

    const result = findShortestPath(graph, 'A', 'T', false);
    expect(ids(result)).toEqual(['A', 'B', 'S1', 'S2', 'T']);
    expect(result.path.some((node) => node.type === 'elevator')).toBe(false);
  });

  test('cannot be used as a destination', () => {
    const result = findShortestPath(buildGraph({ elevatorOutOfService: true }), 'A', 'E1', false);
    expect(result.found).toBe(false);
  });

  test('an out-of-service corridor edge is also impassable', () => {
    const graph = buildGraph();
    graph.edges.find((edge) => edge.source === 'B' && edge.target === 'E1').out_of_service = true;
    expect(findShortestPath(graph, 'A', 'T', true).found).toBe(false);
  });
});

describe('findShortestPath – turn-by-turn directions', () => {
  // Canvas coordinates: y grows downward.
  //   W(0,0) -> X(10,0) -> Y(10,10)  : heading east, then south => right turn
  //   X(10,0) -> Z(10,-10)           : heading east, then north => left turn
  const grid = {
    nodes: [
      { id: 'W', name: 'West Door', x: 0, y: 0, type: 'entrance', is_accessible: true },
      { id: 'X', name: 'Junction', x: 10, y: 0, type: 'hallway', is_accessible: true },
      { id: 'Y', name: 'South Room', x: 10, y: 10, type: 'room', is_accessible: true },
      { id: 'Z', name: 'North Room', x: 10, y: -10, type: 'room', is_accessible: true },
      { id: 'V', name: 'East Room', x: 20, y: 0, type: 'room', is_accessible: true },
    ],
    edges: [
      { source: 'W', target: 'X', weight: 10, type: 'corridor', is_accessible: true },
      { source: 'X', target: 'Y', weight: 10, type: 'corridor', is_accessible: true },
      { source: 'X', target: 'Z', weight: 10, type: 'corridor', is_accessible: true },
      { source: 'X', target: 'V', weight: 10, type: 'corridor', is_accessible: true },
    ],
  };

  const maneuvers = (result) => result.directions.map((step) => step.maneuver);

  test('detects right, left and straight turns', () => {
    expect(maneuvers(findShortestPath(grid, 'W', 'Y'))).toEqual(['depart', 'right', 'arrive']);
    expect(maneuvers(findShortestPath(grid, 'W', 'Z'))).toEqual(['depart', 'left', 'arrive']);
    expect(maneuvers(findShortestPath(grid, 'W', 'V'))).toEqual(['depart', 'straight', 'arrive']);
  });

  test('produces readable instructions with per-step distances', () => {
    const { directions } = findShortestPath(grid, 'W', 'Y');
    expect(directions).toEqual([
      {
        maneuver: 'depart', instruction: 'Start at West Door and head toward Junction',
        fromNodeId: 'W', toNodeId: 'X', distance: 10,
      },
      {
        maneuver: 'right', instruction: 'Turn right toward South Room',
        fromNodeId: 'X', toNodeId: 'Y', distance: 10,
      },
      {
        maneuver: 'arrive', instruction: 'Arrive at South Room',
        fromNodeId: 'Y', toNodeId: 'Y', distance: 0,
      },
    ]);
  });

  test('step distances add up to the total distance', () => {
    const result = findShortestPath(buildGraph(), 'A', 'T', true);
    const sum = result.directions.reduce((acc, step) => acc + step.distance, 0);
    expect(sum).toBe(result.totalDistance);
  });

  test('announces floor changes at elevators', () => {
    const { directions } = findShortestPath(buildGraph(), 'A', 'T', true);
    expect(directions.map((step) => step.maneuver)).toEqual([
      'depart', 'straight', 'change-floor', 'continue', 'arrive',
    ]);
    expect(directions[2].instruction).toBe('Take Elevator 1 to floor 2');
    expect(directions[3].instruction).toBe('Head toward Lab 201');
  });
});
