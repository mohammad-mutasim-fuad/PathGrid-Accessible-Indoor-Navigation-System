/**
 * Floating vertical floor selector, docked to the right edge of the map.
 * Highest floor is shown at the top, like an elevator panel.
 *
 * @param {object} props
 * @param {number[]} props.floors - available floor numbers
 * @param {number} props.activeFloor
 * @param {(floor: number) => void} props.onFloorChange
 * @param {number[]} [props.routeFloors] - floors the current route passes through
 */
export default function FloorPicker({ floors, activeFloor, onFloorChange, routeFloors = [] }) {
  if (!floors || floors.length === 0) return null;
  const ordered = [...floors].sort((a, b) => b - a);
  const onRoute = new Set(routeFloors);

  return (
    <nav
      aria-label="Floor selector"
      className="absolute right-3 top-3 z-10 flex flex-col items-center rounded-2xl border border-slate-300 bg-white p-1 shadow-lg"
    >
      <span className="px-1 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        Floor
      </span>
      <ul className="flex flex-col gap-1">
        {ordered.map((floor) => {
          const isActive = floor === activeFloor;
          const isOnRoute = onRoute.has(floor);
          return (
            <li key={floor}>
              <button
                type="button"
                onClick={() => onFloorChange(floor)}
                aria-pressed={isActive}
                aria-label={`Floor ${floor}${isOnRoute ? ', on your route' : ''}`}
                className={`relative flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                  isActive
                    ? 'bg-blue-700 text-white shadow-inner'
                    : 'bg-white text-slate-800 hover:bg-slate-100 active:bg-slate-200'
                }`}
              >
                {floor}
                {isOnRoute && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ${
                      isActive ? 'bg-white ring-blue-700' : 'bg-blue-700 ring-white'
                    }`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
