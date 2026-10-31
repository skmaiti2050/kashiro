// Web Task 5, review focus 5: offline after the first visit, and a new deploy mid-review. The worker precaches the
// build's files in a cache named by the build (the wasm and dictionary on first use, Task 7 fix) and serves them
// cache-first; the page offers "Updated. Reload when you're ready" for a new worker and reloads only after Reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchServiceWorker } from '@/ui/web/useServiceWorker';

const SITE = 'https://example.github.io';
const BASE = `${SITE}/kashiro/`;
const FILES = ['assets/index-abc.js', 'index.html'];
const WASM = `${BASE}assets/harper_wasm_bg-def.wasm`;
const DICTIONARY = `${BASE}dictionary/oewn.json.gz`;
const ON_FIRST_USE = ['assets/harper_wasm_bg-def.wasm', 'dictionary/oewn.json.gz'];

const urlOf = (request: Request | string) => (typeof request === 'string' ? request : request.url);

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
  async put(request: Request | string, response: Response): Promise<void> {
    this.bodies.set(urlOf(request), await response.text());
  }
  async match(request: Request | string): Promise<Response | undefined> {
    const body = this.bodies.get(urlOf(request));
    return body === undefined ? undefined : new Response(body);
  }
}

class FakeCacheStorage {
  readonly named = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.named.has(name)) this.named.set(name, new FakeCache());
    return this.named.get(name)!;
  }
  /** Searches every cache, as caches.match does. */
  async match(request: Request | string): Promise<Response | undefined> {
    for (const cache of this.named.values()) {
      const found = await cache.match(request);
      if (found) return found;
    }
    return undefined;
  }
  async keys(): Promise<string[]> {
    return [...this.named.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.named.delete(name);
  }
}

/** The browser's HTTP cache: what a `cache: 'only-if-cached'` request can get without the network. */
const httpCache = new Set<string>();

type Listener = (event: unknown) => void;

/** The worker's global scope: the listeners the worker adds, and skipWaiting. */
function fakeScope() {
  const listeners = new Map<string, Listener>();
  return {
    location: { href: `${BASE}sw.js` },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
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
    /** What the worker still does after answering (caching the response). */
    pending: [] as Promise<unknown>[],
    respondWith: (response: Promise<Response>) => (event.answer = response),
    waitUntil: (promise: Promise<unknown>) => event.pending.push(promise),
  };
  return event;
}

let scope: ReturnType<typeof fakeScope>;
let storage: FakeCacheStorage;
const network = vi.fn(async (input: Request | string) => {
  const url = urlOf(input);
  if (typeof input !== 'string' && input.cache === 'only-if-cached') {
    return httpCache.has(url) ? new Response(`http cache: ${url}`) : new Response(null, { status: 504 });
  }
  if (url === `${BASE}precache.json`) return Response.json({ build: 'build-2', files: FILES, onFirstUse: ON_FIRST_USE });
  if (url.endsWith('/missing.txt')) return new Response('not found', { status: 404 });
  return new Response(`network: ${url}`);
});

/** The requests that went to the network for `url` (not the ones answered by the HTTP cache alone). */
const downloadsOf = (url: string) =>
  network.mock.calls.filter(([input]) => urlOf(input) === url && (typeof input === 'string' || input.cache !== 'only-if-cached')).length;

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
  if (!event.answer) return null;
  const text = await (await event.answer).text();
  await Promise.all(event.pending);
  return text;
}

async function activate(): Promise<void> {
  const event = lifecycleEvent();
  scope.listeners.get('activate')!(event);
  await event.done;
}

beforeEach(async () => {
  network.mockClear();
  httpCache.clear();
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
    expect(await answer(new Request(`${BASE}assets/index-abc.js`))).toBe(`network: ${BASE}assets/index-abc.js`);
    expect(network).not.toHaveBeenCalled();
  });

  // Task 7 fix: the loading screen downloads the wasm with progress; install must not download it a second time.
  it('install does not download the wasm or the dictionary', async () => {
    await install();
    expect(downloadsOf(WASM)).toBe(0);
    expect(downloadsOf(DICTIONARY)).toBe(0);
    expect(storage.named.get('kashiro-build-2')!.bodies.has(WASM)).toBe(false);
  });

  it('caches the wasm in the current cache on its first fetch, and serves the next fetch from it', async () => {
    await install();
    expect(await answer(new Request(WASM))).toBe(`network: ${WASM}`);
    expect(storage.named.get('kashiro-build-2')!.bodies.get(WASM)).toBe(`network: ${WASM}`);
    expect(downloadsOf(WASM)).toBe(1);
    expect(await answer(new Request(WASM))).toBe(`network: ${WASM}`);
    expect(downloadsOf(WASM)).toBe(1);
  });

  it('caches the dictionary on first use too (word lookup offline)', async () => {
    await install();
    await answer(new Request(DICTIONARY));
    network.mockClear();
    expect(await answer(new Request(DICTIONARY))).toBe(`network: ${DICTIONARY}`);
    expect(network).not.toHaveBeenCalled();
  });

  it('install keeps the wasm the loading screen already downloaded (HTTP cache), without the network', async () => {
    httpCache.add(WASM);
    await install();
    expect(storage.named.get('kashiro-build-2')!.bodies.get(WASM)).toBe(`http cache: ${WASM}`);
    expect(downloadsOf(WASM)).toBe(0);
  });

  it('install carries an unchanged wasm over from the previous build’s cache', async () => {
    (await storage.open('kashiro-build-1')).bodies.set(WASM, 'old build wasm');
    await install();
    expect(storage.named.get('kashiro-build-2')!.bodies.get(WASM)).toBe('old build wasm');
    expect(downloadsOf(WASM)).toBe(0);
  });

  it('does not cache a failed response', async () => {
    await install();
    await answer(new Request(`${BASE}missing.txt`));
    expect(storage.named.get('kashiro-build-2')!.bodies.has(`${BASE}missing.txt`)).toBe(false);
  });

  it('activate takes control of the first visit’s page, so its first word lookup is cached', async () => {
    await install();
    await activate();
    expect(scope.clients.claim).toHaveBeenCalledTimes(1);
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
    await activate();
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
  async function watch(container: FakeContainer, refetch: (url: string) => void = () => {}) {
    const offers: (() => void)[] = [];
    const reload = vi.fn();
    await watchServiceWorker(container as unknown as ServiceWorkerContainer, '/kashiro/sw.js', (apply) => offers.push(apply), reload, {
      firstUse: [WASM],
      refetch,
    });
    return { offers, reload };
  }

  // Final review item 5: another tab applied the update, so this page's worker is no longer waiting.
  it('Reload when the new version already took over elsewhere reloads at once', async () => {
    const container = new FakeContainer({});
    const { offers, reload } = await watch(container);
    const worker = container.registration.found();
    worker.become('installed');
    worker.become('activated');
    offers[0]();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Final review item 6: Safari refuses only-if-cached, so the worker can't take the first visit's wasm from the HTTP
  // cache at install. Once it controls the page, the page asks for the wasm again and the worker caches it.
  it('the first visit fetches the first-use files again once the worker controls the page', async () => {
    const container = new FakeContainer(null);
    const refetch = vi.fn();
    const { reload } = await watch(container, refetch);
    expect(refetch).not.toHaveBeenCalled();
    container.controller = {};
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(refetch.mock.calls).toEqual([[WASM]]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a page the worker already controlled fetches nothing again', async () => {
    const container = new FakeContainer({});
    const refetch = vi.fn();
    await watch(container, refetch);
    container.registration.found().become('installed');
    container.dispatchEvent(new Event('controllerchange'));
    expect(refetch).not.toHaveBeenCalled();
  });

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
