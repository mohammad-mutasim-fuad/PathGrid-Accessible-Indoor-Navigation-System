import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isFirebaseConfigured } from '../../services/firebase';
import {
  DEMO_ADMIN_USER,
  endDemoSession,
  hasDemoSession,
  signInAdmin,
  signOutAdmin,
  startDemoSession,
  subscribeToAuthChanges,
} from '../../services/authService';
import { resetDemoAdminRepository } from '../../services/adminService';
import { AdminLoading } from './AdminUi';

const AdminAuthContext = createContext(null);

const initialState = () => {
  if (hasDemoSession()) return { status: 'signedIn', user: { ...DEMO_ADMIN_USER } };
  return { status: isFirebaseConfigured ? 'loading' : 'signedOut', user: null };
};

/**
 * Provides the admin session: { status: 'loading'|'signedIn'|'signedOut',
 * user, signIn, signOut, enterDemo }.
 */
export function AdminAuthProvider({ children }) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    return subscribeToAuthChanges(
      (user) => setState({ status: user ? 'signedIn' : 'signedOut', user }),
      () => setState({ status: 'signedOut', user: null }),
    );
  }, []);

  const signIn = useCallback(async (email, password) => {
    const user = await signInAdmin(email, password);
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const enterDemo = useCallback(() => {
    const user = startDemoSession();
    setState({ status: 'signedIn', user });
  }, []);

  const isDemo = state.user?.isDemo === true;

  const signOut = useCallback(async () => {
    if (isDemo) {
      endDemoSession();
      resetDemoAdminRepository();
    } else {
      await signOutAdmin();
    }
    setState({ status: 'signedOut', user: null });
  }, [isDemo]);

  const value = useMemo(() => ({
    status: state.status,
    user: state.user,
    isDemo,
    signIn,
    signOut,
    enterDemo,
  }), [state, isDemo, signIn, signOut, enterDemo]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>.');
  return context;
};

/**
 * Route guard: renders children for signed-in admins, otherwise redirects to
 * /admin/login and remembers where the user was heading.
 */
export function RequireAdmin({ children }) {
  const { status } = useAdminAuth();
  const location = useLocation();

  if (status === 'loading') return <AdminLoading label="Checking your session…" />;
  if (status !== 'signedIn') {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }
  return children;
}
