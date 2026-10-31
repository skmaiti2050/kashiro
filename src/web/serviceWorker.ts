// The web app's service worker, built to sw.js by scripts/build-web.ts (spec: "Offline / PWA"). It precaches the
// build's files and answers same-origin GETs from that cache, so after the first visit the app starts offline.
// A new deploy installs a new cache and waits: the page offers "Updated. Reload when you're ready", and this worker
// takes over only when the user clicks Reload (it never reloads a page mid-review).

/** The parts of the service worker scope used here (the DOM lib this project compiles with has no worker types). */
interface LifecycleEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends LifecycleEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  readonly location: { readonly href: string };
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  skipWaiting(): Promise<void>;
}

const worker = self as unknown as WorkerScope;

/** Every Kashiro cache starts with this; the build id (set by build-web.ts) makes each deploy's cache its own. */
const CACHE_PREFIX = 'kashiro-';
const CACHE = CACHE_PREFIX + import.meta.env.VITE_KASHIRO_BUILD_ID;

/** URLs relative to sw.js, which sits at the site's base path. */
const siteUrl = (path: string) => new URL(path, worker.location.href).href;

/**
 * `files` are downloaded now. `onFirstUse` (Harper's wasm, the dictionary) are not: the loading screen downloads the
 * wasm anyway, and fetching it here too doubled a first visit's 20 MB. They are kept if a copy is already at hand,
 * and otherwise cached when the page first fetches them (cacheFirst).
 */
async function precache(): Promise<void> {
  // no-cache: revalidate with the server, so a list or page the HTTP cache still holds from the last deploy isn't used.
  const listed = await fetch(siteUrl('precache.json'), { cache: 'no-cache' });
  if (!listed.ok) throw new Error(`precache.json: ${listed.status}`);
  const { files, onFirstUse } = (await listed.json()) as { files: string[]; onFirstUse: string[] };
  const cache = await caches.open(CACHE);
  await cache.addAll(files.map((file) => new Request(siteUrl(file), { cache: 'no-cache' })));
  await Promise.all(onFirstUse.map((file) => keepCopyAtHand(cache, siteUrl(file))));
}

/**
 * Caches `url` from a copy that needs no download: the previous build's cache (an update that kept the same wasm), or
 * the browser's HTTP cache (the first visit's loading screen downloaded the wasm before this worker was registered).
 * Otherwise does nothing; the page's next fetch caches it. Safari refuses only-if-cached: there the page fetches the
 * wasm again once this worker controls it (src/ui/web/useServiceWorker.ts), so a first visit still works offline.
 */
async function keepCopyAtHand(cache: Cache, url: string): Promise<void> {
  const previous = await caches.match(url);
  if (previous) return cache.put(url, previous);
  const httpCached = await fetch(new Request(url, { cache: 'only-if-cached', mode: 'same-origin' })).catch(() => null);
  if (httpCached?.ok) await cache.put(url, httpCached);
}

/** Deletes earlier builds' caches; another app's caches on the same origin are left alone. */
async function deleteOldCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
}

/**
 * Cache first; a page load (the base path, or any page URL) gets the cached index.html. A file the cache doesn't
 * have yet (the on-first-use files) is cached as it is fetched, so it is downloaded once and then works offline.
 */
async function cacheFirst(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const cache = await caches.open(CACHE);
  if (request.mode === 'navigate') return (await cache.match(siteUrl('index.html'))) ?? fetch(request);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // 200 only: not an error page, and not a 206 part of a file (a range request). The page gets the response while
  // it is cached (waitUntil, not await), so the loading screen still sees the wasm's progress.
  if (response.status === 200) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

worker.addEventListener('install', (event) => event.waitUntil(precache()));
// claim: the first visit's page has no worker until now; controlling it means its first word lookup is cached. After
// an update this changes nothing: the page asked for the new worker (Reload) and reloads.
worker.addEventListener('activate', (event) => event.waitUntil(deleteOldCaches().then(() => worker.clients.claim())));

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== new URL(worker.location.href).origin) return;
  event.respondWith(cacheFirst(event));
});

// The page sends this when the user clicks Reload on the update notice (src/ui/web/useServiceWorker.ts).
worker.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'skip-waiting') void worker.skipWaiting();
});
