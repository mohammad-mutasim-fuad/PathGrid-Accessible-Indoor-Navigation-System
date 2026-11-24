/**
 * Registers public/service-worker.js for production builds (PRD 5.3).
 *
 * The worker URL carries the build id (the content hash of main.*.js), so a
 * new deploy always installs a fresh worker that precaches the new assets.
 * Every browser dependency can be injected, which keeps this testable.
 */

const SERVICE_WORKER_FILE = 'service-worker.js';
const MAIN_SCRIPT_PATTERN = /static\/js\/main\.([0-9a-f]+)\.js/i;

/** Build id from the main bundle's hashed filename, or 'dev'. */
export const getBuildId = (documentRef) => {
  const scripts = Array.from(documentRef?.querySelectorAll?.('script[src]') ?? []);
  for (const script of scripts) {
    const match = MAIN_SCRIPT_PATTERN.exec(script.getAttribute('src') ?? '');
    if (match) return match[1];
  }
  return 'dev';
};

export const getServiceWorkerUrl = (publicUrl = '', buildId = 'dev') =>
  `${publicUrl}/${SERVICE_WORKER_FILE}?v=${encodeURIComponent(buildId)}`;

/**
 * True when a service worker should be registered: production build, browser
 * support, secure context, and the app served from its own origin.
 */
export const canRegisterServiceWorker = ({
  env, navigatorRef, windowRef, publicUrl = '',
}) => {
  if (env !== 'production') return false;
  if (!navigatorRef || !('serviceWorker' in navigatorRef)) return false;
  if (!windowRef?.location || windowRef.isSecureContext === false) return false;
  try {
    const appBase = new URL(publicUrl || '/', windowRef.location.href);
    return appBase.origin === windowRef.location.origin;
  } catch {
    return false;
  }
};

const watchForUpdates = (registration, navigatorRef, { onSuccess, onUpdate }) => {
  registration.addEventListener?.('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installed') return;
      // An existing controller means this is an update; otherwise first install.
      if (navigatorRef.serviceWorker.controller) onUpdate?.(registration);
      else onSuccess?.(registration);
    });
  });
};

/**
 * Registers the service worker after the page has loaded (so it never competes
 * with first render). Resolves with the registration, or null when skipped or
 * when registration fails.
 */
export const registerServiceWorker = ({
  env = process.env.NODE_ENV,
  publicUrl = process.env.PUBLIC_URL ?? '',
  navigatorRef = typeof navigator !== 'undefined' ? navigator : undefined,
  windowRef = typeof window !== 'undefined' ? window : undefined,
  documentRef = typeof document !== 'undefined' ? document : undefined,
  onSuccess,
  onUpdate,
  onError,
} = {}) => {
  if (!canRegisterServiceWorker({
    env, navigatorRef, windowRef, publicUrl,
  })) {
    return Promise.resolve(null);
  }

  const url = getServiceWorkerUrl(publicUrl, getBuildId(documentRef));
  const register = () => navigatorRef.serviceWorker
    .register(url, { scope: `${publicUrl}/` })
    .then((registration) => {
      watchForUpdates(registration, navigatorRef, { onSuccess, onUpdate });
      return registration;
    })
    .catch((error) => {
      onError?.(error);
      return null;
    });

  if (documentRef?.readyState === 'complete') return register();
  return new Promise((resolve) => {
    windowRef.addEventListener('load', () => resolve(register()), { once: true });
  });
};

/** Removes the service worker (e.g. to troubleshoot stale caches). */
export const unregisterServiceWorker = async (
  navigatorRef = typeof navigator !== 'undefined' ? navigator : undefined,
) => {
  if (!navigatorRef || !('serviceWorker' in navigatorRef)) return false;
  const registration = await navigatorRef.serviceWorker.ready;
  return registration.unregister();
};
