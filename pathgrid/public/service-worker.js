/* eslint-disable no-restricted-globals */
/**
 * PathGrid service worker: offline app shell + map asset caching.
 *
 * Caching strategy (PRD 5.3):
 *  - Install: precache the app shell (index.html, manifest, icons) and every
 *    JS/CSS file listed in CRA's asset-manifest.json, including lazy chunks.
 *    Each file is cached independently, so one missing asset never prevents
 *    index.html from being cached or the worker from installing.
 *  - HTML documents (navigations to any SPA route, e.g. /admin/settings):
 *    network-first with a short timeout, falling back to the cached
 *    index.html, then to an offline page. Never a synthetic error response.
 *  - /static/* (content-hashed, immutable): cache-first.
 *  - Floor-plan images from Firebase Storage: stale-while-revalidate in a
 *    long-lived, size-capped cache so visited maps keep their blueprints.
 *  - Other same-origin GETs: stale-while-revalidate.
 *  - Browser prefetch/prerender requests, Firestore, Auth and all other
 *    cross-origin traffic: never intercepted. Firestore's own IndexedDB
 *    persistence handles map data offline.
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

const getHeader = (request, name) => {
  try {
    return (request.headers && typeof request.headers.get === 'function' && request.headers.get(name)) || '';
  } catch {
    return '';
  }
};

/** Speculative loads (Chrome preload/prefetch/prerender) are left to the browser. */
const isSpeculativeLoad = (request) =>
  /prefetch|prerender/i.test(`${getHeader(request, 'Sec-Purpose')} ${getHeader(request, 'Purpose')}`);

/** True for requests that expect an HTML page (any SPA route). */
const wantsHtmlDocument = (request) => request.mode === 'navigate'
  || request.destination === 'document'
  || getHeader(request, 'Accept').includes('text/html');

/**
 * Decides how a request is handled.
 * @returns {'bypass'|'navigation'|'static'|'map-asset'|'stale-while-revalidate'}
 */
function classifyRequest(request, scopeHref) {
  if (request.method !== 'GET') return 'bypass';
  if (isSpeculativeLoad(request)) return 'bypass';
  const url = new URL(request.url);
  const scope = new URL(scopeHref);

  if (url.origin !== scope.origin) {
    return isMapImageHost(url.hostname) && request.destination !== 'document' ? 'map-asset' : 'bypass';
  }
  if (!url.pathname.startsWith(scope.pathname)) return 'bypass';

  const path = url.pathname.slice(scope.pathname.length);
  if (path === 'service-worker.js' || path === 'asset-manifest.json') return 'bypass';
  if (wantsHtmlDocument(request)) return 'navigation';
  if (path.startsWith('static/')) return 'static';
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
/* Response helpers                                                           */
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

/** A same-origin, successful, non-redirected response we may store as the shell. */
const isStorableResponse = (response) => Boolean(response)
  && response.ok
  && !response.redirected
  && (response.type === 'basic' || response.type === 'default' || response.type === undefined);

/**
 * Browsers refuse redirected responses for navigations. Re-wrap one (e.g.
 * a host that redirects /index.html) into a plain response so it can be served.
 */
const unredirect = (response) => {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i]);
  }
}

/**
 * Caches each URL independently. Returns the URLs that failed; never throws,
 * so a single missing icon cannot abort installation.
 */
async function precache(cache, urls) {
  const results = await Promise.allSettled(urls.map(async (url) => {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'error'}`);
    await cache.put(request, unredirect(response));
  }));
  return urls.filter((_, index) => results[index].status === 'rejected');
}

/* ------------------------------------------------------------------------- */
/* Strategies                                                                 */
/* ------------------------------------------------------------------------- */

function handleNavigation(event) {
  const cacheReady = caches.open(SHELL_CACHE);
  const network = fetch(event.request);

  // Registered synchronously, so the cache refresh is always allowed to finish
  // (even when the timeout below wins) and the body is cloned before the page
  // starts reading it.
  event.waitUntil(network
    .then((response) => {
      if (!isStorableResponse(response)) return undefined;
      const copy = response.clone();
      return cacheReady.then((cache) => cache.put(SHELL_URL, copy));
    })
    .catch(() => undefined));

  const cachedShell = async () => {
    const cache = await cacheReady;
    const cached = (await cache.match(SHELL_URL)) || (await cache.match(SCOPE_URL.href));
    return cached ? unredirect(cached) : null;
  };

  return (async () => {
    try {
      const response = await withTimeout(network, NAVIGATION_TIMEOUT_MS);
      if (response && response.ok) return response;
      // Server error / missing rewrite: the cached SPA shell can still route.
      return (await cachedShell()) || response;
    } catch {
      // Offline or too slow: serve the cached shell for every SPA route.
      const shell = await cachedShell();
      if (shell) return shell;
      try {
        return await network;
      } catch {
        return offlineFallback();
      }
    }
  })();
}

async function handleCacheFirst(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isStorableResponse(response)) await cache.put(event.request, response.clone());
  return response;
}

async function handleStaleWhileRevalidate(event, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const network = fetch(event.request);
  event.waitUntil(network
    .then(async (response) => {
      if (!response || !response.ok) return;
      const copy = response.clone();
      await cache.put(event.request, copy);
      if (maxEntries) await trimCache(cache, maxEntries);
    })
    .catch(() => undefined));

  if (cached) return cached;
  // Uncached: hand back the real network result. If the network fails, the
  // request fails exactly as it would without a service worker, rather than
  // with a synthetic Response.error().
  return network;
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
    const failed = await precache(cache, CORE_ASSETS.map((path) => new URL(path, SCOPE_URL).href));

    try {
      const response = await fetch(new Request(new URL('asset-manifest.json', SCOPE_URL).href, { cache: 'reload' }));
      if (response.ok) {
        failed.push(...await precache(cache, collectPrecacheUrls(await response.json(), SCOPE_URL.href)));
      }
    } catch {
      // No asset manifest (e.g. dev server): runtime caching still applies.
    }

    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[PathGrid SW] Could not precache:', failed);
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
