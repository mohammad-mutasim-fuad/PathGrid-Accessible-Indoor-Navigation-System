import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import NavigationPage from './pages/NavigationPage';
import HelpPage from './pages/HelpPage';
import NotFoundPage from './pages/NotFoundPage';

// The admin portal (and firebase/auth) is code-split out of the public bundle.
const AdminRoutes = lazy(() => import('./components/Admin/AdminRoutes'));

function RouteLoading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-2 bg-slate-100 text-slate-700">
      <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin" />
      Loading…
    </div>
  );
}

/**
 * Route table. Exported separately so tests can mount it in a MemoryRouter.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<NavigationPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route
        path="/admin/*"
        element={(
          <Suspense fallback={<RouteLoading />}>
            <AdminRoutes />
          </Suspense>
        )}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
