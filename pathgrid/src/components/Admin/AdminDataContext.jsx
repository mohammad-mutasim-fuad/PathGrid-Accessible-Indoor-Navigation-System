import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAdminAuth } from './AdminAuthContext';
import { getDemoAdminRepository, liveAdminRepository } from '../../services/adminService';

const AdminDataContext = createContext(null);

/**
 * Loads the selected building and its floors for the admin pages and exposes
 * write actions that refresh the data afterwards. Uses the in-memory demo
 * repository for demo sessions and Firestore otherwise.
 */
export function AdminDataProvider({ children }) {
  const { isDemo } = useAdminAuth();
  const repository = useMemo(
    () => (isDemo ? getDemoAdminRepository() : liveAdminRepository),
    [isDemo],
  );

  const [buildings, setBuildings] = useState([]);
  const [buildingId, setBuildingId] = useState(null);
  const [data, setData] = useState({ building: null, floors: [] });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Building list.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    repository.listBuildings()
      .then((list) => {
        if (cancelled) return;
        setBuildings(list);
        if (list.length === 0) {
          setStatus('empty');
          return;
        }
        setBuildingId((current) => (list.some((b) => b.building_id === current)
          ? current
          : list[0].building_id));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [repository, reloadKey]);

  const refresh = useCallback(async () => {
    if (!buildingId) return;
    const result = await repository.loadBuilding(buildingId);
    if (!mountedRef.current) return;
    setData(result);
    setError('');
    setStatus('ready');
  }, [repository, buildingId]);

  // Selected building data.
  useEffect(() => {
    if (!buildingId) return;
    setStatus('loading');
    refresh().catch((err) => {
      if (!mountedRef.current) return;
      setError(err.message);
      setStatus('error');
    });
  }, [refresh, buildingId]);

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

  const retry = useCallback(() => {
    setError('');
    setReloadKey((key) => key + 1);
  }, []);

  const value = useMemo(() => ({
    mode: repository.mode,
    buildings,
    buildingId,
    selectBuilding: setBuildingId,
    building: data.building,
    floors: data.floors,
    status,
    error,
    refresh,
    retry,
    setElevatorOutOfService,
    setEdgeOutOfService,
    saveFloorTopology,
  }), [
    repository.mode, buildings, buildingId, data, status, error, refresh, retry,
    setElevatorOutOfService, setEdgeOutOfService, saveFloorTopology,
  ]);

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export const useAdminData = () => {
  const context = useContext(AdminDataContext);
  if (!context) throw new Error('useAdminData must be used inside <AdminDataProvider>.');
  return context;
};
