/**
 * Unit tests for public/service-worker.js. The worker is evaluated in a
 * sandbox with fake Cache Storage, fetch, Request and Response, so its real
 * install / activate / fetch handlers are exercised.
 */
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
const ORIGIN = 'https://pathgrid.app';

class FakeRequest {
  constructor(url, init = {}) {
    this.url = typeof url === 'string' ? url : url.url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'cors';
    this.destination = init.destination ?? '';
    this.cache = init.cache;
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.headers = { get: (name) => headers[name.toLowerCase()] ?? null };
  }
}

class FakeResponse {
  constructor(body = '', init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = init.headers ?? {};
    this.type = 'basic';
    this.redirected = false;
  }

  clone() { return this; }

  async json() { return JSON.parse(this.body); }

  static error() {
    const response = new FakeResponse(null, { status: 0 });
    response.type = 'error';
    return response;
  }
}

const keyOf = (request) => (typeof request === 'string' ? request : request.url);

class FakeCache {
  constructor() { this.entries = new Map(); }

  async match(request) { return this.entries.get(keyOf(request)); }

  async put(request, response) { this.entries.set(keyOf(request), response); }

  async addAll(requests) {
    requests.forEach((request) => this.entries.set(keyOf(request), new FakeResponse(`precached ${keyOf(request)}`)));
  }

  async keys() { return [...this.entries.keys()].map((url) => new FakeRequest(url)); }

  async delete(request) { return this.entries.delete(keyOf(request)); }
}

class FakeCacheStorage {
  constructor() { this.stores = new Map(); }

  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name);
  }

  async keys() { return [...this.stores.keys()]; }

  async delete(name) { return this.stores.delete(name); }
}

/** Loads the worker with fresh fakes. */
const loadWorker = ({ build = 'abc123', fetchImpl = jest.fn() } = {}) => {
  const listeners = {};
  const self = {
    location: { href: `${ORIGIN}/service-worker.js?v=${build}` },
    addEventListener: (type, callback) => { listeners[type] = callback; },
    skipWaiting: jest.fn().mockResolvedValue(undefined),
    clients: { claim: jest.fn().mockResolvedValue(undefined) },
  };
  const caches = new FakeCacheStorage();
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Request', 'Response', SOURCE)(
    self, caches, fetchImpl, FakeRequest, FakeResponse,
  );
  return {
    self, caches, listeners, fetch: fetchImpl, api: self.pathgridServiceWorker,
  };
};

/** Dispatches an extendable event and waits for all waitUntil promises. */
const dispatchLifecycle = async (listener) => {
  const pending = [];
  listener({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
};

/** Dispatches a fetch event; resolves the response (or null if not handled). */
const dispatchFetch = async (listener, request) => {
  let responded = null;
  const background = [];
  listener({
    request,
    respondWith: (promise) => { responded = promise; },
    waitUntil: (promise) => background.push(promise),
  });
  const response = responded ? await responded : null;
  await Promise.all(background);
  return response;
};

const navigation = (pathname) => new FakeRequest(`${ORIGIN}${pathname}`, { mode: 'navigate', destination: 'document' });

describe('configuration', () => {
  test('the build id from the registration URL names the shell cache', () => {
    const { api } = loadWorker({ build: '9b8f9e63' });
    expect(api.BUILD_ID).toBe('9b8f9e63');
    expect(api.SHELL_CACHE).toBe('pathgrid-shell-9b8f9e63');
    expect(api.MAPS_CACHE).toBe('pathgrid-maps-v1');
  });
});

describe('classifyRequest', () => {
  const { api } = loadWorker();
  const classify = (url, init) => api.classifyRequest(new FakeRequest(url, init), `${ORIGIN}/`);

  test.each([
    ['page navigations', `${ORIGIN}/admin/editor`, { mode: 'navigate' }, 'navigation'],
    ['hashed build assets', `${ORIGIN}/static/js/main.abc.js`, {}, 'static'],
    ['hashed CSS', `${ORIGIN}/static/css/main.abc.css`, {}, 'static'],
    ['manifest and icons', `${ORIGIN}/manifest.json`, {}, 'stale-while-revalidate'],
    ['the worker itself', `${ORIGIN}/service-worker.js`, {}, 'bypass'],
    ['the asset manifest', `${ORIGIN}/asset-manifest.json`, {}, 'bypass'],
    ['non-GET requests', `${ORIGIN}/static/js/main.abc.js`, { method: 'POST' }, 'bypass'],
    ['Firestore traffic', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen', {}, 'bypass'],
    ['Firebase Auth', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', { method: 'POST' }, 'bypass'],
    ['floor-plan images in Storage', 'https://firebasestorage.googleapis.com/v0/b/x/o/fl01.webp', { destination: 'image' }, 'map-asset'],
    ['other cross-origin requests', 'https://example.com/tracker.js', {}, 'bypass'],
    // Regression: SPA routes requested without mode "navigate" must still get the
    // HTML shell strategy, never the asset strategy (which returned Response.error()).
    ['HTML requests that are not navigations', `${ORIGIN}/admin/settings`, { headers: { Accept: 'text/html,application/xhtml+xml' } }, 'navigation'],
    ['document-destination requests', `${ORIGIN}/admin/settings`, { destination: 'document' }, 'navigation'],
    ['Chrome prefetch of a page', `${ORIGIN}/admin/settings`, { headers: { 'Sec-Purpose': 'prefetch', Accept: 'text/html' } }, 'bypass'],
    ['prerender requests', `${ORIGIN}/help`, { mode: 'navigate', headers: { 'Sec-Purpose': 'prefetch;prerender' } }, 'bypass'],
  ])('%s → %s', (_, url, init, expected) => {
    expect(classify(url, init)).toBe(expected);
  });

  test('requests outside the app scope are ignored', () => {
    expect(api.classifyRequest(new FakeRequest(`${ORIGIN}/other/app.js`), `${ORIGIN}/pathgrid/`)).toBe('bypass');
  });
});

describe('collectPrecacheUrls', () => {
  test('keeps JS/CSS/HTML from the CRA asset manifest, drops source maps and licenses', () => {
    const { api } = loadWorker();
    const urls = api.collectPrecacheUrls({
      files: {
        'main.css': '/static/css/main.656e2d02.css',
        'main.js': '/static/js/main.8cb72d3a.js',
        'static/js/887.a673eb81.chunk.js': '/static/js/887.a673eb81.chunk.js',
        'index.html': '/index.html',
        'main.js.map': '/static/js/main.8cb72d3a.js.map',
        'main.js.LICENSE.txt': '/static/js/main.8cb72d3a.js.LICENSE.txt',
      },
      entrypoints: ['static/css/main.656e2d02.css', 'static/js/main.8cb72d3a.js'],
    }, `${ORIGIN}/`);
    expect(urls.sort()).toEqual([
      `${ORIGIN}/index.html`,
      `${ORIGIN}/static/css/main.656e2d02.css`,
      `${ORIGIN}/static/js/887.a673eb81.chunk.js`,
      `${ORIGIN}/static/js/main.8cb72d3a.js`,
    ]);
    expect(api.collectPrecacheUrls(null, `${ORIGIN}/`)).toEqual([]);
  });
});

describe('install and activate', () => {
  test('install precaches the shell plus every build asset, then activates immediately', async () => {
    const assetManifest = {
      files: { 'main.js': '/static/js/main.1.js', 'static/js/9.chunk.js': '/static/js/9.chunk.js' },
      entrypoints: ['static/js/main.1.js'],
    };
    const fetchImpl = jest.fn().mockResolvedValue(new FakeResponse(JSON.stringify(assetManifest)));
    const worker = loadWorker({ fetchImpl });

    await dispatchLifecycle(worker.listeners.install);

    const shell = await worker.caches.open('pathgrid-shell-abc123');
    const cached = [...shell.entries.keys()];
    expect(cached).toEqual(expect.arrayContaining([
      `${ORIGIN}/`, `${ORIGIN}/index.html`, `${ORIGIN}/manifest.json`, `${ORIGIN}/logo512.png`,
      `${ORIGIN}/static/js/main.1.js`, `${ORIGIN}/static/js/9.chunk.js`,
    ]));
    const manifestCall = fetchImpl.mock.calls.find(([request]) => request.url.endsWith('/asset-manifest.json'));
    expect(manifestCall[0]).toMatchObject({ cache: 'reload' });
    expect(fetchImpl.mock.calls.every(([request]) => request.cache === 'reload')).toBe(true);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  test('install still succeeds when no asset manifest is available', async () => {
    const fetchImpl = jest.fn(async (request) => {
      if (request.url.endsWith('/asset-manifest.json')) throw new TypeError('offline');
      return new FakeResponse(`body of ${request.url}`);
    });
    const worker = loadWorker({ fetchImpl });
    await dispatchLifecycle(worker.listeners.install);
    expect((await worker.caches.open('pathgrid-shell-abc123')).entries.has(`${ORIGIN}/index.html`)).toBe(true);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  test('a missing icon does not stop index.html being cached or the worker installing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = jest.fn(async (request) => {
      if (request.url.endsWith('/maskable-512.png')) return new FakeResponse('Not found', { status: 404 });
      if (request.url.endsWith('/apple-touch-icon.png')) throw new TypeError('network');
      if (request.url.endsWith('/asset-manifest.json')) {
        return new FakeResponse(JSON.stringify({ files: { 'main.js': '/static/js/main.1.js' } }));
      }
      return new FakeResponse(`body of ${request.url}`);
    });
    const worker = loadWorker({ fetchImpl });

    await dispatchLifecycle(worker.listeners.install);

    const shell = await worker.caches.open('pathgrid-shell-abc123');
    expect(shell.entries.has(`${ORIGIN}/index.html`)).toBe(true);
    expect(shell.entries.has(`${ORIGIN}/static/js/main.1.js`)).toBe(true);
    expect(shell.entries.has(`${ORIGIN}/maskable-512.png`)).toBe(false);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[PathGrid SW] Could not precache:', [
      `${ORIGIN}/maskable-512.png`, `${ORIGIN}/apple-touch-icon.png`,
    ]);
    warn.mockRestore();
  });

  test('activate removes shell caches from older builds but keeps map assets', async () => {
    const worker = loadWorker({ build: 'new' });
    await worker.caches.open('pathgrid-shell-old');
    await worker.caches.open('pathgrid-shell-new');
    await worker.caches.open('pathgrid-maps-v1');
    await worker.caches.open('some-other-app');

    await dispatchLifecycle(worker.listeners.activate);

    expect((await worker.caches.keys()).sort()).toEqual(['pathgrid-maps-v1', 'pathgrid-shell-new', 'some-other-app']);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });
});

describe('fetch strategies', () => {
  test('bypassed requests are left to the network (respondWith not called)', async () => {
    const worker = loadWorker();
    const response = await dispatchFetch(
      worker.listeners.fetch,
      new FakeRequest('https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents/floors'),
    );
    expect(response).toBeNull();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  test('online navigation returns the network page and refreshes the cached shell', async () => {
    const page = new FakeResponse('<html>fresh</html>');
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(page) });

    expect(await dispatchFetch(worker.listeners.fetch, navigation('/help'))).toBe(page);
    expect((await worker.caches.open('pathgrid-shell-abc123')).entries.get(`${ORIGIN}/index.html`)).toBe(page);
  });

  test('offline navigation to any route falls back to the cached app shell', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    const shell = new FakeResponse('<html>shell</html>');
    await (await worker.caches.open('pathgrid-shell-abc123')).put(`${ORIGIN}/index.html`, shell);

    expect(await dispatchFetch(worker.listeners.fetch, navigation('/admin/dashboard'))).toBe(shell);
  });

  test('regression: a non-navigate HTML request for /admin/settings offline gets the shell, not an error', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    const shell = new FakeResponse('<html>shell</html>');
    await (await worker.caches.open('pathgrid-shell-abc123')).put(`${ORIGIN}/index.html`, shell);

    const response = await dispatchFetch(
      worker.listeners.fetch,
      new FakeRequest(`${ORIGIN}/admin/settings`, { headers: { Accept: 'text/html' } }),
    );
    expect(response).toBe(shell);
    expect(response.type).not.toBe('error');
  });

  test('a server error on navigation falls back to the cached shell', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(new FakeResponse('oops', { status: 500 })) });
    const shell = new FakeResponse('<html>shell</html>');
    await (await worker.caches.open('pathgrid-shell-abc123')).put(`${ORIGIN}/index.html`, shell);

    expect(await dispatchFetch(worker.listeners.fetch, navigation('/admin/settings'))).toBe(shell);
  });

  test('error pages and redirects are never stored as the shell', async () => {
    const redirected = new FakeResponse('<html>login page</html>');
    redirected.redirected = true;
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(redirected) });

    await dispatchFetch(worker.listeners.fetch, navigation('/'));
    expect((await worker.caches.open('pathgrid-shell-abc123')).entries.has(`${ORIGIN}/index.html`)).toBe(false);
  });

  test('a cached shell that was redirected is re-wrapped so navigations accept it', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockRejectedValue(new TypeError('offline')) });
    const redirectedShell = new FakeResponse('<html>shell</html>', { status: 200 });
    redirectedShell.redirected = true;
    await (await worker.caches.open('pathgrid-shell-abc123')).put(`${ORIGIN}/index.html`, redirectedShell);

    const response = await dispatchFetch(worker.listeners.fetch, navigation('/admin/editor'));
    expect(response).not.toBe(redirectedShell);
    expect(response.redirected).toBe(false);
    expect(response.body).toBe('<html>shell</html>');
  });

  test('offline navigation with nothing cached shows an offline page', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    const response = await dispatchFetch(worker.listeners.fetch, navigation('/'));
    expect(response.status).toBe(503);
    expect(response.body).toMatch(/You're offline/);
  });

  test('static assets are served cache-first', async () => {
    const worker = loadWorker();
    const cachedJs = new FakeResponse('cached js');
    const url = `${ORIGIN}/static/js/main.abc.js`;
    await (await worker.caches.open('pathgrid-shell-abc123')).put(url, cachedJs);

    expect(await dispatchFetch(worker.listeners.fetch, new FakeRequest(url))).toBe(cachedJs);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  test('uncached static assets are fetched once and stored', async () => {
    const js = new FakeResponse('chunk');
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(js) });
    const url = `${ORIGIN}/static/js/887.chunk.js`;

    expect(await dispatchFetch(worker.listeners.fetch, new FakeRequest(url))).toBe(js);
    expect((await worker.caches.open('pathgrid-shell-abc123')).entries.get(url)).toBe(js);
  });

  test('floor-plan images: cached copy first, refreshed in the background', async () => {
    const fresh = new FakeResponse('new image');
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(fresh) });
    const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/fl01.webp';
    const stale = new FakeResponse('old image');
    await (await worker.caches.open('pathgrid-maps-v1')).put(url, stale);

    const response = await dispatchFetch(worker.listeners.fetch, new FakeRequest(url, { destination: 'image' }));

    expect(response).toBe(stale);
    expect((await worker.caches.open('pathgrid-maps-v1')).entries.get(url)).toBe(fresh);
  });

  test('the map image cache is capped', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockImplementation(async () => new FakeResponse('img')) });
    for (let i = 0; i < 65; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await dispatchFetch(
        worker.listeners.fetch,
        new FakeRequest(`https://firebasestorage.googleapis.com/v0/b/x/o/${i}.webp`, { destination: 'image' }),
      );
    }
    const maps = await worker.caches.open('pathgrid-maps-v1');
    expect(maps.entries.size).toBe(60);
    expect(maps.entries.has('https://firebasestorage.googleapis.com/v0/b/x/o/0.webp')).toBe(false);
  });

  test('an uncached asset that fails offline fails like a normal network error (no synthetic Response.error)', async () => {
    const worker = loadWorker({ fetchImpl: jest.fn().mockRejectedValue(new TypeError('offline')) });
    await expect(dispatchFetch(worker.listeners.fetch, new FakeRequest(`${ORIGIN}/logo192.png`)))
      .rejects.toThrow('offline');
  });

  test('an uncached asset returns the real network response (including 404s)', async () => {
    const notFound = new FakeResponse('missing', { status: 404 });
    const worker = loadWorker({ fetchImpl: jest.fn().mockResolvedValue(notFound) });
    const response = await dispatchFetch(worker.listeners.fetch, new FakeRequest(`${ORIGIN}/nope.png`));
    expect(response).toBe(notFound);
    expect((await worker.caches.open('pathgrid-shell-abc123')).entries.has(`${ORIGIN}/nope.png`)).toBe(false);
  });
});
