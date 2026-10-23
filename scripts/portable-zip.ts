/**
 * `npm run portable:zip` (Task 14): writes dist-portable/writing-check-<version>-win-x64.zip, the portable
 * build: writing-check.exe from the release build with every bundle resource of tauri.conf.json beside it, in
 * the same layout the installer uses (Tauri looks for resources next to the exe). Unzipped into any user folder,
 * it runs without installing; settings and saved reviews still go to the app's data folder (docs/INSTALL.md).
 *
 * Run `npm run fetch:llama` and `npx tauri build` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TAURI = path.join(ROOT, 'src-tauri');
/** The folder the zip unpacks to. */
const FOLDER = 'writing-check';
/** A resource source that stands for every file in a folder: "binaries/cpu/*". */
const FOLDER_GLOB = /\/\*$/;

export interface TauriBundleConf {
  productName: string;
  version: string;
  bundle: { resources?: Record<string, string> };
}

const conf = JSON.parse(fs.readFileSync(path.join(SRC_TAURI, 'tauri.conf.json'), 'utf8')) as TauriBundleConf;
export const PORTABLE_ZIP = `dist-portable/${conf.productName}-${conf.version}-win-x64.zip`;

export interface ZipEntry {
  zipPath: string;
  sourcePath: string;
}

/**
 * The files of the portable zip: the exe, then each resource at the path the installer gives it. A resource
 * source is relative to src-tauri, as in tauri.conf.json; "folder/*" means the files directly in that folder.
 */
export function portableEntries(tauriConf: TauriBundleConf, srcTauri: string, exe: string): ZipEntry[] {
  if (!fs.existsSync(exe)) throw new Error(`${exe} is missing: run npx tauri build first.`);
  const entries: ZipEntry[] = [{ zipPath: `${FOLDER}/${tauriConf.productName}.exe`, sourcePath: exe }];
  for (const [source, target] of Object.entries(tauriConf.bundle.resources ?? {})) {
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

async function main(): Promise<void> {
  const exe = path.join(SRC_TAURI, 'target/release', `${conf.productName}.exe`);
  const zip = new JSZip();
  const entries = portableEntries(conf, SRC_TAURI, exe);
  for (const entry of entries) zip.file(entry.zipPath, fs.readFileSync(entry.sourcePath));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
  const output = path.join(ROOT, PORTABLE_ZIP);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  console.log(`Wrote ${PORTABLE_ZIP}: ${entries.length} files, ${(bytes.length / 1024 / 1024).toFixed(1)} MB.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
