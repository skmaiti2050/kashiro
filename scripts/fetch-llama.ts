/**
 * Copies the pinned llama.cpp `llama-server` builds (Windows x64) into src-tauri/binaries/<build>/, which
 * tauri.conf.json bundles as resources: the CPU build, and the Vulkan build the app tries first on a machine
 * with a usable GPU (src-tauri/src/llm.rs). They are separate folders so the CPU fallback never loads the
 * Vulkan backend (a broken GPU driver could crash it).
 *
 * Source:  llama.cpp b11727, commit 8f97d82da (llama-b11727-bin-win-cpu-x64.zip and -vulkan-x64.zip)
 * sha256:  every file, pinned in deps/assets.json ("llama-server", "llama-server-vulkan" → files); checked
 *          before and after the copy
 * Licence: MIT (libomp.dll: Apache-2.0 WITH LLVM-exception, LICENSE-LLVM-OpenMP)
 *
 * Usage: npm run fetch:llama -- <CPU build folder> <Vulkan build folder>
 * src-tauri/binaries/ is gitignored: binaries are never committed.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './deps/assets';

/** Each build: its folder under src-tauri/binaries/ and its entry in deps/assets.json. */
export const BUILDS = [
  { folder: 'cpu', assetId: 'llama-server' },
  { folder: 'vulkan', assetId: 'llama-server-vulkan' },
] as const;

const sha256Of = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** One line per pinned file that is missing or has another hash ("ggml.dll: missing"). */
export function hashMismatches(pinned: Record<string, string>, actual: Record<string, string>): string[] {
  return Object.entries(pinned).flatMap(([name, expected]) => {
    if (!(name in actual)) return [`${name}: missing`];
    return actual[name] === expected ? [] : [`${name}: sha256 is ${actual[name]}, expected ${expected}`];
  });
}

/** The sha256 of each pinned file found in `folder`. */
function hashesIn(folder: string, pinned: Record<string, string>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of Object.keys(pinned)) {
    const file = join(folder, name);
    if (existsSync(file)) hashes[name] = sha256Of(file);
  }
  return hashes;
}

/** Verifies every source file, copies them all, then verifies the copies. Copies nothing when a source is wrong. */
export function copyLlamaServer(source: string, target: string, pinned: Record<string, string>): void {
  const wrong = hashMismatches(pinned, hashesIn(source, pinned));
  if (wrong.length > 0) throw new Error(`Wrong llama-server files in ${source} (expected llama.cpp b11727):\n${wrong.join('\n')}`);
  mkdirSync(target, { recursive: true });
  for (const name of Object.keys(pinned)) copyFileSync(join(source, name), join(target, name));
  const copied = hashMismatches(pinned, hashesIn(target, pinned));
  if (copied.length > 0) throw new Error(`The copies in ${target} do not match:\n${copied.join('\n')}`);
}

/** The pinned files of a build, from deps/assets.json. */
export function pinnedFiles(assetId: string): Record<string, string> {
  const files = ASSETS.find((a) => a.id === assetId)?.files;
  if (!files) throw new Error(`deps/assets.json has no pinned files for "${assetId}".`);
  return files;
}

function main(): void {
  const sources = process.argv.slice(2);
  if (sources.length !== BUILDS.length) throw new Error('Usage: npm run fetch:llama -- <CPU build folder> <Vulkan build folder>');
  const binaries = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/binaries');
  BUILDS.forEach((build, i) => {
    const pinned = pinnedFiles(build.assetId);
    copyLlamaServer(sources[i], join(binaries, build.folder), pinned);
    console.log(`${build.folder}: ${Object.keys(pinned).length} files verified and copied to ${join(binaries, build.folder)}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
