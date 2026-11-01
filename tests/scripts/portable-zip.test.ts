// Task 14: the per-user NSIS installer's settings and the portable zips' contents.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTABLE_ZIPS, exeProblems, fileVersionOf, portableEntries, type TauriBundleConf } from '../../scripts/portable-zip';
import { readTauriConfigs } from '../../scripts/tauriConfigs';

const ROOT = path.resolve(__dirname, '../..');
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));

describe('the per-user installer (tauri.conf.json)', () => {
  it('builds only the NSIS installer, for the current user, with no WebView2 download', () => {
    expect(conf.bundle.targets).toEqual(['nsis']);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(conf.bundle.windows.webviewInstallMode).toEqual({ type: 'skip' });
  });

  it('checks the llama.cpp files before every release build', () => {
    expect(conf.build.beforeBuildCommand).toBe('npm run check:llama && npm run build');
  });

  it('keeps build output and the portable zips out of git', () => {
    const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored).toContain('dist-portable/');
  });

  it('makes one zip per release config: the full app, and the one without AI (tauri.noai.conf.json)', () => {
    const configs = readTauriConfigs(path.join(ROOT, 'src-tauri'));
    expect(PORTABLE_ZIPS.map((z) => z.file)).toEqual(['dist-portable/Kashiro-1.0.2-win-x64.zip', 'dist-portable/Kashiro-1.0.2-win-x64-noai.zip']);
    expect(PORTABLE_ZIPS.map((z) => z.conf)).toEqual([configs.full, configs.noai]);
  });
});

/** A UTF-16 version resource entry, as the Windows linker writes it: "FileVersion", padding, "1.0.0". */
const versionResource = (version: string) => Buffer.concat([Buffer.from('MZ junk'), Buffer.from('FileVersion\0', 'utf16le'), Buffer.alloc(2), Buffer.from(`${version}\0`, 'utf16le')]);

describe('portableEntries', () => {
  const makeProject = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-'));
    const srcTauri = path.join(root, 'src-tauri');
    fs.mkdirSync(path.join(srcTauri, 'binaries/llama'), { recursive: true });
    fs.mkdirSync(path.join(root, 'resources'));
    fs.writeFileSync(path.join(srcTauri, 'binaries/llama/llama-server.exe'), 'exe');
    fs.writeFileSync(path.join(srcTauri, 'binaries/llama/ggml.dll'), 'dll');
    fs.writeFileSync(path.join(root, 'resources/ATTRIBUTION.md'), 'notice');
    fs.writeFileSync(path.join(root, 'app.exe'), 'app');
    return { root, srcTauri };
  };
  const bundle: TauriBundleConf = {
    productName: 'Kashiro',
    mainBinaryName: 'Kashiro',
    version: '1.0.0',
    bundle: { resources: { 'binaries/llama/*': 'llama/', '../resources/ATTRIBUTION.md': 'notices/data.md' } },
  };

  it('lays out the exe and every resource as the installer does, under one folder', () => {
    const { root, srcTauri } = makeProject();
    const entries = portableEntries(bundle, srcTauri, path.join(root, 'app.exe'));
    expect(entries.map((e) => e.zipPath)).toEqual([
      'Kashiro/Kashiro.exe',
      'Kashiro/llama/ggml.dll',
      'Kashiro/llama/llama-server.exe',
      'Kashiro/notices/data.md',
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

  it('includes every resource the real config bundles: the server, its Vulkan backend and the notices', () => {
    const targets = Object.values(conf.bundle.resources as Record<string, string>);
    for (const expected of ['llama/', 'llama/vulkan/', 'notices/THIRD-PARTY-NOTICES.txt', 'LICENSE.txt', 'INSTALL.md']) {
      expect(targets).toContain(expected);
    }
  });
});

describe('a stale exe is refused (Minor 7)', () => {
  it('reads the FileVersion from the exe', () => {
    expect(fileVersionOf(versionResource('1.0.0'))).toBe('1.0.0');
    expect(fileVersionOf(Buffer.from('no resource'))).toBeNull();
  });

  it('refuses an exe of another version, or one older than tauri.conf.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-exe-'));
    const exe = path.join(dir, 'Kashiro.exe');
    const confFile = path.join(dir, 'tauri.conf.json');
    fs.writeFileSync(confFile, '{}');
    fs.writeFileSync(exe, versionResource('1.0.0'));
    fs.utimesSync(confFile, new Date(2026, 0, 1), new Date(2026, 0, 1));
    fs.utimesSync(exe, new Date(2026, 0, 2), new Date(2026, 0, 2));
    expect(exeProblems(exe, '1.0.0', confFile)).toEqual([]);
    expect(exeProblems(exe, '1.0.1', confFile)).toEqual([`${exe} is version 1.0.0, not 1.0.1: run npx tauri build`]);
    fs.utimesSync(exe, new Date(2025, 11, 31), new Date(2025, 11, 31));
    expect(exeProblems(exe, '1.0.0', confFile)).toEqual([`${exe} is older than ${confFile}: run npx tauri build`]);
    fs.rmSync(dir, { recursive: true });
  });
});
