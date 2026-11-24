import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, FlaskConical, LoaderCircle, Lock, LogIn, Map as MapIcon, TriangleAlert,
} from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { describeAuthError, isDemoModeAvailable } from '../../services/authService';
import { BUTTON, ErrorNotice, INPUT } from './AdminUi';

const DEFAULT_DESTINATION = '/admin/dashboard';

/**
 * /admin/login: Firebase Email/Password sign-in. When Firebase is not
 * configured the form is disabled and a demo-mode entry point is offered.
 */
export default function Login() {
  const { status, signIn, enterDemo } = useAdminAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const demoAvailable = isDemoModeAvailable();
  const from = location.state?.from?.pathname;
  const destination = from && from.startsWith('/admin/') && from !== '/admin/login' ? from : DEFAULT_DESTINATION;

  if (status === 'signedIn') return <Navigate to={destination} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(describeAuthError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-slate-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-700 text-white">
            <MapIcon aria-hidden="true" className="h-6 w-6" />
          </span>
          <span className="text-2xl font-bold">PathGrid Admin</span>
        </div>

        <main className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Lock aria-hidden="true" className="h-5 w-5 text-blue-700" />
            Administrator sign in
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            For facility staff who manage maps and out-of-service elevators.
          </p>

          {demoAvailable && (
            <div className="mt-5 rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert aria-hidden="true" className="h-4 w-4" />
                Firebase is not configured
              </p>
              <p className="mt-1">
                Add the <code className="rounded bg-amber-100 px-1">REACT_APP_FIREBASE_*</code> variables to{' '}
                <code className="rounded bg-amber-100 px-1">pathgrid/.env</code> (see{' '}
                <code className="rounded bg-amber-100 px-1">.env.example</code>) to enable real sign-in.
              </p>
              <p className="mt-2">
                Until then you can explore the portal in <strong>demo mode</strong>. Changes stay in this browser tab
                and are never saved.
              </p>
              <button type="button" onClick={enterDemo} className={`${BUTTON.primary} mt-3 w-full`}>
                <FlaskConical aria-hidden="true" className="h-4 w-4" />
                Continue in demo mode
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <fieldset disabled={demoAvailable || submitting} className="space-y-4 disabled:opacity-60">
              <div>
                <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-slate-800">
                  Email address
                </label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={`${INPUT} h-11`}
                />
              </div>
              <div>
                <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-slate-800">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${INPUT} h-11`}
                />
              </div>

              {error && <ErrorNotice message={error} />}

              <button type="submit" className={`${BUTTON.primary} w-full`}>
                {submitting
                  ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  : <LogIn aria-hidden="true" className="h-4 w-4" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </fieldset>
          </form>
        </main>

        <p className="mt-6 text-center">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-blue-800 hover:underline focus-visible:outline-3 focus-visible:outline-blue-700"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to the public map
          </Link>
        </p>
      </div>
    </div>
  );
}
