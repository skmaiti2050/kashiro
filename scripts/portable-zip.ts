/**
 * `npm run portable:zip` (Task 14): writes the two portable zips in dist-portable/:
 *   - Kashiro-<version>-win-x64.zip: Kashiro.exe from the release build with every bundle resource of
 *     tauri.conf.json beside it, in the layout the installer uses (Tauri looks for resources next to the exe);
 *   - Kashiro-<version>-win-x64-noai.zip: the same for tauri.noai.conf.json, the version without the AI
 *     helper (no llama/ folder); the app then says "AI helper not installed" in Settings.
 * Unzipped into any user folder, it runs without installing; settings and saved reviews still go to the app's
 * data folder (docs/INSTALL.md).
 *
 * Run `npm run fetch:llama` and `npx tauri build` first: it refuses llama.cpp files that differ from the pinned
 * ones, and an exe older than tauri.conf.json or of another version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { pinnedBuildProblems } from './fetch-llama';
import { readTauriConfigs } from './tauriConfigs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TAURI = path.join(ROOT, 'src-tauri');
const CONF_FILE = path.join(SRC_TAURI, 'tauri.conf.json');
/** A resource source that stands for every file in a folder: "binaries/llama/*". */
const FOLDER_GLOB = /\/\*$/;

export interface TauriBundleConf {
  /** Also the folder the zip unpacks to. */
  productName: string;
  /** The exe's name without ".exe" (Tauri renames the cargo binary to it). */
  mainBinaryName: string;
  version: string;
  bundle: { resources?: Record<string, string> };
}

const configs = readTauriConfigs(SRC_TAURI);
const conf = configs.full as unknown as TauriBundleConf;
const zipBase = `dist-portable/${conf.productName}-${conf.version}-win-x64`;
/** One zip per release config; the exe is the same (it looks for the helper's files at run time). */
export const PORTABLE_ZIPS = [
  { file: `${zipBase}.zip`, conf: configs.full as unknown as TauriBundleConf },
  { file: `${zipBase}-noai.zip`, conf: configs.noai as unknown as TauriBundleConf },
];

export interface ZipEntry {
  zipPath: string;
  sourcePath: string;
}

/**
 * The files of a portable zip: the exe, then each resource of `tauriConf` at the path the installer gives it. A
 * resource source is relative to src-tauri, as in tauri.conf.json; "folder/*" means the files directly in that
 * folder.
 */
export function portableEntries(tauriConf: TauriBundleConf, srcTauri: string, exe: string): ZipEntry[] {
  if (!fs.existsSync(exe)) throw new Error(`${exe} is missing: run npx tauri build first.`);
  const folder = tauriConf.productName;
  const entries: ZipEntry[] = [{ zipPath: `${folder}/${tauriConf.mainBinaryName}.exe`, sourcePath: exe }];
  for (const [source, target] of Object.entries(tauriConf.bundle.resources ?? {})) {
    const sourcePath = path.join(srcTauri, source.replace(FOLDER_GLOB, ''));
    if (!fs.existsSync(sourcePath)) {
      const hint = source.startsWith('binaries/') ? 'run npm run fetch:llama first' : 'check tauri.conf.json';
      throw new Error(`${sourcePath} is missing: ${hint}.`);
    }
    if (!FOLDER_GLOB.test(source)) {
      entries.push({ zipPath: `${folder}/${target}`, sourcePath });
      continue;
    }
    const names = fs.readdirSync(sourcePath, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const name of names) entries.push({ zipPath: `${folder}/${target}${name}`, sourcePath: path.join(sourcePath, name) });
  }
  return entries;
}

/** The "FileVersion" string of an exe's version resource ("1.0.0"), or null when it has none. */
export function fileVersionOf(exe: Buffer): string | null {
  const key = Buffer.from('FileVersion\0', 'utf16le');
  let at = exe.indexOf(key);
  if (at < 0) return null;
  at += key.length;
  while (at + 1 < exe.length && exe.readUInt16LE(at) === 0) at += 2; // padding to the value
  let version = '';
  for (; at + 1 < exe.length && exe.readUInt16LE(at) !== 0; at += 2) version += String.fromCharCode(exe.readUInt16LE(at));
  return version;
}

/** Why the exe can't go in a zip: built for another version, or before the last change to tauri.conf.json. */
export function exeProblems(exe: string, version: string, confFile: string): string[] {
  const built = fileVersionOf(fs.readFileSync(exe));
  if (built !== version) return [`${exe} is version ${built}, not ${version}: run npx tauri build`];
  if (fs.statSync(exe).mtimeMs < fs.statSync(confFile).mtimeMs) return [`${exe} is older than ${confFile}: run npx tauri build`];
  return [];
}

async function main(): Promise<void> {
  const exe = path.join(SRC_TAURI, 'target/release', `${conf.mainBinaryName}.exe`);
  const problems = [...pinnedBuildProblems(), ...(fs.existsSync(exe) ? exeProblems(exe, conf.version, CONF_FILE) : [])];
  if (problems.length > 0) throw new Error(`Not packaging:\n${problems.join('\n')}`);
  for (const { file, conf: zipConf } of PORTABLE_ZIPS) {
    const zip = new JSZip();
    const entries = portableEntries(zipConf, SRC_TAURI, exe);
    for (const entry of entries) zip.file(entry.zipPath, fs.readFileSync(entry.sourcePath));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
    const output = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
    console.log(`Wrote ${file}: ${entries.length} files, ${bytes.length} bytes (${(bytes.length / 1024 / 1024).toFixed(1)} MiB).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
