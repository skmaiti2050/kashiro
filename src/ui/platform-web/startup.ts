import { createElement } from 'react';
import { harperWasmUrl } from '../web/harperWasm';
import { LoadingScreen } from '../web/LoadingScreen';
import { downloadWithProgress } from '../web/loadingProgress';
import type * as desktop from '../platform/startup';

/**
 * Harper's wasm (about 19 MB) downloads first, with its progress on the loading screen; then the app shows. Harper's
 * own fetch of the same URL is then served from the cache (the service worker's, or the browser's on a first visit).
 */
export const startApp: typeof desktop.startApp = (root, app) => {
  const show = (megabytes: number | null) => root.render(createElement(LoadingScreen, { megabytes }));
  const wasmUrl = harperWasmUrl();
  // A failed download still shows the app: Harper's own load then fails the same way, and the app says the
  // proofreader couldn't start (error.checkerStart), with what to do next.
  downloadWithProgress(wasmUrl, show).then(
    () => root.render(app),
    () => root.render(app),
  );
};
