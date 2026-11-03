// v1.3.0: Harper runs in a Worker. The built site must still hold ONE copy of Harper's wasm (the loading screen
// pre-downloads it, the Worker fetches the same URL), and the Worker's script must be cached by the service worker.
// Reads dist-web/, the output of `npm run build:web`; skipped when that has not been run.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'dist-web');
const built = existsSync(join(SITE, 'precache.json'));

const assets = built ? readdirSync(join(SITE, 'assets')) : [];
const wasmFiles = assets.filter((name) => /^harper_wasm_bg-.*\.wasm$/.test(name));
const workerChunks = assets.filter((name) => /^harperWorker-.*\.js$/.test(name));
const read = (name: string) => readFileSync(join(SITE, 'assets', name), 'utf8');

describe.skipIf(!built)('the web build with the Harper Worker', () => {
  it('holds exactly one harper wasm file', () => {
    expect(wasmFiles).toHaveLength(1);
  });

  it('has a Worker chunk, and the service worker caches it at install', () => {
    expect(workerChunks).toHaveLength(1);
    const precache = JSON.parse(readFileSync(join(SITE, 'precache.json'), 'utf8'));
    expect(precache.files).toContain(`assets/${workerChunks[0]}`);
    expect(precache.onFirstUse).toContain(`assets/${wasmFiles[0]}`);
  });

  // The engine's fallback import of harper.js/binaryInlined (25 MB of base64 wasm) must stay out of the Worker bundle too.
  it('keeps the inlined wasm out of the Worker chunk', () => {
    expect(statSync(join(SITE, 'assets', workerChunks[0])).size).toBeLessThan(1_000_000);
  });

  it('the Worker fetches the same wasm file the loading screen pre-downloads', () => {
    const entry = assets.filter((name) => /^index-.*\.js$/.test(name)).map(read).join('\n');
    expect(entry).toContain(wasmFiles[0]);
    expect(read(workerChunks[0])).toContain(wasmFiles[0]);
  });
});
