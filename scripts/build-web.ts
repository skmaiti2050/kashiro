// npm run build:web: the web app into dist-web/ (vite.config.ts swaps in src/ui/platform-web). KASHIRO_WEB_BASE
// sets the base path (default /kashiro/, for GitHub Pages).
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

process.env.KASHIRO_TARGET = 'web';
// The day of the build, for About (YYYY-MM-DD).
process.env.VITE_BUILD_DATE ??= new Date().toISOString().slice(0, 10);

await build({ root: fileURLToPath(new URL('..', import.meta.url)) });
