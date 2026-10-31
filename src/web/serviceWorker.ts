// The web app's service worker, built to sw.js by scripts/build-web.ts (spec: "Offline / PWA"). It precaches every
// file of the build and answers same-origin GETs from that cache, so after the first visit the app starts offline.
// A new deploy installs a new cache and waits: the page offers "Updated. Reload when you're ready", and this worker
// takes over only when the user clicks Reload (it never reloads a page mid-review).

/** The parts of the service worker scope used here (the DOM lib this project compiles with has no worker types). */
interface LifecycleEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  readonly location: { readonly href: string };
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

async function precache(): Promise<void> {
  // no-cache: revalidate with the server, so a list or page the HTTP cache still holds from the last deploy isn't used.
  const listed = await fetch(siteUrl('precache.json'), { cache: 'no-cache' });
  if (!listed.ok) throw new Error(`precache.json: ${listed.status}`);
  const { files } = (await listed.json()) as { files: string[] };
  const cache = await caches.open(CACHE);
  await cache.addAll(files.map((file) => new Request(siteUrl(file), { cache: 'no-cache' })));
}

/** Deletes earlier builds' caches; another app's caches on the same origin are left alone. */
async function deleteOldCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
}

/** Cache first; a page load (the base path, or any page URL) gets the cached index.html. */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = request.mode === 'navigate' ? await cache.match(siteUrl('index.html')) : await cache.match(request);
  return cached ?? fetch(request);
}

worker.addEventListener('install', (event) => event.waitUntil(precache()));
worker.addEventListener('activate', (event) => event.waitUntil(deleteOldCaches()));

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== new URL(worker.location.href).origin) return;
  event.respondWith(cacheFirst(request));
});

// The page sends this when the user clicks Reload on the update notice (src/ui/web/useServiceWorker.ts).
worker.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'skip-waiting') void worker.skipWaiting();
});
