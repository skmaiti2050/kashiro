// Task 14: the per-user NSIS installer's settings and the portable zip's contents.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTABLE_ZIP, portableEntries, type TauriBundleConf } from '../../scripts/portable-zip';

const ROOT = path.resolve(__dirname, '../..');
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));

describe('the per-user installer (tauri.conf.json)', () => {
  it('builds only the NSIS installer, for the current user, with no WebView2 download', () => {
    expect(conf.bundle.targets).toEqual(['nsis']);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(conf.bundle.windows.webviewInstallMode).toEqual({ type: 'skip' });
  });

  it('keeps build output and the portable zip out of git', () => {
    const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored).toContain('dist-portable/');
    expect(PORTABLE_ZIP).toBe('dist-portable/writing-check-1.0.0-win-x64.zip');
  });
});

describe('portableEntries', () => {
  const makeProject = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-'));
    const srcTauri = path.join(root, 'src-tauri');
    fs.mkdirSync(path.join(srcTauri, 'binaries/cpu'), { recursive: true });
    fs.mkdirSync(path.join(root, 'resources'));
    fs.writeFileSync(path.join(srcTauri, 'binaries/cpu/llama-server.exe'), 'exe');
    fs.writeFileSync(path.join(srcTauri, 'binaries/cpu/ggml.dll'), 'dll');
    fs.writeFileSync(path.join(root, 'resources/ATTRIBUTION.md'), 'notice');
    fs.writeFileSync(path.join(root, 'app.exe'), 'app');
    return { root, srcTauri };
  };
  const bundle: TauriBundleConf = {
    productName: 'writing-check',
    version: '1.0.0',
    bundle: { resources: { 'binaries/cpu/*': 'llama/cpu/', '../resources/ATTRIBUTION.md': 'notices/data.md' } },
  };

  it('lays out the exe and every resource as the installer does, under one folder', () => {
    const { root, srcTauri } = makeProject();
    const entries = portableEntries(bundle, srcTauri, path.join(root, 'app.exe'));
    expect(entries.map((e) => e.zipPath)).toEqual([
      'writing-check/writing-check.exe',
      'writing-check/llama/cpu/ggml.dll',
      'writing-check/llama/cpu/llama-server.exe',
      'writing-check/notices/data.md',
    ]);
    expect(entries[3].sourcePath).toBe(path.join(root, 'resources/ATTRIBUTION.md'));
    fs.rmSync(root, { recursive: true });
  });

  it('refuses to build a zip with something missing (run the release build and fetch:llama first)', () => {
    const { root, srcTauri } = makeProject();
    expect(() => portableEntries(bundle, srcTauri, path.join(root, 'missing.exe'))).toThrow(/missing\.exe is missing: run npx tauri build first/);
    const noBuild = { ...bundle, bundle: { resources: { 'binaries/vulkan/*': 'llama/vulkan/' } } };
    expect(() => portableEntries(noBuild, srcTauri, path.join(root, 'app.exe'))).toThrow(/binaries[\\/]vulkan is missing: run npm run fetch:llama first/);
    fs.rmSync(root, { recursive: true });
  });

  it('includes every resource the real config bundles, with both llama builds and the notices', () => {
    const targets = Object.values(conf.bundle.resources as Record<string, string>);
    for (const expected of ['llama/cpu/', 'llama/vulkan/', 'notices/THIRD-PARTY-NOTICES.txt', 'LICENSE.txt', 'INSTALL.md']) {
      expect(targets).toContain(expected);
    }
  });
});
