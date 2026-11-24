import {
  describeRouteFailure,
  formatDistance,
  getCanvasSize,
  getFloorGraph,
  getNextRouteFloor,
  getPathSegmentsForFloor,
  getRouteFloors,
  getSelectableLocations,
  groupLocationsByFloor,
  parseQrParams,
  routeSignature,
} from './routeUtils';

const n = (id, floor, extra = {}) => ({ id, floor, x: 0, y: 0, type: 'corridor', ...extra });

describe('parseQrParams', () => {
  test('reads building, floor and start', () => {
    expect(parseQrParams('?building=ENG_MAIN&floor=2&start=N201')).toEqual({
      buildingId: 'ENG_MAIN', floor: 2, startNodeId: 'N201',
    });
  });

  test('accepts the PRD startNode spelling and URLSearchParams input', () => {
    expect(parseQrParams(new URLSearchParams('startNode=N101')).startNodeId).toBe('N101');
  });

  test('returns nulls for missing or invalid values', () => {
    expect(parseQrParams('?floor=abc&start=%20')).toEqual({
      buildingId: null, floor: null, startNodeId: null,
    });
    expect(parseQrParams(undefined).startNodeId).toBeNull();
  });
});

describe('location helpers', () => {
  const graph = {
    nodes: [
      n('R2', 2, { name: 'Alpha', type: 'room' }),
      n('H1', 1, { type: 'corridor' }),
      n('R1b', 1, { name: 'Zeta', type: 'room', is_accessible: false }),
      n('R1a', 1, { name: 'Entrance', type: 'entrance' }),
      n('E1', 1, { type: 'elevator' }),
    ],
    edges: [{ source: 'H1', target: 'R1a' }, { source: 'R1a', target: 'R2' }],
  };

  test('only selectable types, sorted by floor then name', () => {
    expect(getSelectableLocations(graph).map((l) => [l.id, l.isAccessible])).toEqual([
      ['R1a', true], ['R1b', false], ['R2', true],
    ]);
    expect(getSelectableLocations(null)).toEqual([]);
  });

  test('groups by floor', () => {
    const groups = groupLocationsByFloor(getSelectableLocations(graph));
    expect(groups.map((g) => [g.floor, g.locations.length])).toEqual([[1, 2], [2, 1]]);
  });

  test('getFloorGraph keeps only same-floor nodes and edges', () => {
    const { nodes, edges } = getFloorGraph(graph, 1);
    expect(nodes).toHaveLength(4);
    expect(edges).toEqual([{ source: 'H1', target: 'R1a' }]);
  });
});

describe('route helpers', () => {
  const path = [n('A', 1), n('B', 1), n('E1', 1), n('E2', 2), n('E3', 3), n('T', 3)];

  test('getRouteFloors lists floors in travel order', () => {
    expect(getRouteFloors(path)).toEqual([1, 2, 3]);
    expect(getRouteFloors([])).toEqual([]);
  });

  test('getNextRouteFloor finds the continuation floor', () => {
    expect(getNextRouteFloor(path, 1)).toBe(2);
    expect(getNextRouteFloor(path, 2)).toBe(3);
    expect(getNextRouteFloor(path, 3)).toBeNull();
    expect(getNextRouteFloor(path, 9)).toBeNull();
  });

  test('getPathSegmentsForFloor skips vertical transitions', () => {
    expect(getPathSegmentsForFloor(path, 1).map(([a, b]) => `${a.id}-${b.id}`)).toEqual(['A-B', 'B-E1']);
    expect(getPathSegmentsForFloor(path, 2)).toEqual([]);
  });

  test('routeSignature identifies the node sequence', () => {
    expect(routeSignature({ found: true, path })).toBe('A>B>E1>E2>E3>T');
    expect(routeSignature({ found: false, path: [] })).toBe('');
    expect(routeSignature(null)).toBe('');
  });
});

describe('getCanvasSize', () => {
  test('prefers building metadata', () => {
    expect(getCanvasSize({ canvas_width: 800, canvas_height: 500 }, [])).toEqual({ width: 800, height: 500 });
  });

  test('falls back to node extents plus padding', () => {
    expect(getCanvasSize({}, [{ x: 100, y: 40 }, { x: 300, y: 200 }])).toEqual({ width: 360, height: 260 });
    expect(getCanvasSize(null, [])).toEqual({ width: 1000, height: 600 });
  });
});

describe('formatting', () => {
  test('formatDistance', () => {
    expect(formatDistance(42.4)).toBe('42 m');
    expect(formatDistance(Infinity)).toBe('—');
  });

  test('describeRouteFailure explains wheelchair-specific failures', () => {
    const fail = { found: false };
    const start = { name: 'Lobby', is_accessible: true };
    expect(describeRouteFailure(fail, {
      isWheelchairMode: true, startNode: start, targetNode: { name: 'Server Room', is_accessible: false },
    })).toBe('Server Room is not step-free accessible.');
    expect(describeRouteFailure(fail, {
      isWheelchairMode: true, startNode: start, targetNode: { name: 'Lab', is_accessible: true },
    })).toMatch(/No step-free route from Lobby to Lab/);
    expect(describeRouteFailure(fail, { isWheelchairMode: false, startNode: start, targetNode: { name: 'Lab' } }))
      .toMatch(/No route from Lobby to Lab/);
    expect(describeRouteFailure({ found: true }, {})).toBe('');
  });
});
