import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building, Database, LogOut, UserRound } from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { useAdminData } from './AdminDataContext';
import { app, isFirebaseConfigured } from '../../services/firebase';
import { formatTimestamp } from '../../services/adminService';
import { BUTTON, Card, PageHeader } from './AdminUi';

function DetailList({ items }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-sm font-medium text-slate-600">{term}</dt>
          <dd className="break-all text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * /admin/settings: account details, building metadata and logout.
 */
export default function Settings() {
  const { user, isDemo, signOut } = useAdminAuth();
  const { building, floors, mode } = useAdminData();
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

  const weights = building?.transition_weights;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Your account and the building you are managing." />

      <div className="space-y-6">
        <Card title="Admin account" icon={UserRound}>
          <DetailList
            items={[
              ['Email', user?.email || '—'],
              ['Display name', user?.displayName || '—'],
              ['User ID', user?.uid || '—'],
              ['Last sign-in', isDemo ? 'Demo session' : formatTimestamp(user?.lastSignInTime, '—')],
              ['Account created', isDemo ? '—' : formatTimestamp(user?.creationTime, '—')],
              ['Session type', isDemo ? 'Demo mode (changes are not saved)' : 'Firebase Email/Password'],
            ]}
          />
          <button
            type="button"
            onClick={handleLogout}
            disabled={signingOut}
            className={`${BUTTON.danger} mt-6`}
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {signingOut ? 'Logging out…' : 'Logout'}
          </button>
        </Card>

        <Card title="Building" icon={Building}>
          <DetailList
            items={[
              ['Name', building?.building_name || '—'],
              ['Building ID', building?.building_id || '—'],
              ['Floors', `${floors.length} loaded (total_floors: ${building?.total_floors ?? '—'})`],
              ['Default floor', building?.default_floor ?? '—'],
              ['Last updated', formatTimestamp(building?.last_updated_timestamp)],
              ['Map update flag', building?.isMapUpdated ? 'Set (visitors will refresh)' : 'Not set'],
              ['Canvas size', building?.canvas_width ? `${building.canvas_width} × ${building.canvas_height}` : 'Auto'],
              ['Scale', building?.units_per_meter ? `${building.units_per_meter} units = 1 m` : 'Default (10 units = 1 m)'],
              ['Floor change cost', weights ? `Elevator ${weights.elevator} · Stairs ${weights.stairs}` : 'Defaults'],
            ]}
          />
        </Card>

        <Card title="Data source" icon={Database}>
          <DetailList
            items={[
              ['Mode', mode === 'demo' ? 'Demo (in-memory mock data)' : 'Live Firestore'],
              ['Firebase project', isFirebaseConfigured ? app?.options?.projectId ?? '—' : 'Not configured'],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
