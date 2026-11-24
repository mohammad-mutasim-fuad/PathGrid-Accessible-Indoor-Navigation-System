import {
  buildBuildingGraph,
  floorDocId,
  validateTopology,
  DEFAULT_TRANSITION_WEIGHTS,
} from './graphBuilder';

const floor = (floorNumber, nodes, edges = []) => ({
  building_id: 'B',
  floor_number: floorNumber,
  graph_topology: { nodes, edges },
});

describe('floorDocId', () => {
  test('zero-pads the floor number', () => {
    expect(floorDocId('ENG_MAIN', 1)).toBe('ENG_MAIN_FL01');
    expect(floorDocId('ENG_MAIN', 12)).toBe('ENG_MAIN_FL12');
  });

  test('rejects invalid input', () => {
    expect(() => floorDocId('', 1)).toThrow(TypeError);
    expect(() => floorDocId('ENG_MAIN', 1.5)).toThrow(TypeError);
  });
});

describe('validateTopology', () => {
  test('accepts a well-formed topology', () => {
    const result = validateTopology({
      nodes: [
        { id: 'A', x: 0, y: 0, type: 'room' },
        { id: 'E', x: 5, y: 5, type: 'elevator', transition_id: 'ELEV_1' },
      ],
      edges: [{ source: 'A', target: 'E', weight: 3 }],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('reports every problem it finds', () => {
    const { valid, errors } = validateTopology({
      nodes: [
        { id: 'A', x: 0, y: 0, type: 'room' },
        { id: 'A', x: 1, y: 1, type: 'room' },
        { id: 'S', x: 'bad', y: 0, type: 'stairs' },
      ],
      edges: [
        { source: 'A', target: 'MISSING' },
        { source: 'A', target: 'A' },
        { source: 'A', target: 'S', weight: -1 },
      ],
    });
    expect(valid).toBe(false);
    expect(errors.join('\n')).toMatch(/Duplicate node id "A"/);
    expect(errors.join('\n')).toMatch(/numeric "x" and "y"/);
    expect(errors.join('\n')).toMatch(/needs a "transition_id"/);
    expect(errors.join('\n')).toMatch(/unknown target "MISSING"/);
    expect(errors.join('\n')).toMatch(/self-loop/);
    expect(errors.join('\n')).toMatch(/non-negative/);
  });

  test('rejects missing arrays', () => {
    expect(validateTopology(null).valid).toBe(false);
    expect(validateTopology({ nodes: [] }).valid).toBe(false);
  });
});

describe('buildBuildingGraph', () => {
  const elevator = (id, accessible = true) => ({
    id, x: 0, y: 0, type: 'elevator', transition_id: 'ELEV', is_accessible: accessible,
  });
  const stairs = (id) => ({ id, x: 9, y: 9, type: 'stairs', transition_id: 'ST', is_accessible: false });

  test('tags nodes with their floor and links consecutive floors', () => {
    const graph = buildBuildingGraph([
      floor(2, [elevator('E2'), stairs('S2')]),
      floor(1, [elevator('E1'), stairs('S1')]),
      floor(3, [elevator('E3')]),
    ]);

    expect(graph.nodes.map((n) => [n.id, n.floor])).toEqual([
      ['E1', 1], ['S1', 1], ['E2', 2], ['S2', 2], ['E3', 3],
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'E1', target: 'E2', type: 'elevator', is_accessible: true,
        weight: DEFAULT_TRANSITION_WEIGHTS.elevator,
      }),
      expect.objectContaining({ source: 'E2', target: 'E3', type: 'elevator' }),
      expect.objectContaining({
        source: 'S1', target: 'S2', type: 'stairs', is_accessible: false,
        weight: DEFAULT_TRANSITION_WEIGHTS.stairs,
      }),
    ]));
    expect(graph.edges).toHaveLength(3);
  });

  test('scales weight by floors skipped and honours custom weights', () => {
    const graph = buildBuildingGraph(
      [floor(1, [elevator('E1')]), floor(4, [elevator('E4')])],
      { elevator: 7 },
    );
    expect(graph.edges[0].weight).toBe(21);
  });

  test('an inaccessible elevator node produces an inaccessible vertical edge', () => {
    const graph = buildBuildingGraph([floor(1, [elevator('E1')]), floor(2, [elevator('E2', false)])]);
    expect(graph.edges[0].is_accessible).toBe(false);
  });

  test('rejects node ids repeated across floors', () => {
    expect(() => buildBuildingGraph([
      floor(1, [{ id: 'X', x: 0, y: 0, type: 'room' }]),
      floor(2, [{ id: 'X', x: 0, y: 0, type: 'room' }]),
    ])).toThrow(/unique per building/);
  });

  test('does not mutate the input documents', () => {
    const docs = [floor(1, [elevator('E1')]), floor(2, [elevator('E2')])];
    const snapshot = JSON.stringify(docs);
    buildBuildingGraph(docs);
    expect(JSON.stringify(docs)).toBe(snapshot);
  });
});
