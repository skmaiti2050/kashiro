// Web Task 5, review focus 5: offline after the first visit, and a new deploy mid-review. The worker precaches the
// build's files in a cache named by the build and serves them cache-first; the page offers "Updated. Reload when
// you're ready" for a new worker and reloads only after Reload is clicked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchServiceWorker } from '@/ui/web/useServiceWorker';

const SITE = 'https://example.github.io';
const BASE = `${SITE}/kashiro/`;
const FILES = ['assets/index-abc.js', 'assets/harper_wasm_bg-def.wasm', 'dictionary/oewn.json.gz', 'index.html'];

/** A Cache Storage stand-in: named caches of URL → body. */
class FakeCache {
  readonly bodies = new Map<string, string>();
  async addAll(requests: Request[]): Promise<void> {
    for (const request of requests) {
      const response = await fetch(request);
      if (!response.ok) throw new TypeError(`${request.url}: ${response.status}`);
      this.bodies.set(request.url, await response.text());
    }
  }
  async match(request: Request | string): Promise<Response | undefined> {
    const body = this.bodies.get(typeof request === 'string' ? request : request.url);
    return body === undefined ? undefined : new Response(body);
  }
}

class FakeCacheStorage {
  readonly named = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.named.has(name)) this.named.set(name, new FakeCache());
    return this.named.get(name)!;
  }
  async keys(): Promise<string[]> {
    return [...this.named.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.named.delete(name);
  }
}

type Listener = (event: unknown) => void;

/** The worker's global scope: the listeners the worker adds, and skipWaiting. */
function fakeScope() {
  const listeners = new Map<string, Listener>();
  return {
    location: { href: `${BASE}sw.js` },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    listeners,
  };
}

/** An install or activate event; `done` is what the worker asked the browser to wait for. */
function lifecycleEvent() {
  const event = { done: Promise.resolve() as Promise<unknown>, waitUntil: (promise: Promise<unknown>) => (event.done = promise) };
  return event;
}

function fetchEvent(request: Request) {
  const event = {
    request,
    answer: null as Promise<Response> | null,
    respondWith: (response: Promise<Response>) => (event.answer = response),
  };
  return event;
}

let scope: ReturnType<typeof fakeScope>;
let storage: FakeCacheStorage;
const network = vi.fn(async (input: Request | string) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === `${BASE}precache.json`) return Response.json({ build: 'build-2', files: FILES });
  return new Response(`network: ${url}`);
});

async function startWorker(): Promise<void> {
  vi.resetModules();
  scope = fakeScope();
  storage = new FakeCacheStorage();
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', network);
  vi.stubEnv('VITE_KASHIRO_BUILD_ID', 'build-2');
  await import('@/web/serviceWorker');
}

async function install(): Promise<void> {
  const event = lifecycleEvent();
  scope.listeners.get('install')!(event);
  await event.done;
}

/** The worker's answer to `request`, or null when it leaves the request to the browser. */
async function answer(request: Request): Promise<string | null> {
  const event = fetchEvent(request);
  scope.listeners.get('fetch')!(event);
  return event.answer ? (await event.answer).text() : null;
}

beforeEach(async () => {
  network.mockClear();
  await startWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the service worker', () => {
  it('install precaches every file of precache.json in a cache named by the build', async () => {
    await install();
    expect([...storage.named.keys()]).toEqual(['kashiro-build-2']);
    expect([...storage.named.get('kashiro-build-2')!.bodies.keys()].sort()).toEqual(FILES.map((file) => BASE + file).sort());
  });

  it('install does not take over from the running version by itself', async () => {
    await install();
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it('serves a precached file from the cache, without the network', async () => {
    await install();
    network.mockClear();
    expect(await answer(new Request(`${BASE}assets/harper_wasm_bg-def.wasm`))).toBe(`network: ${BASE}assets/harper_wasm_bg-def.wasm`);
    expect(network).not.toHaveBeenCalled();
  });

  it('serves the cached page for a navigation to the base (offline start)', async () => {
    await install();
    network.mockClear();
    // Only the browser makes navigation requests (new Request refuses mode 'navigate').
    const navigation = { url: BASE, method: 'GET', mode: 'navigate' } as Request;
    expect(await answer(navigation)).toBe(`network: ${BASE}index.html`);
    expect(network).not.toHaveBeenCalled();
  });

  it('fetches a same-origin file it has not cached from the network', async () => {
    await install();
    expect(await answer(new Request(`${BASE}unknown.txt`))).toBe(`network: ${BASE}unknown.txt`);
  });

  it('leaves other origins and non-GET requests to the browser', async () => {
    await install();
    expect(await answer(new Request('https://cdn.example.com/x.js'))).toBeNull();
    expect(await answer(new Request(`${BASE}index.html`, { method: 'POST', body: 'x' }))).toBeNull();
  });

  it('activate deletes the caches of earlier builds and keeps other apps’ caches', async () => {
    await storage.open('kashiro-build-1');
    await storage.open('another-app');
    await install();
    const event = lifecycleEvent();
    scope.listeners.get('activate')!(event);
    await event.done;
    expect([...storage.named.keys()].sort()).toEqual(['another-app', 'kashiro-build-2']);
  });

  it('takes over only when the page asks (after the user clicks Reload)', () => {
    scope.listeners.get('message')!({ data: { type: 'something-else' } });
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    scope.listeners.get('message')!({ data: { type: 'skip-waiting' } });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

class FakeWorker extends EventTarget {
  state = 'installing';
  readonly postMessage = vi.fn();
  become(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  /** The browser found a new sw.js and starts installing it. */
  found(): FakeWorker {
    this.installing = new FakeWorker();
    this.dispatchEvent(new Event('updatefound'));
    return this.installing;
  }
}

class FakeContainer extends EventTarget {
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(async () => this.registration);
  constructor(public controller: object | null) {
    super();
  }
}

describe('the page’s update notice', () => {
  async function watch(container: FakeContainer) {
    const offers: (() => void)[] = [];
    const reload = vi.fn();
    await watchServiceWorker(container as unknown as ServiceWorkerContainer, '/kashiro/sw.js', (apply) => offers.push(apply), reload);
    return { offers, reload };
  }

  it('registers the worker under the base path', async () => {
    const container = new FakeContainer(null);
    await watch(container);
    expect(container.register).toHaveBeenCalledWith('/kashiro/sw.js');
  });

  it('the first visit’s install is not an update: no notice', async () => {
    const container = new FakeContainer(null);
    const { offers, reload } = await watch(container);
    container.registration.found().become('installed');
    expect(offers).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a new version installed mid-review offers the notice and does not reload', async () => {
    const container = new FakeContainer({});
    const { offers, reload } = await watch(container);
    container.registration.found().become('installed');
    expect(offers).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a version already waiting when the page opens is offered too', async () => {
    const container = new FakeContainer({});
    container.registration.waiting = new FakeWorker();
    const { offers } = await watch(container);
    expect(offers).toHaveLength(1);
  });

  it('Reload asks the new worker to take over, then reloads once it has', async () => {
    const container = new FakeContainer({});
    const { offers, reload } = await watch(container);
    const worker = container.registration.found();
    worker.become('installed');
    offers[0]();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a new version taking over from another tab does not reload this one', async () => {
    const container = new FakeContainer({});
    const { reload } = await watch(container);
    container.registration.found().become('installed');
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
});
