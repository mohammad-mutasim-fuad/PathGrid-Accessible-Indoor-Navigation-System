/**
 * Admin authentication (Firebase Email/Password).
 *
 * Only the lazily loaded admin portal imports this module, so firebase/auth
 * stays out of the public map bundle.
 *
 * Demo mode: when Firebase is NOT configured, a local demo session can be
 * started so the portal can be explored during development. It is refused
 * whenever Firebase is configured, so it can never bypass real sign-in.
 */
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { app, firebaseConfigError, isFirebaseConfigured } from './firebase';

const DEMO_SESSION_KEY = 'pathgrid.adminDemoSession';

export const DEMO_ADMIN_USER = Object.freeze({
  uid: 'demo-admin',
  email: 'demo@pathgrid.local',
  displayName: 'Demo Administrator',
  lastSignInTime: null,
  creationTime: null,
  isDemo: true,
});

let authInstance = null;

/** Firebase Auth instance; throws a descriptive error if unconfigured. */
export const getAdminAuth = () => {
  if (!isFirebaseConfigured) throw new Error(firebaseConfigError);
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
};

/** Plain, serialisable view of a Firebase user. */
export const toAdminUser = (user) => (user
  ? {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    lastSignInTime: user.metadata?.lastSignInTime ?? null,
    creationTime: user.metadata?.creationTime ?? null,
    isDemo: false,
  }
  : null);

/**
 * Listens for sign-in state changes. Returns an unsubscribe function.
 * @param {(user: object|null) => void} callback
 */
export const subscribeToAuthChanges = (callback, onError) =>
  onAuthStateChanged(getAdminAuth(), (user) => callback(toAdminUser(user)), onError);

export const signInAdmin = async (email, password) => {
  const trimmedEmail = (email ?? '').trim();
  if (!trimmedEmail || !password) throw new Error('Enter your email address and password.');
  const credential = await signInWithEmailAndPassword(getAdminAuth(), trimmedEmail, password);
  return toAdminUser(credential.user);
};

export const signOutAdmin = () => signOut(getAdminAuth());

const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-disabled': 'This account has been disabled. Contact your facility administrator.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

/** User-facing message for a sign-in error. */
export const describeAuthError = (error) =>
  AUTH_ERROR_MESSAGES[error?.code] ?? error?.message ?? 'Sign-in failed. Please try again.';

/* ------------------------------------------------------------------------- */
/* Demo session (only when Firebase is not configured)                        */
/* ------------------------------------------------------------------------- */

const safeSessionStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const isDemoModeAvailable = () => !isFirebaseConfigured;

export const hasDemoSession = () => {
  if (!isDemoModeAvailable()) return false;
  try {
    return safeSessionStorage()?.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

export const startDemoSession = () => {
  if (!isDemoModeAvailable()) {
    throw new Error('Demo mode is disabled because Firebase is configured. Sign in with your admin account.');
  }
  try {
    safeSessionStorage()?.setItem(DEMO_SESSION_KEY, '1');
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
  return { ...DEMO_ADMIN_USER };
};

export const endDemoSession = () => {
  try {
    safeSessionStorage()?.removeItem(DEMO_SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
};
