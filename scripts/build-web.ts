// npm run build:web: the web app into dist-web/ (vite.config.ts swaps in src/ui/platform-web). KASHIRO_WEB_BASE
// sets the base path (default /kashiro/, for GitHub Pages).
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { writePrecache } from './webBuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../dist-web', import.meta.url));

process.env.KASHIRO_TARGET = 'web';
// The day of the build, for About and the status bar (YYYY-MM-DD).
process.env.VITE_BUILD_DATE ??= new Date().toISOString().slice(0, 10);

await build({ root });

// The service worker comes last: it caches the build's files (precache.json), in a cache named by their hash.
// A classic script (IIFE), so every browser with service workers can run it.
process.env.VITE_KASHIRO_BUILD_ID = await writePrecache(outDir);
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    lib: { entry: 'src/web/serviceWorker.ts', formats: ['iife'], name: 'KashiroServiceWorker', fileName: () => 'sw.js' },
  },
});
