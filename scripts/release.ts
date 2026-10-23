/**
 * `npm run release` (Task 14 fix round 2): builds the four release files.
 *   1. The installer without the AI helper (tauri.noai.conf.json), renamed to writing-check-noai_<version>_x64-setup.exe:
 *      both builds write the same file name, so it must move before the next build.
 *   2. The full installer, writing-check_<version>_x64-setup.exe.
 *   3. Both portable zips (npm run portable:zip, from the full build's exe).
 * Run `npm run fetch:llama` first; every Tauri build checks the llama.cpp files (check:llama). Offline.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTABLE_ZIPS } from './portable-zip';
import { NOAI_CONF, readTauriConfigs } from './tauriConfigs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { productName, version } = readTauriConfigs(path.join(ROOT, 'src-tauri')).full as { productName: string; version: string };
const NSIS = 'src-tauri/target/release/bundle/nsis';
const INSTALLER = `${NSIS}/${productName}_${version}_x64-setup.exe`;
const NOAI_INSTALLER = `${NSIS}/${productName}-noai_${version}_x64-setup.exe`;

export const RELEASE_FILES = [NOAI_INSTALLER, INSTALLER, ...PORTABLE_ZIPS.map((z) => z.file)];

const run = (command: string) => execSync(command, { cwd: ROOT, stdio: 'inherit' });

function main(): void {
  run(`npx tauri build --config src-tauri/${NOAI_CONF}`);
  fs.renameSync(path.join(ROOT, INSTALLER), path.join(ROOT, NOAI_INSTALLER));
  run('npx tauri build');
  run('npm run portable:zip');
  for (const file of RELEASE_FILES) console.log(`${file}: ${fs.statSync(path.join(ROOT, file)).size} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
