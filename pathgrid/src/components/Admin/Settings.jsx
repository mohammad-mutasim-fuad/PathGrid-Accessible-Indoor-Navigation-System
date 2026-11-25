import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building, Database, DatabaseBackup, LogOut, UserRound,
} from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { useAdminData } from './AdminDataContext';
import { app, isFirebaseConfigured } from '../../services/firebase';
import { describeFirestoreError, formatTimestamp } from '../../services/adminService';
import {
  BUTTON, Card, ErrorNotice, PageHeader,
} from './AdminUi';

/**
 * Loads the bundled sample building (ENG_MAIN, 3 floors with rooms,
 * corridors, stairs and elevators) into the current data source.
 */
function SampleDataCard({
  buildingId, floorCount, mode, onSeed,
}) {
  const [state, setState] = useState({ status: 'idle', message: '' });

  const handleSeed = async () => {
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      'Load the sample building?\n\nThis REPLACES buildings/ENG_MAIN and floors ENG_MAIN_FL01–FL03 '
      + `in ${mode === 'demo' ? 'this demo session' : 'Firestore'}. Other buildings are not touched.`,
    );
    if (!confirmed) return;
    setState({ status: 'working', message: '' });
    try {
      const result = await onSeed();
      setState({
        status: 'done',
        message: `Loaded ${result.buildings} building and ${result.floors} floors.`,
      });
    } catch (error) {
      setState({ status: 'error', message: describeFirestoreError(error) });
    }
  };

  return (
    <Card title="Sample data" icon={DatabaseBackup}>
      <p className="text-sm text-slate-700">
        {!buildingId && 'There are no buildings in the database yet. '}
        {buildingId && floorCount === 0 && `"${buildingId}" has no floors yet. `}
        Load the bundled sample building <code className="rounded bg-slate-100 px-1">ENG_MAIN</code>: three floors with
        rooms, corridors, stairs, elevators (one out of service) and accessibility flags. You can then edit it in the Map
        Editor.
      </p>
      {state.status === 'error' && <div className="mt-4"><ErrorNotice message={state.message} /></div>}
      {state.status === 'done' && (
        <p role="status" className="mt-4 text-sm font-medium text-emerald-800">{state.message}</p>
      )}
      <button
        type="button"
        onClick={handleSeed}
        disabled={state.status === 'working'}
        className={`${BUTTON.secondary} mt-4`}
      >
        <DatabaseBackup aria-hidden="true" className="h-4 w-4" />
        {state.status === 'working' ? 'Loading sample data…' : 'Load sample building'}
      </button>
    </Card>
  );
}

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
  const {
    building, floors, mode, seedSampleData,
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

  // building is null and floors empty when the database has no buildings yet
  // (status 'empty'); every field below must tolerate that.
  const weights = building?.transition_weights;
  const floorCount = Array.isArray(floors) ? floors.length : 0;

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
          {!building && (
            <p className="mb-4 text-sm text-slate-600">No building yet. Load the sample building below to get started.</p>
          )}
          <DetailList
            items={[
              ['Name', building?.building_name || '—'],
              ['Building ID', building?.building_id || '—'],
              ['Floors', `${floorCount} loaded (total_floors: ${building?.total_floors ?? '—'})`],
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

        <SampleDataCard
          buildingId={building?.building_id}
          floorCount={floorCount}
          mode={mode}
          onSeed={seedSampleData}
        />
      </div>
    </div>
  );
}
