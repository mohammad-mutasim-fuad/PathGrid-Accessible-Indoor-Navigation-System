/**
 * Firebase initialisation (modular Web SDK v9+).
 *
 * Configuration comes from REACT_APP_FIREBASE_* variables (see .env.example).
 * When required variables are missing the module does NOT throw: it exports
 * `isFirebaseConfigured = false` and null service handles, so the public map
 * can still run from bundled mock data (src/data/mockMapData.json).
 *
 * Firestore uses a persistent IndexedDB cache with multi-tab support, so
 * previously loaded floor documents remain readable when the PWA is offline.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const ENV_KEYS = {
  apiKey: 'REACT_APP_FIREBASE_API_KEY',
  authDomain: 'REACT_APP_FIREBASE_AUTH_DOMAIN',
  projectId: 'REACT_APP_FIREBASE_PROJECT_ID',
  storageBucket: 'REACT_APP_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REACT_APP_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REACT_APP_FIREBASE_APP_ID',
};

/** Keys without which the app cannot reach Firestore/Auth at all. */
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

/*
 * CRA only inlines env vars that are referenced literally as
 * `process.env.REACT_APP_...`, so each one must be spelled out here.
 */
const rawConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const firebaseConfig = Object.fromEntries(
  Object.entries(rawConfig)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
    .filter(([, value]) => value !== ''),
);

const missingKeys = REQUIRED_CONFIG_KEYS.filter((key) => !firebaseConfig[key]);

export const isFirebaseConfigured = missingKeys.length === 0;

export const firebaseConfigError = isFirebaseConfigured
  ? null
  : `Firebase is not configured. Missing: ${missingKeys
      .map((key) => ENV_KEYS[key])
      .join(', ')}. Add them to pathgrid/.env (see .env.example) and restart the dev server. `
    + 'The public map will use bundled mock data until then.';

const canUseIndexedDB = () => {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  } catch {
    return false;
  }
};

/**
 * Creates the Firestore instance with an offline-capable cache. Falls back to
 * an in-memory cache where IndexedDB is unavailable (some private-browsing
 * modes, test environments). If Firestore was already initialised (e.g. hot
 * module reload), the existing instance is reused.
 */
const createFirestore = (firebaseApp) => {
  const localCache = canUseIndexedDB()
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache();

  try {
    return initializeFirestore(firebaseApp, { localCache });
  } catch (error) {
    // initializeFirestore throws if called twice for the same app.
    if (error?.code === 'failed-precondition') return getFirestore(firebaseApp);
    // eslint-disable-next-line no-console
    console.warn('[PathGrid] Persistent Firestore cache unavailable; using memory cache.', error);
    return initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });
  }
};

let app = null;
let db = null;
let auth = null;
let storage = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  db = createFirestore(app);
  // getAuth persists admin sessions in IndexedDB (falls back to localStorage).
  auth = getAuth(app);
  storage = firebaseConfig.storageBucket ? getStorage(app) : null;
} else if (process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.warn(`[PathGrid] ${firebaseConfigError}`);
}

/**
 * Returns the Firestore instance or throws a descriptive error. Use in code
 * paths that genuinely require a live backend (admin writes).
 */
export const requireDb = () => {
  if (!db) throw new Error(firebaseConfigError);
  return db;
};

/** Returns the Auth instance or throws a descriptive error. */
export const requireAuth = () => {
  if (!auth) throw new Error(firebaseConfigError);
  return auth;
};

export { app, db, auth, storage };
