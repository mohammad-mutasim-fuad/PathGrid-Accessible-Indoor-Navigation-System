/*
 * No REACT_APP_FIREBASE_* variables are set under Jest, so these tests cover
 * the offline/mock path that the public map relies on without a backend.
 */
import { isFirebaseConfigured, firebaseConfigError } from './firebase';
import {
  normalizeBuilding,
  normalizeFloor,
  getBuilding,
  getBuildingFloors,
  getFloor,
  listBuildings,
  loadBuildingGraph,
  saveFloorTopology,
  setElevatorOutOfService,
  subscribeToBuilding,
  subscribeToMapUpdates,
} from './dbService';

describe('dbService without Firebase configuration', () => {
  test('firebase.js reports the missing configuration instead of throwing', () => {
    expect(isFirebaseConfigured).toBe(false);
    expect(firebaseConfigError).toMatch(/REACT_APP_FIREBASE_API_KEY/);
  });

  test('reads buildings and floors from mock data', async () => {
    expect((await listBuildings()).map((b) => b.building_id)).toEqual(['ENG_MAIN']);
    expect(await getBuilding('ENG_MAIN')).toMatchObject({ building_name: 'Engineering Complex' });
    expect(await getBuilding('NOPE')).toBeNull();
    expect((await getBuildingFloors('ENG_MAIN')).map((f) => f.floor_number)).toEqual([1, 2, 3]);
    expect(await getFloor('ENG_MAIN', 2)).toMatchObject({ floor_number: 2 });
    expect(await getFloor('ENG_MAIN', 9)).toBeNull();
  });

  test('returned mock objects are copies, safe to mutate', async () => {
    const floor = await getFloor('ENG_MAIN', 1);
    floor.graph_topology.nodes.length = 0;
    expect((await getFloor('ENG_MAIN', 1)).graph_topology.nodes.length).toBeGreaterThan(0);
  });

  test('loadBuildingGraph merges floors into one routable graph', async () => {
    const { building, floors, graph, source } = await loadBuildingGraph('ENG_MAIN');
    expect(source).toBe('mock');
    expect(building.building_id).toBe('ENG_MAIN');
    expect(floors).toHaveLength(3);
    expect(new Set(graph.nodes.map((n) => n.floor))).toEqual(new Set([1, 2, 3]));
    expect(graph.edges.some((e) => e.transition_id === 'ELEV_1')).toBe(true);
  });

  test('loadBuildingGraph rejects unknown buildings', async () => {
    await expect(loadBuildingGraph('NOPE')).rejects.toThrow(/not available offline/);
  });

  test('subscribeToBuilding emits the mock building once and returns an unsubscribe', () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToBuilding('ENG_MAIN', onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ building_id: 'ENG_MAIN' });
    expect(typeof unsubscribe).toBe('function');
  });

  test('subscribeToMapUpdates does not fire for the initial snapshot', () => {
    const onUpdate = jest.fn();
    subscribeToMapUpdates('ENG_MAIN', onUpdate);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('admin writes fail with a clear configuration error', async () => {
    await expect(setElevatorOutOfService('ENG_MAIN', 'ELEV_1', true))
      .rejects.toThrow(/Firebase is not configured/);
    await expect(saveFloorTopology('ENG_MAIN', 1, { nodes: [], edges: [] }))
      .rejects.toThrow(/Firebase is not configured/);
  });

  test('saveFloorTopology validates before touching Firestore', async () => {
    await expect(saveFloorTopology('ENG_MAIN', 1, { nodes: [{ id: 'A' }], edges: [] }))
      .rejects.toThrow(/Invalid graph_topology/);
  });
});

describe('normalizing minimal Firestore documents', () => {
  test('a building with only { name } gets building_id from the doc id', () => {
    expect(normalizeBuilding('ENG_MAIN', { name: 'Engineering Main Building' })).toEqual({
      id: 'ENG_MAIN',
      name: 'Engineering Main Building',
      building_id: 'ENG_MAIN',
      building_name: 'Engineering Main Building',
    });
  });

  test('complete building documents are left as they are', () => {
    const doc = { building_id: 'ENG_MAIN', building_name: 'Engineering Complex', total_floors: 3 };
    expect(normalizeBuilding('ENG_MAIN', doc)).toEqual({ id: 'ENG_MAIN', ...doc });
    expect(normalizeBuilding('X', { building_id: '  ' }).building_id).toBe('X');
    expect(normalizeBuilding('X', undefined).building_name).toBe('X');
  });

  test('floors get floor_number from the _FLnn id and always have topology arrays', () => {
    expect(normalizeFloor('ENG_MAIN_FL02', { building_id: 'ENG_MAIN' })).toEqual({
      id: 'ENG_MAIN_FL02',
      building_id: 'ENG_MAIN',
      floor_number: 2,
      graph_topology: { nodes: [], edges: [] },
    });
    expect(normalizeFloor('X', { floor_number: '3', graph_topology: { nodes: 'bad' } })).toMatchObject({
      floor_number: 3,
      graph_topology: { nodes: [], edges: [] },
    });
    expect(normalizeFloor('NO_NUMBER', {}).floor_number).toBeNull();
  });
});
