import * as dbService from './dbService';
import {
  createDemoAdminRepository,
  formatTimestamp,
  getDemoAdminRepository,
  listElevators,
  listFloorEdges,
  liveAdminRepository,
  resetDemoAdminRepository,
  summarizeBuilding,
} from './adminService';
import mockMapData from '../data/mockMapData.json';

jest.mock('./dbService');

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
      building: { building_id: 'B' }, floors: [{ floor_number: 1 }],
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
