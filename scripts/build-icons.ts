/**
 * `npm run build:icons` (Task R1): regenerates the app icons in src-tauri/icons from the Kashiro SVGs in
 * src-tauri/icons/source. Offline; it uses only `tauri icon` from the Tauri CLI.
 *   1. Renders kashiro.svg to a 1024 px PNG, and builds Tauri's icon set from that PNG.
 *   2. Renders each hand-tuned variant at its own size (the tick gets thicker as the icon gets smaller, so it stays
 *      readable) and packs them into icon.ico; the 32 px variant is also 32x32.png.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(ROOT, 'src-tauri/icons');
const SOURCE = path.join(ICONS, 'source');
const MASTER_SIZE = 1024;

/** The images of icon.ico, smallest first, each from the SVG drawn for that size. */
export const ICO_VARIANTS = [
  { size: 16, svg: 'kashiro-16.svg' },
  { size: 24, svg: 'kashiro-24.svg' },
  { size: 32, svg: 'kashiro-32.svg' },
  { size: 48, svg: 'kashiro-48.svg' },
  { size: 256, svg: 'kashiro.svg' },
];

/** The files of Tauri's icon set the app keeps (the Windows ones and the macOS .icns); not the Android and iOS folders. */
const KEPT_ICONS = [
  '128x128.png',
  '128x128@2x.png',
  'icon.icns',
  'icon.png',
  'Square107x107Logo.png',
  'Square142x142Logo.png',
  'Square150x150Logo.png',
  'Square284x284Logo.png',
  'Square30x30Logo.png',
  'Square310x310Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square89x89Logo.png',
  'StoreLogo.png',
];

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** An .ico file holding each PNG unchanged (Windows Vista and later read PNG images in an .ico). */
export function packIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(1, 2); // type 1: icon
  header.writeUInt16LE(images.length, 4);
  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    entry[0] = size === 256 ? 0 : size; // 0 means 256
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/** Renders `input` (an SVG or PNG) with `tauri icon`, into `output`; `size` renders one PNG instead of the full set. */
function tauriIcon(input: string, output: string, size?: number): void {
  const pngOption = size ? ` --png ${size}` : '';
  execSync(`npx tauri icon "${input}" -o "${output}"${pngOption}`, { cwd: ROOT, stdio: 'inherit' });
}

function main(): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kashiro-icons-'));
  try {
    tauriIcon(path.join(SOURCE, 'kashiro.svg'), path.join(work, 'master'), MASTER_SIZE);
    tauriIcon(path.join(work, 'master', `${MASTER_SIZE}x${MASTER_SIZE}.png`), path.join(work, 'set'));
    for (const name of KEPT_ICONS) fs.copyFileSync(path.join(work, 'set', name), path.join(ICONS, name));

    const images = ICO_VARIANTS.map(({ size, svg }) => {
      tauriIcon(path.join(SOURCE, svg), path.join(work, `variant-${size}`), size);
      return { size, png: fs.readFileSync(path.join(work, `variant-${size}`, `${size}x${size}.png`)) };
    });
    fs.writeFileSync(path.join(ICONS, 'icon.ico'), packIco(images));
    fs.writeFileSync(path.join(ICONS, '32x32.png'), images.find((i) => i.size === 32)!.png);
    console.log(`Wrote ${KEPT_ICONS.length + 2} icons to src-tauri/icons; icon.ico has ${images.map((i) => i.size).join(', ')} px.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); // only the temporary folder made above
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
