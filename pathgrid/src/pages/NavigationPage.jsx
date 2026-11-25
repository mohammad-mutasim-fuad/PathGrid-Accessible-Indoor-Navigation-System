import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import MapCanvas from '../components/MapCanvas';
import FloorPicker from '../components/FloorPicker';
import RoomSelector from '../components/RoomSelector';
import { findShortestPath } from '../services/aStarEngine';
import { listBuildings, loadBuildingGraph, subscribeToMapUpdates } from '../services/dbService';
import {
  describeRouteFailure,
  getCanvasSize,
  getFloorGraph,
  getNextRouteFloor,
  getRouteFloors,
  getSelectableLocations,
  indexNodes,
  parseQrParams,
  routeSignature,
} from '../services/routeUtils';

const TOAST_DURATION_MS = 6000;

const resolveBuildingId = async (requestedId) => {
  if (requestedId) return requestedId;
  const buildings = await listBuildings();
  if (buildings.length === 0) throw new Error('No buildings are available yet.');
  return buildings[0].building_id;
};

/**
 * Public, login-free navigation screen: map + floor picker + route planner.
 */
export default function NavigationPage() {
  const [searchParams] = useSearchParams();
  const qr = useMemo(() => parseQrParams(searchParams), [searchParams]);

  const [loadState, setLoadState] = useState({ status: 'loading', error: '' });
  const [buildingData, setBuildingData] = useState(null);
  const [activeFloor, setActiveFloor] = useState(null);
  const [startNodeId, setStartNodeId] = useState(null);
  const [targetNodeId, setTargetNodeId] = useState(null);
  const [isWheelchairMode, setIsWheelchairMode] = useState(false);
  const [routeRequest, setRouteRequest] = useState(null);
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const facilityUpdateRef = useRef(false);
  const lastSignatureRef = useRef('');

  /* ---------------------------- data loading ---------------------------- */

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    const load = async () => {
      setLoadState({ status: 'loading', error: '' });
      try {
        const buildingId = await resolveBuildingId(qr.buildingId);
        const data = await loadBuildingGraph(buildingId);
        if (cancelled) return;

        setBuildingData(data);
        const floorNumbers = data.floors.map((floor) => floor.floor_number);
        let initialFloor = floorNumbers[0] ?? null;
        if (floorNumbers.includes(qr.floor)) initialFloor = qr.floor;
        else if (floorNumbers.includes(data.building.default_floor)) initialFloor = data.building.default_floor;
        setActiveFloor((current) => (floorNumbers.includes(current) ? current : initialFloor));
        setLoadState({ status: 'ready', error: '' });

        // PRD 5.2: refresh the graph when an admin publishes a facility change.
        unsubscribe = subscribeToMapUpdates(buildingId, async () => {
          try {
            const fresh = await loadBuildingGraph(buildingId);
            if (cancelled) return;
            facilityUpdateRef.current = true;
            setBuildingData(fresh);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[PathGrid] Could not refresh map after facility update.', error);
          }
        });
      } catch (error) {
        if (!cancelled) setLoadState({ status: 'error', error: error.message });
      }
    };

    load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [qr.buildingId, qr.floor, reloadKey]);

  /* ------------------------------ derived ------------------------------- */

  const graph = buildingData?.graph ?? null;
  const nodeById = useMemo(() => indexNodes(graph), [graph]);
  const locations = useMemo(() => getSelectableLocations(graph), [graph]);
  const floorNumbers = useMemo(
    () => (buildingData?.floors ?? []).map((floor) => floor.floor_number).sort((a, b) => a - b),
    [buildingData],
  );
  const floorGraph = useMemo(() => getFloorGraph(graph, activeFloor), [graph, activeFloor]);
  const canvasSize = useMemo(
    () => getCanvasSize(buildingData?.building, graph?.nodes),
    [buildingData, graph],
  );
  const floorPlanImageUrl = buildingData?.floors
    .find((floor) => floor.floor_number === activeFloor)?.floor_plan_image_url ?? '';

  // The route is recomputed whenever the request or the graph changes, so a
  // facility update or a wheelchair toggle re-routes automatically.
  const routeResult = useMemo(() => {
    if (!routeRequest || !graph) return null;
    return findShortestPath(graph, routeRequest.start, routeRequest.target, routeRequest.wheelchair);
  }, [routeRequest, graph]);

  const route = routeResult?.found ? routeResult : null;
  const routeFloors = useMemo(() => getRouteFloors(route?.path), [route]);
  const nextFloor = route ? getNextRouteFloor(route.path, activeFloor) : null;
  const routeError = routeResult && !routeResult.found
    ? describeRouteFailure(routeResult, {
      isWheelchairMode: routeRequest.wheelchair,
      startNode: nodeById.get(routeRequest.start),
      targetNode: nodeById.get(routeRequest.target),
    })
    : '';

  // Toast when a facility change altered the active route.
  useEffect(() => {
    const signature = routeSignature(routeResult);
    if (facilityUpdateRef.current) {
      facilityUpdateRef.current = false;
      if (routeRequest && signature !== lastSignatureRef.current) {
        setToast('Route updated due to facility change.');
      }
    }
    lastSignatureRef.current = signature;
  }, [routeResult, routeRequest]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ------------------------------ handlers ------------------------------ */

  const focusNodeFloor = useCallback((nodeId) => {
    const node = nodeById.get(nodeId);
    if (node) setActiveFloor(node.floor);
  }, [nodeById]);

  const handleStartChange = useCallback((nodeId) => {
    setStartNodeId(nodeId);
    setRouteRequest(null);
    if (nodeId) focusNodeFloor(nodeId);
  }, [focusNodeFloor]);

  const handleTargetChange = useCallback((nodeId) => {
    setTargetNodeId(nodeId);
    setRouteRequest(null);
  }, []);

  const handleSwap = useCallback(() => {
    setStartNodeId(targetNodeId);
    setTargetNodeId(startNodeId);
    setRouteRequest(null);
    if (targetNodeId) focusNodeFloor(targetNodeId);
  }, [startNodeId, targetNodeId, focusNodeFloor]);

  const handleFindRoute = useCallback(() => {
    if (!startNodeId || !targetNodeId) return;
    setRouteRequest({ start: startNodeId, target: targetNodeId, wheelchair: isWheelchairMode });
    focusNodeFloor(startNodeId);
  }, [startNodeId, targetNodeId, isWheelchairMode, focusNodeFloor]);

  const handleWheelchairModeChange = useCallback((value) => {
    setIsWheelchairMode(value);
    setRouteRequest((current) => (current ? { ...current, wheelchair: value } : current));
  }, []);

  const handleStepSelect = useCallback((step) => {
    focusNodeFloor(step.maneuver === 'change-floor' ? step.toNodeId : step.fromNodeId);
  }, [focusNodeFloor]);

  /* ------------------------------- render ------------------------------- */

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <AppHeader
        subtitle={buildingData?.building.building_name ?? ''}
        isDemoData={buildingData?.source === 'mock'}
      />

      <main className="relative flex flex-1 overflow-hidden">
        {loadState.status === 'loading' && !buildingData && (
          <div role="status" className="flex flex-1 items-center justify-center gap-2 text-slate-700">
            <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin" />
            Loading map…
          </div>
        )}

        {loadState.status === 'error' && (
          <div role="alert" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <CircleAlert aria-hidden="true" className="h-10 w-10 text-red-700" />
            <p className="text-lg font-semibold text-slate-900">The map could not be loaded.</p>
            <p className="text-slate-700">{loadState.error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="flex h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 font-bold text-white hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
            >
              <RefreshCw aria-hidden="true" className="h-5 w-5" />
              Try again
            </button>
          </div>
        )}

        {buildingData && buildingData.floors.length === 0 && loadState.status !== 'error' && (
          <div role="status" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-lg font-semibold text-slate-900">
              {`${buildingData.building.building_name ?? 'This building'} has no floor maps yet.`}
            </p>
            <p className="text-slate-700">Please check back soon, or ask facility staff for directions.</p>
          </div>
        )}

        {buildingData && buildingData.floors.length > 0 && activeFloor !== null && loadState.status !== 'error' && (
          <>
            <RoomSelector
              locations={locations}
              startNodeId={startNodeId}
              targetNodeId={targetNodeId}
              onStartChange={handleStartChange}
              onTargetChange={handleTargetChange}
              onSwap={handleSwap}
              isWheelchairMode={isWheelchairMode}
              onWheelchairModeChange={handleWheelchairModeChange}
              onFindRoute={handleFindRoute}
              route={route}
              routeFloorCount={new Set(routeFloors).size}
              routeError={routeError}
              onStepSelect={handleStepSelect}
            />

            <div className="relative min-w-0 flex-1">
              <MapCanvas
                floor={activeFloor}
                nodes={floorGraph.nodes}
                edges={floorGraph.edges}
                routePath={route?.path ?? []}
                startNodeId={startNodeId}
                targetNodeId={targetNodeId}
                width={canvasSize.width}
                height={canvasSize.height}
                floorPlanImageUrl={floorPlanImageUrl}
              />

              <FloorPicker
                floors={floorNumbers}
                activeFloor={activeFloor}
                onFloorChange={setActiveFloor}
                routeFloors={routeFloors}
              />

              {nextFloor !== null && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-20">
                  <button
                    type="button"
                    onClick={() => setActiveFloor(nextFloor)}
                    className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-full bg-blue-700 px-4 text-sm font-bold text-white shadow-lg hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
                  >
                    <ArrowUpDown aria-hidden="true" className="h-5 w-5" />
                    {`Switch to Floor ${nextFloor}`}
                  </button>
                </div>
              )}

              {toast && (
                <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
                  <p
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl"
                  >
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                    {toast}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
