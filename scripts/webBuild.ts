// The web build's own files: the page head (CSP, manifest), the app icons, and precache.json for the service worker.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * GitHub Pages can't send headers, so the policy is a <meta http-equiv>. CodeMirror injects <style> elements, so
 * styles need 'unsafe-inline', as on the desktop (F17); Harper needs 'wasm-unsafe-eval'. Same origin only.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

/** The installed app's title bar colour (public-web/manifest.webmanifest has the same). */
const THEME_COLOUR = '#1E2328';

/** The opening <head> tag of index.html. */
const HEAD_TAG = /<head>/;

/**
 * The web page's head: the CSP first, before any style or script it governs, then the manifest link and theme colour.
 * `base` is the site's base path ("/kashiro/"); Vite has already rewritten the page's own URLs when this runs.
 */
export function webPageHead(base: string): Plugin {
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
    `<meta name="theme-color" content="${THEME_COLOUR}">`,
    `<link rel="manifest" href="${base}manifest.webmanifest">`,
  ].join('\n    ');
  return {
    name: 'kashiro-web-page-head',
    transformIndexHtml: (html) => html.replace(HEAD_TAG, `<head>\n    ${head}`),
  };
}

/** The app icons in src-tauri/icons, and their names in the web manifest's icons/ folder. */
const ICONS = [
  { source: '128x128@2x.png', name: 'icon-256.png' },
  { source: 'icon.png', name: 'icon-512.png' },
];

/** Copies the desktop app's icons into the web build, for the manifest (installing the app, its splash screen). */
export function webIcons(iconsDir: string): Plugin {
  return {
    name: 'kashiro-web-icons',
    apply: 'build',
    async generateBundle() {
      for (const icon of ICONS) {
        this.emitFile({ type: 'asset', fileName: `icons/${icon.name}`, source: await readFile(join(iconsDir, icon.source)) });
      }
    },
  };
}

/** Written next to the files they describe; the service worker never precaches itself or its list. */
const NOT_PRECACHED = new Set(['sw.js', 'precache.json']);

/** Every file in the built site, as paths relative to the base ("assets/index-abc.js"), sorted. */
export async function precacheFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((path) => !NOT_PRECACHED.has(path))
    .sort();
}

/**
 * Writes precache.json ({ build, files }) into the built site and returns the build id: a hash of every file's path and
 * content, so a deploy with any change gets a new cache, and rebuilding the same source does not.
 */
export async function writePrecache(dir: string): Promise<string> {
  const files = await precacheFiles(dir);
  const hash = createHash('sha256');
  for (const file of files) {
    // The NUL keeps "a" + "bc" apart from "ab" + "c".
    hash.update(`${file}\0`);
    hash.update(await readFile(join(dir, file)));
    hash.update('\0');
  }
  const build = hash.digest('hex').slice(0, 12);
  await writeFile(join(dir, 'precache.json'), JSON.stringify({ build, files }, null, 2) + '\n');
  return build;
}
