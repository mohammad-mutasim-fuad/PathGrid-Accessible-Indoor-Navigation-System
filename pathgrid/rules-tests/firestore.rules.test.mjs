/**
 * Firestore security rules tests. Run against the local emulator with:
 *
 *   npm run test:rules
 *
 * (wraps `firebase emulators:exec` around `node --test`; needs the Firebase
 * CLI and Java, no cloud project or credentials).
 */
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-pathgrid';
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const [EMULATOR_HOST, EMULATOR_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

const BUILDING = {
  building_id: 'ENG_MAIN',
  building_name: 'Engineering Complex',
  total_floors: 2,
  default_floor: 1,
  isMapUpdated: false,
  last_updated_timestamp: '2026-08-01T10:30:00Z',
  canvas_width: 1000,
  canvas_height: 600,
  units_per_meter: 10,
  transition_weights: { elevator: 10, stairs: 15 },
};

const FLOOR = {
  building_id: 'ENG_MAIN',
  floor_number: 1,
  floor_plan_image_url: '',
  graph_topology: {
    nodes: [{ id: 'N101', name: 'Main Entrance', x: 120, y: 450, type: 'entrance', is_accessible: true }],
    edges: [],
  },
};

let env;

/** Firestore clients for each kind of caller. */
const publicDb = () => env.unauthenticatedContext().firestore();
const userDb = () => env.authenticatedContext('visitor-1').firestore();
const listedAdminDb = () => env.authenticatedContext('admin-1').firestore();
const claimAdminDb = () => env.authenticatedContext('admin-2', { admin: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: EMULATOR_HOST, port: Number(EMULATOR_PORT) },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed with rules disabled: one building, one floor, one listed admin.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'buildings/ENG_MAIN'), BUILDING);
    await setDoc(doc(db, 'floors/ENG_MAIN_FL01'), FLOOR);
    await setDoc(doc(db, 'admins/admin-1'), { email: 'facilities@university.edu' });
  });
});

describe('public read access (zero login)', () => {
  test('anyone can read buildings and floors', async () => {
    await assertSucceeds(getDoc(doc(publicDb(), 'buildings/ENG_MAIN')));
    await assertSucceeds(getDoc(doc(publicDb(), 'floors/ENG_MAIN_FL01')));
  });

  test('anyone can list buildings and query floors by building', async () => {
    await assertSucceeds(getDocs(collection(publicDb(), 'buildings')));
    await assertSucceeds(getDocs(query(collection(publicDb(), 'floors'), where('building_id', '==', 'ENG_MAIN'))));
  });

  test('the admin list is not public', async () => {
    await assertFails(getDoc(doc(publicDb(), 'admins/admin-1')));
    await assertFails(getDocs(collection(publicDb(), 'admins')));
  });

  test('unknown collections are denied', async () => {
    await assertFails(getDoc(doc(publicDb(), 'secrets/x')));
    await assertFails(setDoc(doc(claimAdminDb(), 'secrets/x'), { a: 1 }));
  });
});

describe('writes require an authenticated admin', () => {
  test('unauthenticated visitors cannot write anything', async () => {
    const db = publicDb();
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: true }));
    await assertFails(setDoc(doc(db, 'floors/ENG_MAIN_FL02'), { ...FLOOR, floor_number: 2 }));
    await assertFails(deleteDoc(doc(db, 'floors/ENG_MAIN_FL01')));
  });

  test('signed-in users who are not admins cannot write', async () => {
    const db = userDb();
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: true }));
    await assertFails(updateDoc(doc(db, 'floors/ENG_MAIN_FL01'), { 'graph_topology.nodes': [] }));
    await assertFails(setDoc(doc(db, 'buildings/NEW'), { building_id: 'NEW' }));
  });

  test('admins listed in admins/{uid} can write', async () => {
    const db = listedAdminDb();
    await assertSucceeds(updateDoc(doc(db, 'buildings/ENG_MAIN'), {
      isMapUpdated: true, last_updated_timestamp: '2026-11-25T08:00:00.000Z',
    }));
    await assertSucceeds(setDoc(doc(db, 'floors/ENG_MAIN_FL02'), { ...FLOOR, floor_number: 2 }));
    await assertSucceeds(deleteDoc(doc(db, 'floors/ENG_MAIN_FL02')));
  });

  test('admins with the custom claim can write', async () => {
    await assertSucceeds(updateDoc(doc(claimAdminDb(), 'buildings/ENG_MAIN'), { isMapUpdated: true }));
  });

  test('a false admin claim grants nothing', async () => {
    const db = env.authenticatedContext('visitor-2', { admin: false }).firestore();
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: true }));
  });

  test('nobody can grant themselves admin from the client', async () => {
    await assertFails(setDoc(doc(userDb(), 'admins/visitor-1'), { email: 'me@example.com' }));
    await assertFails(setDoc(doc(listedAdminDb(), 'admins/visitor-1'), { email: 'me@example.com' }));
  });

  test('users can read only their own admin entry', async () => {
    await assertSucceeds(getDoc(doc(listedAdminDb(), 'admins/admin-1')));
    await assertSucceeds(getDoc(doc(userDb(), 'admins/visitor-1')));
    await assertFails(getDoc(doc(userDb(), 'admins/admin-1')));
  });
});

describe('the app\'s real write patterns pass', () => {
  test('saveFloorTopology: batch set(merge) floor + update building', async () => {
    const db = listedAdminDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'floors/ENG_MAIN_FL01'), {
      building_id: 'ENG_MAIN',
      floor_number: 1,
      graph_topology: { nodes: [], edges: [] },
    }, { merge: true });
    batch.update(doc(db, 'buildings/ENG_MAIN'), {
      isMapUpdated: true, last_updated_timestamp: '2026-11-25T08:00:00.000Z',
    });
    await assertSucceeds(batch.commit());
  });

  test('setElevatorOutOfService-style update of graph_topology', async () => {
    const nodes = [{ ...FLOOR.graph_topology.nodes[0], type: 'elevator', out_of_service: true }];
    await assertSucceeds(updateDoc(doc(listedAdminDb(), 'floors/ENG_MAIN_FL01'), {
      graph_topology: { nodes, edges: [] },
    }));
  });

  test('saveFloorPlanImageUrl creates a floor without a topology', async () => {
    await assertSucceeds(setDoc(doc(listedAdminDb(), 'floors/ENG_MAIN_FL02'), {
      building_id: 'ENG_MAIN', floor_number: 2, floor_plan_image_url: 'https://example.com/fl02.webp',
    }, { merge: true }));
  });

  test('seedMockData: building and its floors created in one batch', async () => {
    const db = claimAdminDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'buildings/SCI_HALL'), { ...BUILDING, building_id: 'SCI_HALL' });
    batch.set(doc(db, 'floors/SCI_HALL_FL01'), { ...FLOOR, building_id: 'SCI_HALL' });
    await assertSucceeds(batch.commit());
  });

  test('double-digit floors use the plain number', async () => {
    const db = listedAdminDb();
    await assertSucceeds(setDoc(doc(db, 'floors/ENG_MAIN_FL12'), { ...FLOOR, floor_number: 12 }));
  });
});

describe('admin writes are schema-validated', () => {
  test('floor id must match {building_id}_FL{nn}', async () => {
    const db = listedAdminDb();
    await assertFails(setDoc(doc(db, 'floors/ENG_MAIN_FL3'), { ...FLOOR, floor_number: 3 }));
    await assertFails(setDoc(doc(db, 'floors/WRONG_FL02'), { ...FLOOR, floor_number: 2 }));
  });

  test('floors must belong to an existing building', async () => {
    await assertFails(setDoc(doc(listedAdminDb(), 'floors/GHOST_FL01'), { ...FLOOR, building_id: 'GHOST' }));
  });

  test('unknown fields and wrong types are rejected', async () => {
    const db = listedAdminDb();
    await assertFails(setDoc(doc(db, 'floors/ENG_MAIN_FL02'), { ...FLOOR, floor_number: 2, extra: true }));
    await assertFails(setDoc(doc(db, 'floors/ENG_MAIN_FL02'), { ...FLOOR, floor_number: '2' }));
    await assertFails(updateDoc(doc(db, 'floors/ENG_MAIN_FL01'), { graph_topology: { nodes: 'x', edges: [] } }));
    await assertFails(updateDoc(doc(db, 'floors/ENG_MAIN_FL01'), {
      graph_topology: { nodes: [], edges: [], hacked: true },
    }));
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: 'yes' }));
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { owner: 'mallory' }));
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { units_per_meter: 0 }));
  });

  test('identity fields cannot be changed', async () => {
    const db = listedAdminDb();
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { building_id: 'OTHER' }));
    await assertFails(updateDoc(doc(db, 'floors/ENG_MAIN_FL01'), { floor_number: 2 }));
  });

  test('building_id must match the document id on create', async () => {
    await assertFails(setDoc(doc(listedAdminDb(), 'buildings/LIB'), { ...BUILDING, building_id: 'NOT_LIB' }));
    await assertSucceeds(setDoc(doc(listedAdminDb(), 'buildings/LIB'), { ...BUILDING, building_id: 'LIB' }));
  });
});

describe('minimal building documents (e.g. created by hand in the console)', () => {
  const seedBatch = (db) => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'buildings/ENG_MAIN'), BUILDING);
    batch.set(doc(db, 'floors/ENG_MAIN_FL01'), FLOOR);
    return batch;
  };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await deleteDoc(doc(db, 'floors/ENG_MAIN_FL01'));
      // The live document as reported: only a "name" field.
      await setDoc(doc(db, 'buildings/ENG_MAIN'), { name: 'Engineering Main Building' });
    });
  });

  test('it is still publicly readable', async () => {
    await assertSucceeds(getDoc(doc(publicDb(), 'buildings/ENG_MAIN')));
  });

  test('admin writes are rejected while it lacks building_id / has "name"', async () => {
    const db = listedAdminDb();
    await assertFails(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: true }));
    await assertFails(seedBatch(db).commit());
  });

  test('after adding building_id and removing "name", seeding and admin writes succeed', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'buildings/ENG_MAIN'), {
        building_id: 'ENG_MAIN', building_name: 'Engineering Main Building',
      });
    });
    const db = listedAdminDb();
    await assertSucceeds(seedBatch(db).commit());
    await assertSucceeds(updateDoc(doc(db, 'buildings/ENG_MAIN'), { isMapUpdated: true }));
  });

  test('deleting the minimal document lets the seed create it fresh', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'buildings/ENG_MAIN'));
    });
    await assertSucceeds(seedBatch(listedAdminDb()).commit());
  });
});
