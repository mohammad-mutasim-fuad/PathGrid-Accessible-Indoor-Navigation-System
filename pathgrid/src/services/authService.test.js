/*
 * Runs without REACT_APP_FIREBASE_* variables, i.e. the unconfigured case.
 */
import {
  DEMO_ADMIN_USER,
  describeAuthError,
  endDemoSession,
  getAdminAuth,
  hasDemoSession,
  isDemoModeAvailable,
  signInAdmin,
  startDemoSession,
  toAdminUser,
} from './authService';

describe('authService without Firebase configuration', () => {
  beforeEach(() => window.sessionStorage.clear());

  test('demo mode is available and sessions round-trip through sessionStorage', () => {
    expect(isDemoModeAvailable()).toBe(true);
    expect(hasDemoSession()).toBe(false);
    expect(startDemoSession()).toEqual(DEMO_ADMIN_USER);
    expect(hasDemoSession()).toBe(true);
    endDemoSession();
    expect(hasDemoSession()).toBe(false);
  });

  test('real auth calls fail with the configuration message', async () => {
    expect(() => getAdminAuth()).toThrow(/Firebase is not configured/);
    await expect(signInAdmin('a@b.c', 'pw')).rejects.toThrow(/Firebase is not configured/);
  });

  test('signInAdmin validates input before calling Firebase', async () => {
    await expect(signInAdmin('  ', 'pw')).rejects.toThrow('Enter your email address and password.');
    await expect(signInAdmin('a@b.c', '')).rejects.toThrow('Enter your email address and password.');
  });
});

describe('helpers', () => {
  test('describeAuthError maps Firebase codes to friendly messages', () => {
    expect(describeAuthError({ code: 'auth/invalid-credential' })).toBe('Incorrect email or password.');
    expect(describeAuthError({ code: 'auth/too-many-requests' })).toMatch(/Too many attempts/);
    expect(describeAuthError({ code: 'auth/other', message: 'Boom' })).toBe('Boom');
    expect(describeAuthError(undefined)).toBe('Sign-in failed. Please try again.');
  });

  test('toAdminUser keeps only serialisable fields', () => {
    expect(toAdminUser(null)).toBeNull();
    expect(toAdminUser({
      uid: 'u1', email: 'a@b.c', displayName: null, metadata: { lastSignInTime: 'x', creationTime: 'y' }, getIdToken: () => {},
    })).toEqual({
      uid: 'u1', email: 'a@b.c', displayName: '', lastSignInTime: 'x', creationTime: 'y', isDemo: false,
    });
  });
});
