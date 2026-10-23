/**
 * `npm run portable:zip` (Task 14): writes the two portable zips in dist-portable/:
 *   - writing-check-<version>-win-x64.zip: writing-check.exe from the release build with every bundle resource
 *     of tauri.conf.json beside it, in the layout the installer uses (Tauri looks for resources next to the exe);
 *   - writing-check-<version>-win-x64-noai.zip: the same without the AI helper (everything under llama/); the app
 *     then says "AI helper not installed" in Settings.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TAURI = path.join(ROOT, 'src-tauri');
const CONF_FILE = path.join(SRC_TAURI, 'tauri.conf.json');
/** The folder the zip unpacks to. */
const FOLDER = 'writing-check';
/** A resource source that stands for every file in a folder: "binaries/llama/*". */
const FOLDER_GLOB = /\/\*$/;
/** Where the AI helper's resources go; the version without AI leaves them all out. */
const AI_TARGET = 'llama/';

export interface TauriBundleConf {
  productName: string;
  version: string;
  bundle: { resources?: Record<string, string> };
}

const conf = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')) as TauriBundleConf;
const zipBase = `dist-portable/${conf.productName}-${conf.version}-win-x64`;
export const PORTABLE_ZIPS = [
  { file: `${zipBase}.zip`, withAi: true },
  { file: `${zipBase}-noai.zip`, withAi: false },
];

export interface ZipEntry {
  zipPath: string;
  sourcePath: string;
}

/**
 * The files of a portable zip: the exe, then each resource at the path the installer gives it, without the AI
 * helper's unless `withAi`. A resource source is relative to src-tauri, as in tauri.conf.json; "folder/*" means
 * the files directly in that folder.
 */
export function portableEntries(tauriConf: TauriBundleConf, srcTauri: string, exe: string, withAi: boolean): ZipEntry[] {
  if (!fs.existsSync(exe)) throw new Error(`${exe} is missing: run npx tauri build first.`);
  const entries: ZipEntry[] = [{ zipPath: `${FOLDER}/${tauriConf.productName}.exe`, sourcePath: exe }];
  for (const [source, target] of Object.entries(tauriConf.bundle.resources ?? {})) {
    if (!withAi && target.startsWith(AI_TARGET)) continue;
    const sourcePath = path.join(srcTauri, source.replace(FOLDER_GLOB, ''));
    if (!fs.existsSync(sourcePath)) {
      const hint = source.startsWith('binaries/') ? 'run npm run fetch:llama first' : 'check tauri.conf.json';
      throw new Error(`${sourcePath} is missing: ${hint}.`);
    }
    if (!FOLDER_GLOB.test(source)) {
      entries.push({ zipPath: `${FOLDER}/${target}`, sourcePath });
      continue;
    }
    const names = fs.readdirSync(sourcePath, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const name of names) entries.push({ zipPath: `${FOLDER}/${target}${name}`, sourcePath: path.join(sourcePath, name) });
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
  const exe = path.join(SRC_TAURI, 'target/release', `${conf.productName}.exe`);
  const problems = [...pinnedBuildProblems(), ...(fs.existsSync(exe) ? exeProblems(exe, conf.version, CONF_FILE) : [])];
  if (problems.length > 0) throw new Error(`Not packaging:\n${problems.join('\n')}`);
  for (const { file, withAi } of PORTABLE_ZIPS) {
    const zip = new JSZip();
    const entries = portableEntries(conf, SRC_TAURI, exe, withAi);
    for (const entry of entries) zip.file(entry.zipPath, fs.readFileSync(entry.sourcePath));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
    const output = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
    console.log(`Wrote ${file}: ${entries.length} files, ${bytes.length} bytes (${(bytes.length / 1024 / 1024).toFixed(1)} MiB).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
