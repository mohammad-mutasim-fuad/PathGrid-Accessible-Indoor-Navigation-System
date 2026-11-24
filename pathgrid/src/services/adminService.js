/**
 * Admin data layer.
 *
 * The admin UI talks to a "repository" with one interface and two backends:
 *  - live: delegates to dbService.js (Firestore writes, guarded by security rules)
 *  - demo: an in-memory copy of mockMapData.json, used only when Firebase is
 *          not configured so the portal can be explored during development.
 *          Demo changes live in this browser tab and are never persisted.
 */
import {
  getBuilding,
  getBuildingFloors,
  listBuildings,
  saveFloorTopology,
  setEdgeOutOfService,
  setElevatorOutOfService,
} from './dbService';
import { applyEdgeOutOfService, applyElevatorOutOfService } from './topologyEditor';
import mockMapData from '../data/mockMapData.json';

const clone = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------------- */
/* Repositories                                                               */
/* ------------------------------------------------------------------------- */

export const liveAdminRepository = Object.freeze({
  mode: 'live',
  listBuildings: () => listBuildings(),
  loadBuilding: async (buildingId) => {
    const [building, floors] = await Promise.all([getBuilding(buildingId), getBuildingFloors(buildingId)]);
    if (!building) throw new Error(`Building "${buildingId}" was not found.`);
    return { building, floors };
  },
  setElevatorOutOfService: (buildingId, elevatorKey, outOfService) =>
    setElevatorOutOfService(buildingId, elevatorKey, outOfService),
  setEdgeOutOfService: (buildingId, floorNumber, sourceId, targetId, outOfService) =>
    setEdgeOutOfService(buildingId, floorNumber, sourceId, targetId, outOfService),
  saveFloorTopology: (buildingId, floorNumber, topology) =>
    saveFloorTopology(buildingId, floorNumber, topology),
});

/**
 * Creates an in-memory repository seeded from `seed` (defaults to the bundled
 * mock data). Methods are async to match the live repository.
 */
export const createDemoAdminRepository = (seed = mockMapData) => {
  const store = clone(seed);

  const findBuilding = (buildingId) => {
    const building = store.buildings.find((b) => b.building_id === buildingId);
    if (!building) throw new Error(`Building "${buildingId}" was not found.`);
    return building;
  };
  const buildingFloors = (buildingId) => store.floors
    .filter((floor) => floor.building_id === buildingId)
    .sort((a, b) => a.floor_number - b.floor_number);
  const touch = (building) => {
    building.isMapUpdated = true;
    building.last_updated_timestamp = new Date().toISOString();
  };
  const replaceFloors = (buildingId, nextFloors) => {
    store.floors = [
      ...store.floors.filter((floor) => floor.building_id !== buildingId),
      ...nextFloors,
    ];
  };

  return {
    mode: 'demo',
    listBuildings: async () => clone(store.buildings),
    loadBuilding: async (buildingId) => ({
      building: clone(findBuilding(buildingId)),
      floors: clone(buildingFloors(buildingId)),
    }),
    setElevatorOutOfService: async (buildingId, elevatorKey, outOfService) => {
      const building = findBuilding(buildingId);
      const { floors, updated } = applyElevatorOutOfService(
        buildingFloors(buildingId),
        elevatorKey,
        outOfService,
      );
      if (updated === 0) {
        throw new Error(`No elevator "${elevatorKey}" found in building "${buildingId}".`);
      }
      replaceFloors(buildingId, floors);
      touch(building);
      return updated;
    },
    setEdgeOutOfService: async (buildingId, floorNumber, sourceId, targetId, outOfService) => {
      const building = findBuilding(buildingId);
      const floors = buildingFloors(buildingId).map((floor) => (floor.floor_number === floorNumber
        ? {
          ...floor,
          graph_topology: applyEdgeOutOfService(floor.graph_topology, sourceId, targetId, outOfService),
        }
        : floor));
      if (!floors.some((floor) => floor.floor_number === floorNumber)) {
        throw new Error(`Floor ${floorNumber} of "${buildingId}" was not found.`);
      }
      replaceFloors(buildingId, floors);
      touch(building);
    },
    saveFloorTopology: async (buildingId, floorNumber, topology) => {
      const building = findBuilding(buildingId);
      const floors = buildingFloors(buildingId);
      const exists = floors.some((floor) => floor.floor_number === floorNumber);
      const nextFloors = exists
        ? floors.map((floor) => (floor.floor_number === floorNumber
          ? { ...floor, graph_topology: clone(topology) }
          : floor))
        : [...floors, {
          building_id: buildingId, floor_number: floorNumber, floor_plan_image_url: '', graph_topology: clone(topology),
        }];
      replaceFloors(buildingId, nextFloors);
      touch(building);
    },
  };
};

let demoRepository = null;

/** Shared demo repository so changes survive navigation within the session. */
export const getDemoAdminRepository = () => {
  if (!demoRepository) demoRepository = createDemoAdminRepository();
  return demoRepository;
};

/** Discards demo changes (used on demo logout and in tests). */
export const resetDemoAdminRepository = () => {
  demoRepository = null;
};

/* ------------------------------------------------------------------------- */
/* Read models for the dashboard                                              */
/* ------------------------------------------------------------------------- */

/** Aggregate counts for a building. */
export const summarizeBuilding = (building, floors) => {
  const nodes = floors.flatMap((floor) => floor.graph_topology?.nodes ?? []);
  const edges = floors.flatMap((floor) => floor.graph_topology?.edges ?? []);
  const elevators = listElevators(floors);
  return {
    buildingName: building?.building_name ?? building?.building_id ?? '',
    floorCount: floors.length,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    destinations: nodes.filter((node) => ['room', 'restroom', 'entrance'].includes(node.type)).length,
    elevatorCount: elevators.length,
    elevatorsOutOfService: elevators.filter((elevator) => elevator.outOfService).length,
    closedPassages: edges.filter((edge) => edge.out_of_service === true).length,
    lastUpdated: building?.last_updated_timestamp ?? null,
  };
};

/**
 * Elevators grouped by shaft (transition_id), each listing the floors it
 * serves. An elevator counts as out of service if any of its nodes is.
 */
export function listElevators(floors) {
  const groups = new Map();
  floors.forEach((floor) => {
    (floor.graph_topology?.nodes ?? [])
      .filter((node) => node.type === 'elevator')
      .forEach((node) => {
        const key = node.transition_id ?? node.id;
        if (!groups.has(key)) {
          groups.set(key, { key, name: node.name ?? key, floors: [], outOfService: false });
        }
        const group = groups.get(key);
        group.floors.push(floor.floor_number);
        group.outOfService = group.outOfService || node.out_of_service === true;
      });
  });
  return [...groups.values()]
    .map((group) => ({ ...group, floors: group.floors.sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A floor's edges with human-readable endpoint names, for closure toggles. */
export const listFloorEdges = (floor) => {
  const nodes = floor?.graph_topology?.nodes ?? [];
  const nameOf = new Map(nodes.map((node) => [node.id, node.name ?? node.id]));
  return (floor?.graph_topology?.edges ?? []).map((edge) => ({
    key: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: `${nameOf.get(edge.source) ?? edge.source} ↔ ${nameOf.get(edge.target) ?? edge.target}`,
    type: edge.type ?? 'corridor',
    isAccessible: edge.is_accessible !== false,
    outOfService: edge.out_of_service === true,
  }));
};

/** Locale-formatted timestamp, or a fallback for missing/invalid values. */
export const formatTimestamp = (value, fallback = 'Never') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
