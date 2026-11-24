import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MapPin,
  MoveVertical,
  Navigation,
  QrCode,
  Route,
  Undo2,
} from 'lucide-react';
import { formatDistance, groupLocationsByFloor, parseQrParams } from '../services/routeUtils';

const MANEUVER_ICONS = {
  depart: Navigation,
  straight: ArrowUp,
  continue: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  'u-turn': Undo2,
  'change-floor': MoveVertical,
  arrive: Flag,
};

function LocationSelect({
  id, label, icon: Icon, value, onChange, groups, isWheelchairMode, placeholder,
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <Icon aria-hidden="true" className="h-4 w-4" />
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
      >
        <option value="">{placeholder}</option>
        {groups.map(({ floor, locations }) => (
          <optgroup key={floor} label={`Floor ${floor}`}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {isWheelchairMode && !location.isAccessible ? ' (not step-free)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function WheelchairToggle({ checked, onChange }) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
        checked ? 'border-blue-800 bg-blue-50' : 'border-slate-300 bg-white'
      }`}
    >
      <Accessibility
        aria-hidden="true"
        className={`h-6 w-6 shrink-0 ${checked ? 'text-blue-800' : 'text-slate-700'}`}
      />
      <span className="flex-1">
        <span id={labelId} className="block text-base font-semibold text-slate-900">
          Wheelchair accessible route
        </span>
        <span id={descriptionId} className="block text-sm text-slate-700">
          Avoids stairs, steps and out-of-service elevators
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition ${
          checked ? 'border-blue-800 bg-blue-800' : 'border-slate-600 bg-slate-500'
        }`}
      >
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}

function DirectionsList({ steps, onStepSelect }) {
  return (
    <ol className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {steps.map((step, index) => {
        const Icon = MANEUVER_ICONS[step.maneuver] ?? ArrowUp;
        const highlight = step.maneuver === 'change-floor';
        return (
          <li key={`${step.fromNodeId}-${step.toNodeId}-${index}`}>
            <button
              type="button"
              onClick={() => onStepSelect?.(step)}
              className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-blue-700 ${
                highlight ? 'bg-blue-50' : ''
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-800">
                <Icon aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm text-slate-900">
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {step.instruction}
              </span>
              {step.distance > 0 && (
                <span className="shrink-0 text-sm font-medium tabular-nums text-slate-600">
                  {formatDistance(step.distance)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Mobile-first bottom sheet for route planning. On wider screens it docks as
 * a floating panel at the bottom-left of the map.
 *
 * Reads `?start=NODE_ID` (or `?startNode=`) from the URL once locations are
 * available and pre-selects it, so wall-mounted QR codes work.
 *
 * @param {object} props
 * @param {{id, name, floor, isAccessible}[]} props.locations - from getSelectableLocations()
 * @param {string|null} props.startNodeId
 * @param {string|null} props.targetNodeId
 * @param {(id: string|null) => void} props.onStartChange
 * @param {(id: string|null) => void} props.onTargetChange
 * @param {() => void} props.onSwap
 * @param {boolean} props.isWheelchairMode
 * @param {(value: boolean) => void} props.onWheelchairModeChange
 * @param {() => void} props.onFindRoute
 * @param {object|null} props.route - result of findShortestPath() when found
 * @param {number} [props.routeFloorCount]
 * @param {string} [props.routeError] - user-facing failure message
 * @param {(step: object) => void} [props.onStepSelect]
 */
export default function RoomSelector({
  locations,
  startNodeId,
  targetNodeId,
  onStartChange,
  onTargetChange,
  onSwap,
  isWheelchairMode,
  onWheelchairModeChange,
  onFindRoute,
  route = null,
  routeFloorCount = 0,
  routeError = '',
  onStepSelect,
}) {
  const [searchParams] = useSearchParams();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showDirections, setShowDirections] = useState(false);
  const [qrNotice, setQrNotice] = useState('');
  const appliedQrRef = useRef(false);
  const panelId = useId();
  const directionsId = useId();

  const groups = useMemo(() => groupLocationsByFloor(locations), [locations]);
  const qrStartId = parseQrParams(searchParams).startNodeId;

  // Apply the QR start location once the building's locations have loaded.
  useEffect(() => {
    if (appliedQrRef.current || !qrStartId || locations.length === 0) return;
    appliedQrRef.current = true;
    const match = locations.find((location) => location.id === qrStartId);
    if (match) {
      onStartChange(match.id);
      setQrNotice(`Start set from QR code: ${match.name}`);
    } else {
      setQrNotice('The scanned QR code location was not found. Please choose your start point.');
    }
  }, [qrStartId, locations, onStartChange]);

  // Reveal directions automatically when a new route arrives.
  useEffect(() => {
    if (route) {
      setShowDirections(true);
      setIsExpanded(true);
    }
  }, [route]);

  const canFindRoute = Boolean(startNodeId && targetNodeId && startNodeId !== targetNodeId);
  const sameLocation = Boolean(startNodeId && startNodeId === targetNodeId);

  const summary = route
    ? `${formatDistance(route.totalDistance)} · ${routeFloorCount} floor${routeFloorCount === 1 ? '' : 's'}`
    : 'Plan your route';

  return (
    <section
      aria-label="Route planner"
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[75%] flex-col rounded-t-3xl border-t border-slate-300 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] md:relative md:inset-auto md:h-full md:max-h-none md:w-96 md:shrink-0 md:rounded-none md:border-t-0 md:border-r md:shadow-lg"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex min-h-14 w-full shrink-0 flex-col items-center px-4 pb-2 pt-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-blue-700"
      >
        <span aria-hidden="true" className="mb-2 h-1.5 w-12 rounded-full bg-slate-300" />
        <span className="flex w-full items-center justify-between">
          <span className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Route aria-hidden="true" className="h-5 w-5 text-blue-700" />
            {summary}
          </span>
          {isExpanded
            ? <ChevronDown aria-hidden="true" className="h-5 w-5 text-slate-700" />
            : <ChevronUp aria-hidden="true" className="h-5 w-5 text-slate-700" />}
          <span className="sr-only">{isExpanded ? 'Collapse route planner' : 'Expand route planner'}</span>
        </span>
      </button>

      <div
        id={panelId}
        hidden={!isExpanded}
        className="overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {qrNotice && (
          <p role="status" className="mb-3 flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-800">
            <QrCode aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {qrNotice}
          </p>
        )}

        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-3">
            <LocationSelect
              id="start-location"
              label="Start location"
              icon={Navigation}
              value={startNodeId}
              onChange={onStartChange}
              groups={groups}
              isWheelchairMode={isWheelchairMode}
              placeholder="Choose start point"
            />
            <LocationSelect
              id="destination-location"
              label="Destination"
              icon={MapPin}
              value={targetNodeId}
              onChange={onTargetChange}
              groups={groups}
              isWheelchairMode={isWheelchairMode}
              placeholder="Choose destination"
            />
          </div>
          <button
            type="button"
            onClick={onSwap}
            disabled={!startNodeId && !targetNodeId}
            aria-label="Swap start and destination"
            title="Swap start and destination"
            className="mb-8 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 text-slate-800 hover:bg-slate-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-40"
          >
            <ArrowUpDown aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3">
          <WheelchairToggle checked={isWheelchairMode} onChange={onWheelchairModeChange} />
        </div>

        {sameLocation && (
          <p className="mt-2 text-sm text-slate-700">Start and destination are the same place.</p>
        )}

        <button
          type="button"
          onClick={onFindRoute}
          disabled={!canFindRoute}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 text-base font-bold text-white shadow transition hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900 active:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
        >
          <Route aria-hidden="true" className="h-5 w-5" />
          Find Route
        </button>

        {routeError && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border-2 border-red-700 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
            <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {routeError}
          </p>
        )}

        {route && (
          <div className="mt-4">
            <p role="status" className="text-sm text-slate-800">
              {`Route found: ${formatDistance(route.totalDistance)}, ${route.directions.length - 1} steps`}
              {isWheelchairMode ? ', step-free.' : '.'}
            </p>
            <button
              type="button"
              onClick={() => setShowDirections((value) => !value)}
              aria-expanded={showDirections}
              aria-controls={directionsId}
              className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl bg-slate-100 px-3 text-base font-semibold text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Step-by-step directions
              {showDirections
                ? <ChevronUp aria-hidden="true" className="h-5 w-5" />
                : <ChevronDown aria-hidden="true" className="h-5 w-5" />}
            </button>
            <div id={directionsId} hidden={!showDirections}>
              <DirectionsList steps={route.directions} onStepSelect={onStepSelect} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
