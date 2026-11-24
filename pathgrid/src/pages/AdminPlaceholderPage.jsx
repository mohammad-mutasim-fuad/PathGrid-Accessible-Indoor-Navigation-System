import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import AppHeader from '../components/AppHeader';

/**
 * Temporary page for every /admin/* route until the Admin Portal is built.
 */
export default function AdminPlaceholderPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <AppHeader subtitle="Admin portal" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Lock aria-hidden="true" className="h-8 w-8" />
        </span>
        <h1 className="text-2xl font-bold text-slate-900">Admin Portal</h1>
        <p className="text-slate-700">
          Facility administrator sign-in and the map editor are coming soon.
        </p>
        <Link
          to="/"
          className="flex h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 font-bold text-white hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          Back to map
        </Link>
      </main>
    </div>
  );
}
