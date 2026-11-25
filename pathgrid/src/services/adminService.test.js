import * as dbService from './dbService';
import {
  createDemoAdminRepository,
  describeFirestoreError,
  formatTimestamp,
  getDemoAdminRepository,
  listElevators,
  listFloorEdges,
  liveAdminRepository,
  normalizeBuildingList,
  resetDemoAdminRepository,
  resolveBuildingId,
  summarizeBuilding,
  withTimeout,
} from './adminService';
import mockMapData from '../data/mockMapData.json';

jest.mock('./dbService', () => {
  const actual = jest.requireActual('./dbService');
  const mocked = jest.createMockFromModule('./dbService');
  // Keep the pure normalizer real; mock everything that touches Firestore.
  return { ...mocked, normalizeBuilding: actual.normalizeBuilding };
});

describe('minimal / partial Firestore documents', () => {
  test('normalizeBuildingList falls back to the doc id and "name"', () => {
    expect(normalizeBuildingList([{ id: 'ENG_MAIN', name: 'Engineering Main Building' }])).toEqual([
      {
        id: 'ENG_MAIN', name: 'Engineering Main Building', building_id: 'ENG_MAIN', building_name: 'Engineering Main Building',
      },
    ]);
    expect(normalizeBuildingList(null)).toEqual([]);
    expect(normalizeBuildingList([null, {}])).toEqual([]);
  });

  test('resolveBuildingId picks the requested building or the first one', () => {
    const list = [{ building_id: 'A' }, { id: 'B' }];
    expect(resolveBuildingId(list, 'B')).toBe('B');
    expect(resolveBuildingId(list, 'MISSING')).toBe('A');
    expect(resolveBuildingId([], 'A')).toBeNull();
  });

  test('live loadBuilding resolves for a building with no floors yet', async () => {
    dbService.getBuilding.mockResolvedValue({ id: 'ENG_MAIN', name: 'Engineering Main Building' });
    dbService.getBuildingFloors.mockResolvedValue([]);
    await expect(liveAdminRepository.loadBuilding('ENG_MAIN')).resolves.toEqual({
      building: expect.objectContaining({ building_id: 'ENG_MAIN', building_name: 'Engineering Main Building' }),
      floors: [],
    });
  });

  test('live listBuildings normalizes raw documents', async () => {
    dbService.listBuildings.mockResolvedValue([{ id: 'ENG_MAIN', name: 'Engineering Main Building' }]);
    const [building] = await liveAdminRepository.listBuildings();
    expect(building).toMatchObject({ building_id: 'ENG_MAIN', building_name: 'Engineering Main Building' });
  });

  test('withTimeout rejects stalled promises and passes through settled ones', async () => {
    jest.useFakeTimers();
    const stalled = withTimeout(new Promise(() => {}), 1000, 'Loading timed out.');
    jest.advanceTimersByTime(1000);
    await expect(stalled).rejects.toThrow('Loading timed out.');
    jest.useRealTimers();
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  test('describeFirestoreError explains permission problems', () => {
    expect(describeFirestoreError({ code: 'permission-denied' })).toMatch(/admins\/\{uid\}.*building_id/);
    expect(describeFirestoreError(new Error('boom'))).toBe('boom');
  });

  test('live seedSampleData calls dbService.seedMockData', async () => {
    dbService.seedMockData.mockResolvedValue({ buildings: 1, floors: 3 });
    await expect(liveAdminRepository.seedSampleData()).resolves.toEqual({ buildings: 1, floors: 3 });
  });

  test('demo seedSampleData restores the sample building', async () => {
    const repo = createDemoAdminRepository();
    await repo.saveFloorTopology('ENG_MAIN', 1, { nodes: [], edges: [] });
    await repo.seedSampleData();
    const { floors } = await repo.loadBuilding('ENG_MAIN');
    expect(floors[0].graph_topology.nodes.length).toBe(18);
  });
});

describe('liveAdminRepository delegates to dbService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('setElevatorOutOfService', async () => {
    dbService.setElevatorOutOfService.mockResolvedValue(3);
    await expect(liveAdminRepository.setElevatorOutOfService('ENG_MAIN', 'ELEV_1', true)).resolves.toBe(3);
    expect(dbService.setElevatorOutOfService).toHaveBeenCalledWith('ENG_MAIN', 'ELEV_1', true);
  });

  test('setEdgeOutOfService', async () => {
    await liveAdminRepository.setEdgeOutOfService('ENG_MAIN', 2, 'F2_HALL_1', 'F2_HALL_2', true);
    expect(dbService.setEdgeOutOfService).toHaveBeenCalledWith('ENG_MAIN', 2, 'F2_HALL_1', 'F2_HALL_2', true);
  });

  test('saveFloorTopology', async () => {
    const topology = { nodes: [], edges: [] };
    await liveAdminRepository.saveFloorTopology('ENG_MAIN', 1, topology);
    expect(dbService.saveFloorTopology).toHaveBeenCalledWith('ENG_MAIN', 1, topology);
  });

  test('loadBuilding reads building and floors without mock fallback', async () => {
    dbService.getBuilding.mockResolvedValue({ building_id: 'B' });
    dbService.getBuildingFloors.mockResolvedValue([{ floor_number: 1 }]);
    await expect(liveAdminRepository.loadBuilding('B')).resolves.toEqual({
      building: { id: 'B', building_id: 'B', building_name: 'B' }, floors: [{ floor_number: 1 }],
    });

    dbService.getBuilding.mockResolvedValue(null);
    await expect(liveAdminRepository.loadBuilding('B')).rejects.toThrow(/not found/);
  });
});

describe('demo repository', () => {
  beforeEach(() => resetDemoAdminRepository());

  test('toggles an elevator on every floor and stamps the building', async () => {
    const repo = createDemoAdminRepository();
    const before = (await repo.loadBuilding('ENG_MAIN')).building.last_updated_timestamp;
    await expect(repo.setElevatorOutOfService('ENG_MAIN', 'ELEV_1', true)).resolves.toBe(3);

    const { building, floors } = await repo.loadBuilding('ENG_MAIN');
    expect(listElevators(floors).find((e) => e.key === 'ELEV_1').outOfService).toBe(true);
    expect(building.isMapUpdated).toBe(true);
    expect(building.last_updated_timestamp).not.toBe(before);
  });

  test('rejects unknown elevators and buildings', async () => {
    const repo = createDemoAdminRepository();
    await expect(repo.setElevatorOutOfService('ENG_MAIN', 'NOPE', true)).rejects.toThrow(/No elevator/);
    await expect(repo.loadBuilding('NOPE')).rejects.toThrow(/not found/);
  });

  test('closes an edge on one floor', async () => {
    const repo = createDemoAdminRepository();
    await repo.setEdgeOutOfService('ENG_MAIN', 1, 'F1_HALL_2', 'F1_HALL_1', true);
    const { floors } = await repo.loadBuilding('ENG_MAIN');
    const edge = listFloorEdges(floors[0]).find((e) => e.source === 'F1_HALL_1' && e.target === 'F1_HALL_2');
    expect(edge.outOfService).toBe(true);
  });

  test('saves a topology and never mutates the seed data', async () => {
    const repo = createDemoAdminRepository();
    await repo.saveFloorTopology('ENG_MAIN', 2, { nodes: [], edges: [] });
    const { floors } = await repo.loadBuilding('ENG_MAIN');
    expect(floors.find((f) => f.floor_number === 2).graph_topology.nodes).toEqual([]);
    expect(mockMapData.floors[1].graph_topology.nodes.length).toBeGreaterThan(0);
  });

  test('the shared demo repository persists until reset', async () => {
    await getDemoAdminRepository().setElevatorOutOfService('ENG_MAIN', 'ELEV_1', true);
    let floors = (await getDemoAdminRepository().loadBuilding('ENG_MAIN')).floors;
    expect(listElevators(floors)[0].outOfService).toBe(true);

    resetDemoAdminRepository();
    floors = (await getDemoAdminRepository().loadBuilding('ENG_MAIN')).floors;
    expect(listElevators(floors)[0].outOfService).toBe(false);
  });
});

describe('dashboard read models', () => {
  const [building] = mockMapData.buildings;

  test('summarizeBuilding counts nodes, edges and elevators', () => {
    expect(summarizeBuilding(building, mockMapData.floors)).toMatchObject({
      buildingName: 'Engineering Complex',
      floorCount: 3,
      totalNodes: 51,
      totalEdges: 49,
      elevatorCount: 2,
      elevatorsOutOfService: 1,
      closedPassages: 0,
      lastUpdated: '2026-08-01T10:30:00Z',
    });
  });

  test('listElevators groups shafts across floors', () => {
    expect(listElevators(mockMapData.floors)).toEqual([
      {
        key: 'ELEV_1', name: 'Elevator 1 (Central)', floors: [1, 2, 3], outOfService: false,
      },
      {
        key: 'ELEV_2', name: 'Elevator 2 (East)', floors: [1, 2, 3], outOfService: true,
      },
    ]);
  });

  test('listFloorEdges labels endpoints by name', () => {
    expect(listFloorEdges(mockMapData.floors[0])[0]).toMatchObject({
      label: 'Hallway 1-A ↔ Hallway 1-B', type: 'corridor', isAccessible: true, outOfService: false,
    });
    expect(listFloorEdges(null)).toEqual([]);
  });

  test('formatTimestamp handles missing and invalid values', () => {
    expect(formatTimestamp(null)).toBe('Never');
    expect(formatTimestamp('garbage', '—')).toBe('—');
    expect(formatTimestamp('2026-08-01T10:30:00Z')).toMatch(/2026/);
  });
});
