import { useEffect, useRef, useState } from 'react';
import { harperWasmUrl } from './harperWasm';

/** The first visit's files the worker caches only when the page fetches them (src/web/serviceWorker.ts). */
interface FirstVisit {
  /** Their URLs: Harper's wasm, which the loading screen fetched before the worker was there. */
  firstUse: string[];
  /** Fetches `url` through the worker, which caches it (cacheFirst). */
  refetch(url: string): void;
}

/**
 * Registers the service worker (src/web/serviceWorker.ts, built to sw.js) and calls `onUpdateReady` when a new
 * version is installed and waiting while this page runs the old one. Its argument applies the update: the new worker
 * takes over, then `reload` runs. Nothing reloads otherwise, not even when another tab applied the update.
 * On a first visit, once the new worker controls the page, `firstVisit`'s files are fetched again so it caches them.
 */
export async function watchServiceWorker(
  container: ServiceWorkerContainer,
  scriptUrl: string,
  onUpdateReady: (apply: () => void) => void,
  reload: () => void,
  firstVisit: FirstVisit,
): Promise<void> {
  let applying = false;
  // No controller: the first visit, whose worker takes control when it activates (clients.claim).
  let uncontrolled = !container.controller;
  const offer = (waiting: ServiceWorker) => {
    // No controller: the first visit's install, which serves the next visit; there is nothing to update.
    if (!container.controller) return;
    onUpdateReady(() => {
      // Another tab applied it already (final review item 5): nothing waits to take over, so reload now.
      if (waiting.state !== 'installed') return reload();
      applying = true;
      waiting.postMessage({ type: 'skip-waiting' });
    });
  };
  container.addEventListener('controllerchange', () => {
    if (applying) return reload();
    if (!uncontrolled) return;
    uncontrolled = false;
    // Not at install: Safari refuses the worker's only-if-cached copy (final review item 6). From the HTTP cache
    // where the browser kept it, so no second download.
    firstVisit.firstUse.forEach((url) => firstVisit.refetch(url));
  });

  const registration = await container.register(scriptUrl);
  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') offer(installing);
    });
  });
}

/** Fetches `url` to the end through the worker (which caches it as the body arrives); a failure only costs offline use. */
function refetchForCache(url: string): void {
  fetch(url)
    .then((response) => response.arrayBuffer())
    .catch((e) => console.warn(`Kashiro may not work offline: ${url} was not cached.`, e));
}

/**
 * The web app's offline support. Returns the update's Reload action once a new version is waiting, else null.
 * Where the browser has no service workers (an insecure page, some private windows) the app still works online.
 */
export function useServiceWorker(): (() => void) | null {
  const [apply, setApply] = useState<(() => void) | null>(null);
  const started = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice in development; one registration is enough.
    if (started.current || !('serviceWorker' in navigator)) return;
    started.current = true;
    const scriptUrl = `${import.meta.env.BASE_URL}sw.js`;
    const firstVisit = { firstUse: [harperWasmUrl()], refetch: refetchForCache };
    watchServiceWorker(navigator.serviceWorker, scriptUrl, (update) => setApply(() => update), () => location.reload(), firstVisit).catch((e) =>
      console.warn('Kashiro will not work offline: its service worker did not register.', e),
    );
  }, []);
  return apply;
}
