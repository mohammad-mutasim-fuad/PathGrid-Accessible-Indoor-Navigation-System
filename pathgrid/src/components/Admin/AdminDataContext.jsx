import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAdminAuth } from './AdminAuthContext';
import {
  getDemoAdminRepository, liveAdminRepository, resolveBuildingId, withTimeout,
} from '../../services/adminService';

const AdminDataContext = createContext(null);

/** Upper bound for one load so the UI can never sit on "Loading…" forever. */
export const ADMIN_LOAD_TIMEOUT_MS = 20000;

/**
 * Loads the selected building and its floors for the admin pages and exposes
 * write actions that refresh the data afterwards. Uses the in-memory demo
 * repository for demo sessions and Firestore otherwise.
 *
 * Every load ends in exactly one of: 'ready', 'empty' or 'error'.
 */
export function AdminDataProvider({ children }) {
  const { isDemo } = useAdminAuth();
  const repository = useMemo(
    () => (isDemo ? getDemoAdminRepository() : liveAdminRepository),
    [isDemo],
  );

  const [buildings, setBuildings] = useState([]);
  const [requestedBuildingId, setRequestedBuildingId] = useState(null);
  const [buildingId, setBuildingId] = useState(null);
  const [data, setData] = useState({ building: null, floors: [] });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const mountedRef = useRef(true);
  // When true, the next load skips the 'loading' state so the current page
  // (e.g. Settings after seeding) stays mounted and keeps its messages.
  const silentReloadRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // One sequential load: building list -> pick a building -> its floors.
  useEffect(() => {
    let cancelled = false;
    if (silentReloadRef.current) {
      silentReloadRef.current = false;
    } else {
      setStatus('loading');
    }
    setError('');

    (async () => {
      const list = await withTimeout(
        repository.listBuildings(),
        ADMIN_LOAD_TIMEOUT_MS,
        'Loading the building list timed out.',
      );
      if (cancelled) return;
      setBuildings(list);

      const selectedId = resolveBuildingId(list, requestedBuildingId);
      if (!selectedId) {
        setBuildingId(null);
        setData({ building: null, floors: [] });
        setStatus('empty');
        return;
      }

      const result = await withTimeout(
        repository.loadBuilding(selectedId),
        ADMIN_LOAD_TIMEOUT_MS,
        `Loading building "${selectedId}" timed out.`,
      );
      if (cancelled) return;
      setBuildingId(selectedId);
      setData(result);
      setStatus('ready');
    })().catch((err) => {
      if (cancelled) return;
      setError(err?.message || 'Unknown error.');
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [repository, requestedBuildingId, reloadKey]);

  /** Re-reads the current building after a write, without a loading flash. */
  const refresh = useCallback(async () => {
    if (!buildingId) return;
    const result = await withTimeout(
      repository.loadBuilding(buildingId),
      ADMIN_LOAD_TIMEOUT_MS,
      `Refreshing building "${buildingId}" timed out.`,
    );
    if (!mountedRef.current) return;
    setData(result);
    setError('');
    setStatus('ready');
  }, [repository, buildingId]);

  const setElevatorOutOfService = useCallback(async (elevatorKey, outOfService) => {
    const updated = await repository.setElevatorOutOfService(buildingId, elevatorKey, outOfService);
    await refresh();
    return updated;
  }, [repository, buildingId, refresh]);

  const setEdgeOutOfService = useCallback(async (floorNumber, sourceId, targetId, outOfService) => {
    await repository.setEdgeOutOfService(buildingId, floorNumber, sourceId, targetId, outOfService);
    await refresh();
  }, [repository, buildingId, refresh]);

  const saveFloorTopology = useCallback(async (floorNumber, topology) => {
    await repository.saveFloorTopology(buildingId, floorNumber, topology);
    await refresh();
  }, [repository, buildingId, refresh]);

  /** Re-runs the full load (always, even if the selected building is unchanged). */
  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  /**
   * Writes the bundled sample building and its floors, then reloads quietly
   * (no loading screen), so an 'empty' Settings page moves straight to 'ready'.
   */
  const seedSampleData = useCallback(async () => {
    const result = await repository.seedSampleData();
    silentReloadRef.current = true;
    setReloadKey((key) => key + 1);
    return result;
  }, [repository]);

  const value = useMemo(() => ({
    mode: repository.mode,
    buildings,
    buildingId,
    selectBuilding: setRequestedBuildingId,
    building: data.building,
    floors: data.floors,
    status,
    error,
    refresh,
    retry,
    setElevatorOutOfService,
    setEdgeOutOfService,
    saveFloorTopology,
    seedSampleData,
  }), [
    repository.mode, buildings, buildingId, data, status, error, refresh, retry,
    setElevatorOutOfService, setEdgeOutOfService, saveFloorTopology, seedSampleData,
  ]);

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export const useAdminData = () => {
  const context = useContext(AdminDataContext);
  if (!context) throw new Error('useAdminData must be used inside <AdminDataProvider>.');
  return context;
};
