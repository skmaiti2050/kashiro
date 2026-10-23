/**
 * Puts the pinned llama.cpp `llama-server` files (Windows x64) in src-tauri/binaries/, which tauri.conf.json
 * bundles as resources: binaries/llama/ (the server and its libraries, from the CPU build) and binaries/vulkan/
 * (only ggml-vulkan.dll, from the Vulkan build; the rest of that zip equals the CPU build). The app loads the
 * Vulkan backend by path only for the GPU probe and the GPU launch (src-tauri/src/llm.rs), so the CPU launch
 * never loads it (a broken GPU driver could crash it).
 *
 * Source:  the official llama.cpp b11727 release zips (commit 8f97d82da), URL and zip sha256 in deps/assets.json
 * sha256:  the zip, then every file, pinned in deps/assets.json ("llama-server", "llama-server-vulkan" → files);
 *          checked before and after the copy. Only the pinned files are taken out of a zip, and files that are
 *          not pinned are removed from the target folder.
 * Licence: MIT (libomp.dll: Apache-2.0 WITH LLVM-exception); texts in resources/llama/ATTRIBUTION.md
 *
 * Usage:
 *   npm run fetch:llama                                   downloads both zips from the pinned URLs (developer
 *                                                         and CI step; the app itself never does this)
 *   npm run fetch:llama -- <CPU build> <Vulkan build>     the same from local copies: each a release zip or
 *                                                         an unzipped release folder
 *   npm run check:llama                                   checks that binaries/ holds exactly the pinned files
 *                                                         (run before packaging, and by upgrade:check)
 * src-tauri/binaries/ is gitignored: binaries are never committed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ASSETS } from './deps/assets';

/** Each part: its folder under src-tauri/binaries/ and its entry in deps/assets.json. */
export const BUILDS = [
  { folder: 'llama', assetId: 'llama-server' },
  { folder: 'vulkan', assetId: 'llama-server-vulkan' },
] as const;

export const BINARIES = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/binaries');

/** File name -> contents. */
type BuildFiles = Record<string, Buffer>;

const sha256Of = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** One line per pinned file that is missing or has another hash ("ggml.dll: missing"). */
export function hashMismatches(pinned: Record<string, string>, actual: Record<string, string>): string[] {
  return Object.entries(pinned).flatMap(([name, expected]) => {
    if (!(name in actual)) return [`${name}: missing`];
    return actual[name] === expected ? [] : [`${name}: sha256 is ${actual[name]}, expected ${expected}`];
  });
}

const hashesOf = (files: BuildFiles) => Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha256Of(data)]));

/** The pinned files found in an unzipped release folder. */
function filesInFolder(folder: string, pinned: Record<string, string>): BuildFiles {
  const files: BuildFiles = {};
  for (const name of Object.keys(pinned)) {
    const file = join(folder, name);
    if (existsSync(file)) files[name] = readFileSync(file);
  }
  return files;
}

/** The pinned files found in a release zip, after checking the zip's own sha256. */
export async function filesInZip(zip: Buffer, zipSha256: string, pinned: Record<string, string>): Promise<BuildFiles> {
  const actual = sha256Of(zip);
  if (actual !== zipSha256) throw new Error(`The zip's sha256 is ${actual}, expected ${zipSha256} (llama.cpp b11727).`);
  const archive = await JSZip.loadAsync(zip);
  const files: BuildFiles = {};
  for (const name of Object.keys(pinned)) {
    const entry = archive.file(name);
    if (entry) files[name] = await entry.async('nodebuffer');
  }
  return files;
}

/** The names in `folder` that are not pinned (a file left from an older layout or release). */
const unpinnedIn = (folder: string, pinned: Record<string, string>) => readdirSync(folder).filter((name) => !(name in pinned)).sort();

/**
 * Verifies every file, writes them all, removes anything else in `target` (only that gitignored folder), then
 * verifies the folder. Writes nothing when a file is wrong.
 */
export function installLlamaServer(files: BuildFiles, from: string, target: string, pinned: Record<string, string>): void {
  const wrong = hashMismatches(pinned, hashesOf(files));
  if (wrong.length > 0) throw new Error(`Wrong llama-server files in ${from} (expected llama.cpp b11727):\n${wrong.join('\n')}`);
  mkdirSync(target, { recursive: true });
  for (const name of Object.keys(pinned)) writeFileSync(join(target, name), files[name]);
  for (const name of unpinnedIn(target, pinned)) rmSync(join(target, name), { recursive: true });
  const problems = folderProblems(target, pinned);
  if (problems.length > 0) throw new Error(`The copies in ${target} do not match:\n${problems.join('\n')}`);
}

/** Wrong or missing pinned files, then files that are not pinned. */
function folderProblems(folder: string, pinned: Record<string, string>): string[] {
  const wrong = hashMismatches(pinned, hashesOf(filesInFolder(folder, pinned)));
  return [...wrong, ...unpinnedIn(folder, pinned).map((name) => `${name}: not pinned`)];
}

/**
 * Every way the folders under `binaries` differ from the pinned sets, one line each ("vulkan: missing"); empty when
 * they hold exactly the pinned files. A build must never bundle a file nobody pinned.
 */
export function installedBuildProblems(binaries: string, builds: { folder: string; pinned: Record<string, string> }[]): string[] {
  return builds.flatMap(({ folder, pinned }) => {
    const dir = join(binaries, folder);
    if (!existsSync(dir)) return [`${folder}: missing (${dir}): run npm run fetch:llama`];
    return folderProblems(dir, pinned).map((problem) => `${folder}: ${problem}`);
  });
}

/** installedBuildProblems for the real binaries folder and deps/assets.json. */
export const pinnedBuildProblems = (): string[] =>
  installedBuildProblems(BINARIES, BUILDS.map((b) => ({ folder: b.folder, pinned: pinnedFiles(b.assetId) })));

/** installLlamaServer from an unzipped release folder. */
export function copyLlamaServer(source: string, target: string, pinned: Record<string, string>): void {
  installLlamaServer(filesInFolder(source, pinned), source, target, pinned);
}

/** The pinned files of a build, from deps/assets.json. */
export function pinnedFiles(assetId: string): Record<string, string> {
  const files = ASSETS.find((a) => a.id === assetId)?.files;
  if (!files) throw new Error(`deps/assets.json has no pinned files for "${assetId}".`);
  return files;
}

/** The official release zip of a build: its URL and sha256, from deps/assets.json. */
export function releaseZip(assetId: string): { url: string; sha256: string } {
  const asset = ASSETS.find((a) => a.id === assetId);
  if (!asset?.sourceUrl || !asset.archiveSha256) throw new Error(`deps/assets.json has no release zip for "${assetId}".`);
  return { url: asset.sourceUrl, sha256: asset.archiveSha256 };
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** The pinned files of one build, from a local folder or zip, or else downloaded from the pinned URL. */
async function buildFiles(assetId: string, source: string | undefined): Promise<BuildFiles> {
  const pinned = pinnedFiles(assetId);
  const zip = releaseZip(assetId);
  if (source && statSync(source).isDirectory()) return filesInFolder(source, pinned);
  return filesInZip(source ? readFileSync(source) : await download(zip.url), zip.sha256, pinned);
}

async function main(): Promise<void> {
  const sources = process.argv.slice(2);
  if (sources[0] === '--check') {
    const problems = pinnedBuildProblems();
    if (problems.length > 0) throw new Error(`src-tauri/binaries does not hold exactly the pinned llama.cpp files:\n${problems.join('\n')}`);
    console.log('src-tauri/binaries holds exactly the pinned llama.cpp files.');
    return;
  }
  if (sources.length !== 0 && sources.length !== BUILDS.length) {
    throw new Error('Usage: npm run fetch:llama [-- <CPU build zip or folder> <Vulkan build zip or folder>]');
  }
  for (const [i, build] of BUILDS.entries()) {
    const from = sources[i] ?? releaseZip(build.assetId).url;
    const pinned = pinnedFiles(build.assetId);
    installLlamaServer(await buildFiles(build.assetId, sources[i]), from, join(BINARIES, build.folder), pinned);
    console.log(`${build.folder}: ${Object.keys(pinned).length} files verified and copied to ${join(BINARIES, build.folder)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
