/* eslint-disable no-restricted-globals */
/**
 * PathGrid service worker: offline app shell + map asset caching.
 *
 * Caching strategy (PRD 5.3):
 *  - Install: precache the app shell (index.html, manifest, icons) and every
 *    JS/CSS file listed in CRA's asset-manifest.json, including lazy chunks.
 *  - Navigations: network-first with a short timeout, falling back to the
 *    cached index.html so every route opens offline (SPA).
 *  - /static/* (content-hashed, immutable): cache-first.
 *  - Floor-plan images from Firebase Storage: stale-while-revalidate in a
 *    long-lived, size-capped cache so visited maps keep their blueprints.
 *  - Other same-origin GETs: stale-while-revalidate.
 *  - Firestore, Auth and all other cross-origin traffic: never intercepted.
 *    Firestore's own IndexedDB persistence handles map data offline.
 *
 * The page registers this file as service-worker.js?v=<build id>, so every
 * deploy installs a fresh worker and old shell caches are removed.
 */

const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE_PREFIX = 'pathgrid-shell-';
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${BUILD_ID}`;
const MAPS_CACHE = 'pathgrid-maps-v1';
const MAX_MAP_ENTRIES = 60;
const NAVIGATION_TIMEOUT_MS = 4000;

const SCOPE_URL = new URL('./', self.location.href);
const SHELL_URL = new URL('index.html', SCOPE_URL).href;

const CORE_ASSETS = [
  './', 'index.html', 'manifest.json', 'favicon.ico', 'icon.svg',
  'logo192.png', 'logo512.png', 'maskable-512.png', 'apple-touch-icon.png',
];

const MAP_IMAGE_HOSTS = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];
const isMapImageHost = (hostname) =>
  MAP_IMAGE_HOSTS.includes(hostname) || hostname.endsWith('.firebasestorage.app') || hostname.endsWith('.appspot.com');

/* ------------------------------------------------------------------------- */
/* Pure helpers (exposed on self.pathgridServiceWorker for unit tests)        */
/* ------------------------------------------------------------------------- */

/**
 * Decides how a request is handled.
 * @returns {'bypass'|'navigation'|'static'|'map-asset'|'stale-while-revalidate'}
 */
function classifyRequest(request, scopeHref) {
  if (request.method !== 'GET') return 'bypass';
  const url = new URL(request.url);
  const scope = new URL(scopeHref);

  if (url.origin !== scope.origin) {
    return isMapImageHost(url.hostname) && request.destination !== 'document' ? 'map-asset' : 'bypass';
  }
  if (!url.pathname.startsWith(scope.pathname)) return 'bypass';
  if (request.mode === 'navigate') return 'navigation';

  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('static/')) return 'static';
  if (path === 'service-worker.js' || path === 'asset-manifest.json') return 'bypass';
  return 'stale-while-revalidate';
}

/** Absolute URLs of the build's JS/CSS/HTML files from CRA's asset-manifest.json. */
function collectPrecacheUrls(assetManifest, scopeHref) {
  const files = Object.values((assetManifest && assetManifest.files) || {});
  const entrypoints = (assetManifest && assetManifest.entrypoints) || [];
  const urls = new Set();
  [...files, ...entrypoints].forEach((file) => {
    if (typeof file !== 'string') return;
    if (file.endsWith('.map') || file.endsWith('.LICENSE.txt')) return;
    urls.add(new URL(file, scopeHref).href);
  });
  return [...urls];
}

/* ------------------------------------------------------------------------- */
/* Strategies                                                                 */
/* ------------------------------------------------------------------------- */

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

const offlineFallback = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>PathGrid – Offline</title><body style="font-family:system-ui;padding:2rem;text-align:center">'
  + '<h1>You\'re offline</h1><p>Open PathGrid once while connected so it can work offline next time.</p>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function handleNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(event.request).then((response) => {
    if (response && response.ok) {
      event.waitUntil(cache.put(SHELL_URL, response.clone()).catch(() => undefined));
    }
    return response;
  });

  try {
    return await withTimeout(network, NAVIGATION_TIMEOUT_MS);
  } catch {
    const cached = (await cache.match(SHELL_URL)) || (await cache.match(SCOPE_URL.href));
    if (cached) return cached;
    try {
      return await network;
    } catch {
      return offlineFallback();
    }
  }
}

async function handleCacheFirst(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response && response.ok) await cache.put(event.request, response.clone());
  return response;
}

async function handleStaleWhileRevalidate(event, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const update = fetch(event.request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(event.request, response.clone());
        if (maxEntries) await trimCache(cache, maxEntries);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  const response = await update;
  return response || Response.error();
}

const HANDLERS = {
  navigation: (event) => handleNavigation(event),
  static: (event) => handleCacheFirst(event),
  'map-asset': (event) => handleStaleWhileRevalidate(event, MAPS_CACHE, MAX_MAP_ENTRIES),
  'stale-while-revalidate': (event) => handleStaleWhileRevalidate(event, SHELL_CACHE),
};

/* ------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* ------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const reload = (url) => new Request(url, { cache: 'reload' });
    await cache.addAll(CORE_ASSETS.map((path) => reload(new URL(path, SCOPE_URL).href)));
    try {
      const response = await fetch(reload(new URL('asset-manifest.json', SCOPE_URL).href));
      if (response.ok) {
        const urls = collectPrecacheUrls(await response.json(), SCOPE_URL.href);
        await cache.addAll(urls.map(reload));
      }
    } catch {
      // No asset manifest (e.g. dev server): runtime caching still applies.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const strategy = classifyRequest(event.request, SCOPE_URL.href);
  if (strategy === 'bypass') return;
  event.respondWith(HANDLERS[strategy](event));
});

self.pathgridServiceWorker = {
  BUILD_ID,
  SHELL_CACHE,
  MAPS_CACHE,
  classifyRequest,
  collectPrecacheUrls,
};
