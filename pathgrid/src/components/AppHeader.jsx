import { Link } from 'react-router-dom';
import { CircleQuestionMark, Lock, Map as MapIcon, WifiOff } from 'lucide-react';

const linkClass = 'flex h-12 min-w-12 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white';

/**
 * Top bar shared by public pages.
 * @param {object} props
 * @param {string} [props.subtitle] - e.g. the building name
 * @param {boolean} [props.isDemoData] - show the "Demo data" badge (mock/offline source)
 */
export default function AppHeader({ subtitle = '', isDemoData = false }) {
  return (
    <header className="z-30 flex shrink-0 items-center gap-2 bg-slate-900 px-3 py-1 text-white shadow-md pt-[max(0.25rem,env(safe-area-inset-top))]">
      <Link
        to="/"
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl pr-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600">
          <MapIcon aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-lg font-bold leading-tight">PathGrid</span>
          {subtitle && (
            <span className="block truncate text-xs leading-tight text-slate-300">{subtitle}</span>
          )}
        </span>
      </Link>

      {isDemoData && (
        <span
          title="Showing bundled demo data (offline or no backend configured)"
          className="hidden items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-xs font-bold text-amber-950 sm:flex"
        >
          <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
          Demo data
        </span>
      )}

      <nav aria-label="Main" className="flex items-center gap-1">
        <Link to="/help" className={linkClass}>
          <CircleQuestionMark aria-hidden="true" className="h-5 w-5" />
          <span className="hidden sm:inline">Help</span>
          <span className="sr-only sm:hidden">Help and map legend</span>
        </Link>
        <Link to="/admin/login" className={linkClass}>
          <Lock aria-hidden="true" className="h-5 w-5" />
          <span className="hidden sm:inline">Admin</span>
          <span className="sr-only sm:hidden">Admin login</span>
        </Link>
      </nav>
    </header>
  );
}
