// Web Task 5: the web build lists every file it emitted in precache.json, and names the build by their content, so the
// service worker caches all of them and a new deploy (new content) installs a new cache.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { precacheFiles, writePrecache } from '../../scripts/webBuild';

let dir: string;

function put(path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kashiro-precache-'));
  put('index.html', '<html></html>');
  put('assets/index-abc.js', 'app');
  put('assets/harper_wasm_bg-def.wasm', 'wasm');
  put('dictionary/oewn.json.gz', 'words');
  put('icons/icon-512.png', 'png');
  put('manifest.webmanifest', '{}');
  // From an earlier build: never listed (the browser updates sw.js itself; precache.json is rewritten).
  put('sw.js', 'old worker');
  put('precache.json', '{}');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the precache list', () => {
  it('lists every emitted file, relative to the base, sorted, without sw.js and precache.json', async () => {
    expect(await precacheFiles(dir)).toEqual([
      'assets/harper_wasm_bg-def.wasm',
      'assets/index-abc.js',
      'dictionary/oewn.json.gz',
      'icons/icon-512.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('writes precache.json with the build id and the files', async () => {
    const build = await writePrecache(dir);
    const written = JSON.parse(readFileSync(join(dir, 'precache.json'), 'utf8'));
    expect(written.build).toBe(build);
    expect(written.files).toEqual(await precacheFiles(dir));
    expect(build).toMatch(/^[0-9a-f]{12}$/);
  });

  it('the same files give the same build id; a changed file gives a new one', async () => {
    const first = await writePrecache(dir);
    expect(await writePrecache(dir)).toBe(first);
    put('index.html', '<html>new</html>');
    expect(await writePrecache(dir)).not.toBe(first);
  });
});
