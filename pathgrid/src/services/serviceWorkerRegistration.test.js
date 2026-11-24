import {
  canRegisterServiceWorker,
  getBuildId,
  getServiceWorkerUrl,
  registerServiceWorker,
  unregisterServiceWorker,
} from './serviceWorkerRegistration';

const makeWindow = (href = 'https://pathgrid.app/', secure = true) => {
  const listeners = {};
  return {
    location: new URL(href),
    isSecureContext: secure,
    addEventListener: jest.fn((type, callback) => { listeners[type] = callback; }),
    fire: (type) => listeners[type]?.(),
  };
};

const makeDocument = (scriptSrcs = ['/static/js/main.1a2b3c4d.js'], readyState = 'complete') => {
  document.body.innerHTML = scriptSrcs.map((src) => `<script src="${src}"></script>`).join('');
  return { readyState, querySelectorAll: (selector) => document.querySelectorAll(selector) };
};

/** Fake registration that can simulate an install lifecycle. */
const makeRegistration = () => {
  const listeners = {};
  return {
    installing: null,
    addEventListener: jest.fn((type, callback) => { listeners[type] = callback; }),
    unregister: jest.fn().mockResolvedValue(true),
    simulateInstall(worker) {
      this.installing = worker;
      listeners.updatefound();
    },
  };
};

const makeWorker = () => {
  const listeners = {};
  return {
    state: 'installing',
    addEventListener: (type, callback) => { listeners[type] = callback; },
    finish() {
      this.state = 'installed';
      listeners.statechange();
    },
  };
};

const makeNavigator = ({ registration = makeRegistration(), controller = null, fail = null } = {}) => ({
  serviceWorker: {
    controller,
    ready: Promise.resolve(registration),
    register: fail ? jest.fn().mockRejectedValue(fail) : jest.fn().mockResolvedValue(registration),
  },
});

const base = (overrides = {}) => ({
  env: 'production',
  publicUrl: '',
  navigatorRef: makeNavigator(),
  windowRef: makeWindow(),
  documentRef: makeDocument(),
  ...overrides,
});

describe('getBuildId / getServiceWorkerUrl', () => {
  test('reads the content hash of the main bundle', () => {
    expect(getBuildId(makeDocument(['/static/js/453.aa.chunk.js', '/static/js/main.9b8f9e63.js']))).toBe('9b8f9e63');
  });

  test("falls back to 'dev' without a hashed main bundle", () => {
    expect(getBuildId(makeDocument(['/static/js/bundle.js']))).toBe('dev');
    expect(getBuildId(undefined)).toBe('dev');
  });

  test('builds a versioned worker URL under PUBLIC_URL', () => {
    expect(getServiceWorkerUrl('', 'abc')).toBe('/service-worker.js?v=abc');
    expect(getServiceWorkerUrl('/pathgrid', 'x y')).toBe('/pathgrid/service-worker.js?v=x%20y');
  });
});

describe('canRegisterServiceWorker', () => {
  test('true for a production build on a secure, same-origin page', () => {
    expect(canRegisterServiceWorker(base())).toBe(true);
    expect(canRegisterServiceWorker(base({ windowRef: makeWindow('http://localhost:3000/') }))).toBe(true);
  });

  test.each([
    ['development builds', { env: 'development' }],
    ['test runs', { env: 'test' }],
    ['browsers without service workers', { navigatorRef: {} }],
    ['insecure (http) pages', { windowRef: makeWindow('http://pathgrid.app/', false) }],
    ['assets served from another origin', { publicUrl: 'https://cdn.example.com/pathgrid' }],
  ])('false for %s', (_, overrides) => {
    expect(canRegisterServiceWorker(base(overrides))).toBe(false);
  });
});

describe('registerServiceWorker', () => {
  test('registers the versioned worker with the app scope once loaded', async () => {
    const options = base();
    const registration = await registerServiceWorker(options);
    expect(options.navigatorRef.serviceWorker.register)
      .toHaveBeenCalledWith('/service-worker.js?v=1a2b3c4d', { scope: '/' });
    expect(registration).not.toBeNull();
  });

  test('waits for the window load event before registering', async () => {
    const options = base({ documentRef: makeDocument(undefined, 'loading') });
    const pending = registerServiceWorker(options);
    expect(options.navigatorRef.serviceWorker.register).not.toHaveBeenCalled();
    expect(options.windowRef.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });

    options.windowRef.fire('load');
    await pending;
    expect(options.navigatorRef.serviceWorker.register).toHaveBeenCalledTimes(1);
  });

  test('does nothing outside production', async () => {
    const options = base({ env: 'development' });
    await expect(registerServiceWorker(options)).resolves.toBeNull();
    expect(options.navigatorRef.serviceWorker.register).not.toHaveBeenCalled();
  });

  test('reports registration failures and resolves null', async () => {
    const error = new Error('SecurityError');
    const onError = jest.fn();
    await expect(registerServiceWorker(base({ navigatorRef: makeNavigator({ fail: error }), onError })))
      .resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(error);
  });

  test('calls onSuccess on first install (no controller yet)', async () => {
    const registration = makeRegistration();
    const onSuccess = jest.fn();
    const onUpdate = jest.fn();
    await registerServiceWorker(base({ navigatorRef: makeNavigator({ registration }), onSuccess, onUpdate }));

    const worker = makeWorker();
    registration.simulateInstall(worker);
    worker.finish();
    expect(onSuccess).toHaveBeenCalledWith(registration);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('calls onUpdate when a new worker replaces an active one', async () => {
    const registration = makeRegistration();
    const onSuccess = jest.fn();
    const onUpdate = jest.fn();
    await registerServiceWorker(base({
      navigatorRef: makeNavigator({ registration, controller: {} }), onSuccess, onUpdate,
    }));

    const worker = makeWorker();
    registration.simulateInstall(worker);
    worker.finish();
    expect(onUpdate).toHaveBeenCalledWith(registration);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('unregisterServiceWorker', () => {
  test('unregisters the active registration', async () => {
    const registration = makeRegistration();
    await expect(unregisterServiceWorker(makeNavigator({ registration }))).resolves.toBe(true);
    expect(registration.unregister).toHaveBeenCalled();
  });

  test('returns false without service worker support', async () => {
    await expect(unregisterServiceWorker({})).resolves.toBe(false);
  });
});
