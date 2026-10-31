// @vitest-environment jsdom
// The web build swaps src/ui/platform/<x> for src/ui/platform-web/<x> (vite.config.ts): every desktop module needs
// a web twin with the same exports, and no file outside src/ui/platform may import Tauri.
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/path', () => ({ resolveResource: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn(),
  PhysicalPosition: class {},
  PhysicalSize: class {},
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));

const ROOT = resolve(__dirname, '../..');
const DESKTOP = join(ROOT, 'src', 'ui', 'platform');
const WEB = join(ROOT, 'src', 'ui', 'platform-web');

/** An import of a Tauri package ("@tauri-apps/api/window"). */
const TAURI_IMPORT = /@tauri-apps\//;

const platformFiles = readdirSync(DESKTOP).filter((name) => name.endsWith('.ts'));

/** Every .ts/.tsx file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the web platform mirrors the desktop one', () => {
  it('has platform files to compare', () => {
    expect(platformFiles).toContain('capabilities.ts');
    expect(platformFiles).toContain('window.ts');
  });

  it.each(platformFiles)('platform-web/%s exists with the same exports', async (name) => {
    expect(readdirSync(WEB)).toContain(name);
    const module = name.replace(/\.ts$/, '');
    const desktop = await import(`../../src/ui/platform/${module}.ts`);
    const web = await import(`../../src/ui/platform-web/${module}.ts`);
    expect(Object.keys(web).sort()).toEqual(Object.keys(desktop).sort());
  });

  it('no file outside src/ui/platform imports Tauri', () => {
    const importers = sourceFiles(join(ROOT, 'src'))
      .filter((path) => !path.startsWith(DESKTOP + sep))
      .filter((path) => TAURI_IMPORT.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(importers).toEqual([]);
  });
});
