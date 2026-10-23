/**
 * Puts the pinned llama.cpp `llama-server` builds (Windows x64) in src-tauri/binaries/<build>/, which
 * tauri.conf.json bundles as resources: the CPU build, and the Vulkan build the app tries first on a machine
 * with a usable GPU (src-tauri/src/llm.rs). They are separate folders so the CPU fallback never loads the
 * Vulkan backend (a broken GPU driver could crash it).
 *
 * Source:  the official llama.cpp b11727 release zips (commit 8f97d82da), URL and zip sha256 in deps/assets.json
 * sha256:  the zip, then every file, pinned in deps/assets.json ("llama-server", "llama-server-vulkan" → files);
 *          checked before and after the copy. Only the pinned files are taken out of a zip.
 * Licence: MIT (libomp.dll: Apache-2.0 WITH LLVM-exception); texts in resources/llama/ATTRIBUTION.md
 *
 * Usage:
 *   npm run fetch:llama                                   downloads both zips from the pinned URLs (developer
 *                                                         and CI step; the app itself never does this)
 *   npm run fetch:llama -- <CPU build> <Vulkan build>     the same from local copies: each a release zip or
 *                                                         an unzipped release folder
 * src-tauri/binaries/ is gitignored: binaries are never committed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ASSETS } from './deps/assets';

/** Each build: its folder under src-tauri/binaries/ and its entry in deps/assets.json. */
export const BUILDS = [
  { folder: 'cpu', assetId: 'llama-server' },
  { folder: 'vulkan', assetId: 'llama-server-vulkan' },
] as const;

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

/** Verifies every file, writes them all, then verifies the written copies. Writes nothing when a file is wrong. */
export function installLlamaServer(files: BuildFiles, from: string, target: string, pinned: Record<string, string>): void {
  const wrong = hashMismatches(pinned, hashesOf(files));
  if (wrong.length > 0) throw new Error(`Wrong llama-server files in ${from} (expected llama.cpp b11727):\n${wrong.join('\n')}`);
  mkdirSync(target, { recursive: true });
  for (const name of Object.keys(pinned)) writeFileSync(join(target, name), files[name]);
  const written = hashMismatches(pinned, hashesOf(filesInFolder(target, pinned)));
  if (written.length > 0) throw new Error(`The copies in ${target} do not match:\n${written.join('\n')}`);
}

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
  if (sources.length !== 0 && sources.length !== BUILDS.length) {
    throw new Error('Usage: npm run fetch:llama [-- <CPU build zip or folder> <Vulkan build zip or folder>]');
  }
  const binaries = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/binaries');
  for (const [i, build] of BUILDS.entries()) {
    const from = sources[i] ?? releaseZip(build.assetId).url;
    const pinned = pinnedFiles(build.assetId);
    installLlamaServer(await buildFiles(build.assetId, sources[i]), from, join(binaries, build.folder), pinned);
    console.log(`${build.folder}: ${Object.keys(pinned).length} files verified and copied to ${join(binaries, build.folder)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
