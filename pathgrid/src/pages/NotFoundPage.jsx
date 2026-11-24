import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AppHeader from '../components/AppHeader';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="text-slate-700">The page you are looking for doesn&apos;t exist.</p>
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
