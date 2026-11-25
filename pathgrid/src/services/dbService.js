/**
 * Firestore data access for PathGrid (PRD Section 3 & 5).
 *
 * Collections:
 *   buildings/{building_id}            building metadata + isMapUpdated flag
 *   floors/{building_id}_FL{nn}        one document per floor, packed graph_topology
 *
 * Public reads fall back to src/data/mockMapData.json when Firebase is not
 * configured or the network/cache cannot serve the request. Admin writes
 * always require a live, authenticated Firestore connection.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, requireDb } from './firebase';
import { buildBuildingGraph, floorDocId, validateTopology } from './graphBuilder';
import mockMapData from '../data/mockMapData.json';

export const BUILDINGS_COLLECTION = 'buildings';
export const FLOORS_COLLECTION = 'floors';

/* ------------------------------------------------------------------------- */
/* Mock data helpers                                                          */
/* ------------------------------------------------------------------------- */

const clone = (value) => JSON.parse(JSON.stringify(value));

export const getMockBuildings = () => clone(mockMapData.buildings);

export const getMockBuilding = (buildingId) => {
  const building = mockMapData.buildings.find((b) => b.building_id === buildingId);
  return building ? clone(building) : null;
};

export const getMockFloors = (buildingId) =>
  clone(
    mockMapData.floors
      .filter((floor) => floor.building_id === buildingId)
      .sort((a, b) => a.floor_number - b.floor_number),
  );

/* ------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* ------------------------------------------------------------------------- */

const buildingRef = (firestore, buildingId) => doc(firestore, BUILDINGS_COLLECTION, buildingId);

const floorRef = (firestore, buildingId, floorNumber) =>
  doc(firestore, FLOORS_COLLECTION, floorDocId(buildingId, floorNumber));

const FLOOR_ID_PATTERN = /_FL(\d+)$/;

/**
 * Fills in fields that minimal / hand-made building documents may lack:
 * building_id falls back to the document id, building_name to `name`.
 */
export const normalizeBuilding = (id, data = {}) => {
  const buildingId = typeof data.building_id === 'string' && data.building_id.trim()
    ? data.building_id
    : id;
  return {
    ...data,
    id,
    building_id: buildingId,
    building_name: data.building_name ?? data.name ?? buildingId,
  };
};

/**
 * Fills in floor fields: floor_number falls back to the "_FLnn" suffix of the
 * document id, and graph_topology always has nodes/edges arrays.
 */
export const normalizeFloor = (id, data = {}) => {
  const raw = data.floor_number;
  const parsed = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  const fromId = FLOOR_ID_PATTERN.exec(id ?? '');
  let floorNumber = null;
  if (Number.isInteger(parsed)) floorNumber = parsed;
  else if (fromId) floorNumber = Number(fromId[1]);
  const topology = data.graph_topology ?? {};
  return {
    ...data,
    id,
    floor_number: floorNumber,
    graph_topology: {
      nodes: Array.isArray(topology.nodes) ? topology.nodes : [],
      edges: Array.isArray(topology.edges) ? topology.edges : [],
    },
  };
};

const buildingFromSnapshot = (snap) => (snap.exists() ? normalizeBuilding(snap.id, snap.data()) : null);
const floorFromSnapshot = (snap) => (snap.exists() ? normalizeFloor(snap.id, snap.data()) : null);

/** Fields written whenever an admin changes anything a navigating user relies on. */
const mapUpdatedFields = () => ({
  isMapUpdated: true,
  last_updated_timestamp: new Date().toISOString(),
});

const assertBuildingId = (buildingId) => {
  if (!buildingId || typeof buildingId !== 'string') {
    throw new TypeError('buildingId must be a non-empty string.');
  }
};

/* ------------------------------------------------------------------------- */
/* Public reads                                                               */
/* ------------------------------------------------------------------------- */

/** Lists all buildings (metadata only). */
export const listBuildings = async () => {
  if (!isFirebaseConfigured) return getMockBuildings();
  const snap = await getDocs(collection(db, BUILDINGS_COLLECTION));
  return snap.docs.map(buildingFromSnapshot);
};

/** Reads one building's metadata, or null if it does not exist. */
export const getBuilding = async (buildingId) => {
  assertBuildingId(buildingId);
  if (!isFirebaseConfigured) return getMockBuilding(buildingId);
  return buildingFromSnapshot(await getDoc(buildingRef(db, buildingId)));
};

/** Reads one floor document, or null if it does not exist. */
export const getFloor = async (buildingId, floorNumber) => {
  assertBuildingId(buildingId);
  if (!isFirebaseConfigured) {
    return getMockFloors(buildingId).find((f) => f.floor_number === floorNumber) ?? null;
  }
  return floorFromSnapshot(await getDoc(floorRef(db, buildingId, floorNumber)));
};

/**
 * Reads every floor of a building, sorted by floor_number. Sorting happens
 * client-side so no composite Firestore index is required. Resolves to an
 * empty array when the building has no floors yet; floor documents whose
 * floor number cannot be determined are skipped.
 */
export const getBuildingFloors = async (buildingId) => {
  assertBuildingId(buildingId);
  if (!isFirebaseConfigured) return getMockFloors(buildingId);
  const snap = await getDocs(
    query(collection(db, FLOORS_COLLECTION), where('building_id', '==', buildingId)),
  );
  return snap.docs
    .map(floorFromSnapshot)
    .filter((floor) => floor && floor.floor_number !== null)
    .sort((a, b) => a.floor_number - b.floor_number);
};

/**
 * Loads everything the public map needs for one building and merges the
 * floors into a single routable graph for aStarEngine.
 *
 * Firestore's persistent cache serves previously loaded data offline; if
 * neither the network nor the cache can answer, bundled mock data is used
 * when it contains the requested building.
 *
 * @returns {Promise<{ building: object, floors: object[], graph: {nodes, edges},
 *                     source: 'firestore' | 'mock' }>}
 */
export const loadBuildingGraph = async (buildingId) => {
  assertBuildingId(buildingId);

  const fromMock = () => {
    const building = getMockBuilding(buildingId);
    if (!building) {
      throw new Error(`Building "${buildingId}" is not available offline.`);
    }
    const floors = getMockFloors(buildingId);
    return {
      building,
      floors,
      graph: buildBuildingGraph(floors, building.transition_weights),
      source: 'mock',
    };
  };

  if (!isFirebaseConfigured) return fromMock();

  try {
    const [building, floors] = await Promise.all([
      getBuilding(buildingId),
      getBuildingFloors(buildingId),
    ]);
    if (!building) throw new Error(`Building "${buildingId}" was not found.`);
    return {
      building,
      floors,
      graph: buildBuildingGraph(floors, building.transition_weights),
      source: 'firestore',
    };
  } catch (error) {
    if (getMockBuilding(buildingId)) {
      // eslint-disable-next-line no-console
      console.warn(`[PathGrid] Falling back to mock data for "${buildingId}".`, error);
      return fromMock();
    }
    throw error;
  }
};

/* ------------------------------------------------------------------------- */
/* Real-time listeners (PRD 5.2)                                              */
/* ------------------------------------------------------------------------- */

/**
 * Streams a building's metadata document. Returns an unsubscribe function.
 * Without Firebase, emits the mock building once and returns a no-op.
 */
export const subscribeToBuilding = (buildingId, onChange, onError) => {
  assertBuildingId(buildingId);
  if (!isFirebaseConfigured) {
    onChange(getMockBuilding(buildingId));
    return () => {};
  }
  return onSnapshot(
    buildingRef(db, buildingId),
    (snap) => onChange(buildingFromSnapshot(snap)),
    (error) => onError?.(error),
  );
};

/**
 * Calls `onMapUpdated(building)` whenever an admin publishes a change
 * (isMapUpdated set and last_updated_timestamp moved) after the listener's
 * first snapshot. The UI uses this to re-fetch floors and re-run routing.
 * Returns an unsubscribe function.
 */
export const subscribeToMapUpdates = (buildingId, onMapUpdated, onError) => {
  let baseline;
  return subscribeToBuilding(
    buildingId,
    (building) => {
      if (!building) return;
      const stamp = building.last_updated_timestamp ?? null;
      if (baseline === undefined) {
        baseline = stamp;
        return;
      }
      if (building.isMapUpdated && stamp !== baseline) {
        baseline = stamp;
        onMapUpdated(building);
      }
    },
    onError,
  );
};

/* ------------------------------------------------------------------------- */
/* Admin writes (require an authenticated admin + Firestore security rules)   */
/* ------------------------------------------------------------------------- */

/**
 * Creates or merges building metadata.
 */
export const saveBuildingMetadata = async (buildingId, metadata) => {
  assertBuildingId(buildingId);
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.set(
    buildingRef(firestore, buildingId),
    { ...metadata, building_id: buildingId, ...mapUpdatedFields() },
    { merge: true },
  );
  await batch.commit();
};

/**
 * Replaces a floor's packed graph_topology after validation and flags the
 * building as updated, atomically.
 */
export const saveFloorTopology = async (buildingId, floorNumber, graphTopology) => {
  assertBuildingId(buildingId);
  const { valid, errors } = validateTopology(graphTopology);
  if (!valid) throw new Error(`Invalid graph_topology:\n- ${errors.join('\n- ')}`);

  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.set(
    floorRef(firestore, buildingId, floorNumber),
    {
      building_id: buildingId,
      floor_number: floorNumber,
      graph_topology: { nodes: graphTopology.nodes, edges: graphTopology.edges },
    },
    { merge: true },
  );
  batch.update(buildingRef(firestore, buildingId), mapUpdatedFields());
  await batch.commit();
};

/**
 * Stores the Cloud Storage URL of a floor's blueprint image.
 */
export const saveFloorPlanImageUrl = async (buildingId, floorNumber, imageUrl) => {
  assertBuildingId(buildingId);
  if (typeof imageUrl !== 'string' || imageUrl === '') {
    throw new TypeError('imageUrl must be a non-empty string.');
  }
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.set(
    floorRef(firestore, buildingId, floorNumber),
    { building_id: buildingId, floor_number: floorNumber, floor_plan_image_url: imageUrl },
    { merge: true },
  );
  batch.update(buildingRef(firestore, buildingId), mapUpdatedFields());
  await batch.commit();
};

/**
 * Marks an elevator in or out of service on EVERY floor it serves. The
 * elevator is matched by `transition_id` (e.g. "ELEV_1") or by a node id.
 *
 * @returns {Promise<number>} number of elevator nodes updated
 */
export const setElevatorOutOfService = async (buildingId, elevatorKey, outOfService) => {
  assertBuildingId(buildingId);
  if (typeof outOfService !== 'boolean') throw new TypeError('outOfService must be a boolean.');
  const firestore = requireDb();

  // Discover the building's floor documents first (transactions cannot run
  // queries); the documents themselves are then read inside the transaction.
  // This does not depend on `total_floors`, which minimal documents may lack.
  const floorQuery = await getDocs(
    query(collection(firestore, FLOORS_COLLECTION), where('building_id', '==', buildingId)),
  );
  const refs = floorQuery.docs.map((floorDoc) => floorDoc.ref);

  return runTransaction(firestore, async (transaction) => {
    const bRef = buildingRef(firestore, buildingId);
    const buildingSnap = await transaction.get(bRef);
    if (!buildingSnap.exists()) throw new Error(`Building "${buildingId}" was not found.`);

    const floorSnaps = await Promise.all(refs.map((ref) => transaction.get(ref)));

    let updatedCount = 0;
    floorSnaps.forEach((snap, index) => {
      if (!snap.exists()) return;
      const topology = snap.data().graph_topology ?? { nodes: [], edges: [] };
      let changed = false;
      const nodes = (topology.nodes ?? []).map((node) => {
        const matches = node.type === 'elevator'
          && (node.transition_id === elevatorKey || node.id === elevatorKey);
        if (!matches) return node;
        updatedCount += 1;
        if (node.out_of_service === outOfService) return node;
        changed = true;
        return { ...node, out_of_service: outOfService };
      });
      if (changed) {
        transaction.update(refs[index], { graph_topology: { ...topology, nodes } });
      }
    });

    if (updatedCount === 0) {
      throw new Error(`No elevator "${elevatorKey}" found in building "${buildingId}".`);
    }
    transaction.update(bRef, mapUpdatedFields());
    return updatedCount;
  });
};

/**
 * Marks a corridor (edge) on one floor in or out of service. The edge is
 * matched in either direction.
 */
export const setEdgeOutOfService = async (
  buildingId,
  floorNumber,
  sourceId,
  targetId,
  outOfService,
) => {
  assertBuildingId(buildingId);
  if (typeof outOfService !== 'boolean') throw new TypeError('outOfService must be a boolean.');
  const firestore = requireDb();

  await runTransaction(firestore, async (transaction) => {
    const fRef = floorRef(firestore, buildingId, floorNumber);
    const snap = await transaction.get(fRef);
    if (!snap.exists()) {
      throw new Error(`Floor ${floorNumber} of "${buildingId}" was not found.`);
    }
    const topology = snap.data().graph_topology ?? { nodes: [], edges: [] };
    let found = false;
    const edges = topology.edges.map((edge) => {
      const matches = (edge.source === sourceId && edge.target === targetId)
        || (edge.source === targetId && edge.target === sourceId);
      if (!matches) return edge;
      found = true;
      return { ...edge, out_of_service: outOfService };
    });
    if (!found) throw new Error(`No edge between "${sourceId}" and "${targetId}" on floor ${floorNumber}.`);

    transaction.update(fRef, { graph_topology: { ...topology, edges } });
    transaction.update(buildingRef(firestore, buildingId), mapUpdatedFields());
  });
};

/**
 * Writes every building and floor from mockMapData.json to Firestore. Useful
 * for populating a fresh development project from the admin panel.
 *
 * @returns {Promise<{ buildings: number, floors: number }>}
 */
export const seedMockData = async () => {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  mockMapData.buildings.forEach((building) => {
    batch.set(buildingRef(firestore, building.building_id), building);
  });
  mockMapData.floors.forEach((floor) => {
    batch.set(floorRef(firestore, floor.building_id, floor.floor_number), floor);
  });
  await batch.commit();
  return { buildings: mockMapData.buildings.length, floors: mockMapData.floors.length };
};
