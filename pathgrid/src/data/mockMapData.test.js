import mockMapData from './mockMapData.json';
import { buildBuildingGraph, validateTopology } from '../services/graphBuilder';
import { findShortestPath } from '../services/aStarEngine';

const [building] = mockMapData.buildings;
const graph = buildBuildingGraph(mockMapData.floors, building.transition_weights);
const byName = (name) => {
  const node = graph.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`No node named ${name}`);
  return node.id;
};
const MAIN_ENTRANCE = byName('Main Entrance (West)');

describe('mockMapData integrity', () => {
  test('building metadata matches the floors provided', () => {
    const floors = mockMapData.floors.filter((f) => f.building_id === building.building_id);
    expect(floors).toHaveLength(building.total_floors);
    expect(floors.map((f) => f.floor_number).sort()).toEqual([1, 2, 3]);
  });

  test.each(mockMapData.floors.map((f) => [f.floor_number, f]))(
    'floor %i topology is valid',
    (_, floorDoc) => {
      expect(validateTopology(floorDoc.graph_topology)).toEqual({ valid: true, errors: [] });
    },
  );

  test('contains stairs, elevators, an out-of-service elevator and inaccessible items', () => {
    expect(graph.nodes.some((n) => n.type === 'stairs')).toBe(true);
    expect(graph.nodes.some((n) => n.type === 'elevator' && !n.out_of_service)).toBe(true);
    expect(graph.nodes.some((n) => n.type === 'elevator' && n.out_of_service)).toBe(true);
    expect(graph.edges.some((e) => e.type !== 'stairs' && e.is_accessible === false)).toBe(true);
  });
});

describe('mockMapData routing with aStarEngine', () => {
  test('every node except out-of-service elevators is reachable on foot', () => {
    graph.nodes
      .filter((n) => !(n.type === 'elevator' && n.out_of_service))
      .forEach((node) => {
        expect(findShortestPath(graph, MAIN_ENTRANCE, node.id, false).found).toBe(true);
      });
  });

  test('every accessible room is reachable in wheelchair mode without stairs', () => {
    graph.nodes
      .filter((n) => ['room', 'restroom'].includes(n.type) && n.is_accessible)
      .forEach((node) => {
        const result = findShortestPath(graph, MAIN_ENTRANCE, node.id, true);
        expect(result.found).toBe(true);
        expect(result.path.some((n) => n.type === 'stairs')).toBe(false);
      });
  });

  test("wheelchair route to the Dean's Office uses Elevator 1, never Elevator 2", () => {
    const result = findShortestPath(graph, MAIN_ENTRANCE, byName("Dean's Office"), true);
    const transitions = result.path.map((n) => n.transition_id).filter(Boolean);
    expect(transitions).toContain('ELEV_1');
    expect(transitions).not.toContain('ELEV_2');
    expect(result.directions.some((s) => s.maneuver === 'change-floor')).toBe(true);
  });

  test('walking route to floor 3 is shorter than the wheelchair route (stairs allowed)', () => {
    const target = byName('Seminar Room 301');
    const walk = findShortestPath(graph, MAIN_ENTRANCE, target, false);
    const roll = findShortestPath(graph, MAIN_ENTRANCE, target, true);
    expect(walk.path.some((n) => n.transition_id === 'STAIRS_A')).toBe(true);
    expect(walk.totalDistance).toBeLessThan(roll.totalDistance);
  });

  test('floor 2 step section forces a ramp detour in wheelchair mode', () => {
    const from = 'F2_HALL_3';
    const to = 'F2_HALL_4';
    expect(findShortestPath(graph, from, to, false).path.map((n) => n.id)).toEqual([from, to]);
    expect(findShortestPath(graph, from, to, true).path.map((n) => n.id)).toEqual([from, 'F2_RAMP', to]);
  });

  test('inaccessible destinations are rejected in wheelchair mode', () => {
    const serverRoom = byName('Server Room (Raised Floor)');
    expect(findShortestPath(graph, MAIN_ENTRANCE, serverRoom, false).found).toBe(true);
    expect(findShortestPath(graph, MAIN_ENTRANCE, serverRoom, true).found).toBe(false);
  });
});
