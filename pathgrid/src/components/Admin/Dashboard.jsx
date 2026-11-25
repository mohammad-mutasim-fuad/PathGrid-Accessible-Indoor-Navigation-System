import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban, Building, CableCar, CircleCheck, Clock, Layers, MapPin, PenTool, Route, Search, Waypoints,
} from 'lucide-react';
import { useAdminData } from './AdminDataContext';
import {
  formatTimestamp, listElevators, listFloorEdges, summarizeBuilding,
} from '../../services/adminService';
import {
  BUTTON, Card, ErrorNotice, INPUT, PageHeader, Switch,
} from './AdminUi';

function StatCard({ icon: Icon, label, value, detail = '', tone = 'default' }) {
  const labelId = useId();
  const toneClass = tone === 'warning' ? 'text-red-700' : 'text-slate-900';
  return (
    <div role="group" aria-labelledby={labelId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p id={labelId} className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon aria-hidden="true" className="h-4 w-4" />
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function StatusBadge({ outOfService }) {
  return outOfService ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
      <Ban aria-hidden="true" className="h-3.5 w-3.5" />
      Out of service
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
      <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
      In service
    </span>
  );
}

/**
 * Runs an async toggle while tracking which item is pending and any error.
 */
const usePendingAction = () => {
  const [pendingKey, setPendingKey] = useState(null);
  const [error, setError] = useState('');
  const run = async (key, action) => {
    setPendingKey(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingKey(null);
    }
  };
  return { pendingKey, error, run };
};

function ElevatorControls({ floors, onToggle }) {
  const elevators = useMemo(() => listElevators(floors), [floors]);
  const { pendingKey, error, run } = usePendingAction();

  return (
    <Card title="Elevators" icon={CableCar}>
      <p className="mb-4 text-sm text-slate-600">
        Marking an elevator out of service applies to every floor it serves. Routes avoid it immediately and
        visitors on an affected route are re-routed.
      </p>
      {error && <div className="mb-4"><ErrorNotice message={error} /></div>}
      {elevators.length === 0 ? (
        <p className="text-sm text-slate-600">No elevators in this building yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {elevators.map((elevator) => (
            <li key={elevator.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{elevator.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>{`Serves floors ${elevator.floors.join(', ')}`}</span>
                  <span aria-hidden="true">·</span>
                  <code>{elevator.key}</code>
                  <StatusBadge outOfService={elevator.outOfService} />
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                Out of service
                <Switch
                  label={`${elevator.name} out of service`}
                  checked={elevator.outOfService}
                  disabled={pendingKey === elevator.key}
                  tone="danger"
                  onChange={(value) => run(elevator.key, () => onToggle(elevator.key, value))}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PassageControls({ floors, onToggle }) {
  const [floorNumber, setFloorNumber] = useState(floors[0]?.floor_number ?? null);
  const [query, setQuery] = useState('');
  const [closedOnly, setClosedOnly] = useState(false);
  const { pendingKey, error, run } = usePendingAction();

  const floor = floors.find((f) => f.floor_number === floorNumber) ?? floors[0];
  const edges = useMemo(() => listFloorEdges(floor), [floor]);
  const visible = edges.filter((edge) => (!closedOnly || edge.outOfService)
    && edge.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Card title="Corridors & passages" icon={Waypoints}>
      <p className="mb-4 text-sm text-slate-600">
        Close a corridor for maintenance or an event. Closed passages are never used in routes.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="passage-floor" className="mb-1 block text-sm font-medium text-slate-700">Floor</label>
          <select
            id="passage-floor"
            value={floor?.floor_number ?? ''}
            onChange={(event) => setFloorNumber(Number(event.target.value))}
            className={INPUT}
          >
            {floors.map((f) => <option key={f.floor_number} value={f.floor_number}>{`Floor ${f.floor_number}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="passage-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="passage-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Hallway 1-A"
              className={`${INPUT} pl-9`}
            />
          </div>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={closedOnly}
            onChange={(event) => setClosedOnly(event.target.checked)}
            className="h-4 w-4 accent-blue-700"
          />
          Closed only
        </label>
      </div>

      {error && <div className="mb-4"><ErrorNotice message={error} /></div>}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-600">No passages match.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-slate-200 overflow-y-auto pr-1">
          {visible.map((edge) => (
            <li key={edge.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{edge.label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="capitalize">{edge.type}</span>
                  {!edge.isAccessible && <span>· not step-free</span>}
                  {edge.outOfService && <StatusBadge outOfService />}
                </p>
              </div>
              <Switch
                label={`Close passage ${edge.label}`}
                checked={edge.outOfService}
                disabled={pendingKey === edge.key}
                tone="danger"
                onChange={(value) => run(edge.key, () => onToggle(floor.floor_number, edge.source, edge.target, value))}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * /admin/dashboard: building statistics and quick out-of-service controls.
 */
export default function Dashboard() {
  const {
    building, floors, setElevatorOutOfService, setEdgeOutOfService,
  } = useAdminData();
  const stats = useMemo(() => summarizeBuilding(building, floors), [building, floors]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`${stats.buildingName} · ${building?.building_id ?? ''}`}
        actions={(
          <Link to="/admin/editor" className={BUTTON.primary}>
            <PenTool aria-hidden="true" className="h-4 w-4" />
            Open map editor
          </Link>
        )}
      />

      {floors.length === 0 && (
        <p role="note" className="mb-6 rounded-lg border-2 border-blue-700 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <strong>This building has no floors yet.</strong>
          {' '}
          Draw Floor 1 in the
          {' '}
          <Link to="/admin/editor" className="font-semibold underline">Map Editor</Link>
          , or load the sample building from
          {' '}
          <Link to="/admin/settings" className="font-semibold underline">Settings</Link>
          .
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Building} label="Floors" value={stats.floorCount} detail={`Default floor ${building?.default_floor ?? '—'}`} />
        <StatCard icon={MapPin} label="Total nodes" value={stats.totalNodes} detail={`${stats.destinations} destinations`} />
        <StatCard icon={Route} label="Connections" value={stats.totalEdges} detail={`${stats.closedPassages} closed`} />
        <StatCard
          icon={CableCar}
          label="Elevators out of service"
          value={`${stats.elevatorsOutOfService} / ${stats.elevatorCount}`}
          tone={stats.elevatorsOutOfService > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <StatCard icon={Clock} label="Last updated" value={formatTimestamp(stats.lastUpdated)} />
        <StatCard
          icon={Layers}
          label="Nodes per floor"
          value={floors.map((f) => f.graph_topology?.nodes?.length ?? 0).join(' / ') || '—'}
          detail={floors.map((f) => `F${f.floor_number}`).join(' / ')}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ElevatorControls floors={floors} onToggle={setElevatorOutOfService} />
        <PassageControls floors={floors} onToggle={setEdgeOutOfService} />
      </div>
    </div>
  );
}
