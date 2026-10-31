import { useEffect, useRef, useState } from 'react';

/**
 * Registers the service worker (src/web/serviceWorker.ts, built to sw.js) and calls `onUpdateReady` when a new
 * version is installed and waiting while this page runs the old one. Its argument applies the update: the new worker
 * takes over, then `reload` runs. Nothing reloads otherwise, not even when another tab applied the update.
 */
export async function watchServiceWorker(
  container: ServiceWorkerContainer,
  scriptUrl: string,
  onUpdateReady: (apply: () => void) => void,
  reload: () => void,
): Promise<void> {
  let applying = false;
  const offer = (waiting: ServiceWorker) => {
    // No controller: the first visit's install, which serves the next visit; there is nothing to update.
    if (!container.controller) return;
    onUpdateReady(() => {
      applying = true;
      waiting.postMessage({ type: 'skip-waiting' });
    });
  };
  container.addEventListener('controllerchange', () => {
    if (applying) reload();
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
    watchServiceWorker(navigator.serviceWorker, scriptUrl, (update) => setApply(() => update), () => location.reload()).catch((e) =>
      console.warn('Kashiro will not work offline: its service worker did not register.', e),
    );
  }, []);
  return apply;
}
