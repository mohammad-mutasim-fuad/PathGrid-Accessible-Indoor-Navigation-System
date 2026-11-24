import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ExternalLink, FlaskConical, LayoutDashboard, LogOut, Map as MapIcon, PenTool, Settings as SettingsIcon,
} from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { useAdminData } from './AdminDataContext';
import { AdminLoading, ErrorNotice } from './AdminUi';
import OfflineBanner from '../OfflineBanner';

const NAV_ITEMS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/editor', label: 'Map Editor', icon: PenTool },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

const navLinkClass = ({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white ${
  isActive ? 'bg-blue-700 text-white' : 'text-slate-200 hover:bg-white/10'
}`;

/**
 * Shared admin shell: sidebar navigation on desktop, compact top bar on small
 * screens, demo-mode banner, building selector and logout.
 */
export default function AdminLayout() {
  const { user, isDemo, signOut } = useAdminAuth();
  const {
    buildings, buildingId, selectBuilding, building, status, error, retry,
  } = useAdminData();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/admin/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const logoutButton = (extraClass = '') => (
    <button
      type="button"
      onClick={handleLogout}
      disabled={signingOut}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 ${extraClass}`}
    >
      <LogOut aria-hidden="true" className="h-5 w-5" />
      Logout
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 lg:flex-row">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="flex shrink-0 flex-col bg-slate-900 text-white lg:sticky lg:top-0 lg:h-dvh lg:w-64">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <MapIcon aria-hidden="true" className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-bold leading-tight">PathGrid Admin</span>
            <span className="block truncate text-xs text-slate-300">{building?.building_name ?? ' '}</span>
          </span>
        </div>

        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass}>
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
            </NavLink>
          ))}
          {logoutButton('lg:hidden whitespace-nowrap')}
        </nav>

        <div className="hidden border-t border-white/10 p-3 lg:block">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/10 focus-visible:outline-3 focus-visible:outline-white"
          >
            <ExternalLink aria-hidden="true" className="h-5 w-5" />
            View public map
          </Link>
          <p className="truncate px-3 pt-2 text-xs text-slate-400" title={user?.email}>
            {`Signed in as ${user?.email ?? ''}`}
          </p>
          {logoutButton('mt-1 w-full')}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner variant="admin" />
        {isDemo && (
          <p role="note" className="flex items-center gap-2 bg-amber-300 px-4 py-2 text-sm font-semibold text-amber-950">
            <FlaskConical aria-hidden="true" className="h-4 w-4 shrink-0" />
            Demo mode: changes are kept in this browser tab only and are not saved to Firebase.
          </p>
        )}

        {buildings.length > 1 && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-6 py-2">
            <label htmlFor="admin-building" className="text-sm font-medium text-slate-700">Building</label>
            <select
              id="admin-building"
              value={buildingId ?? ''}
              onChange={(event) => selectBuilding(event.target.value)}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            >
              {buildings.map((b) => (
                <option key={b.building_id} value={b.building_id}>{b.building_name ?? b.building_id}</option>
              ))}
            </select>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
          {status === 'loading' && <AdminLoading label="Loading building data…" />}
          {status === 'error' && <ErrorNotice message={`Could not load building data: ${error}`} onRetry={retry} />}
          {status === 'empty' && (
            <ErrorNotice message="No buildings found. Create a building document in Firestore to get started." />
          )}
          {status === 'ready' && <Outlet />}
        </main>
      </div>
    </div>
  );
}
