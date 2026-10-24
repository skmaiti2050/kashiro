// Task R1: the Kashiro icon. icon.ico holds a hand-tuned render for each Windows size.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ICO_VARIANTS, packIco } from '../../scripts/build-icons';

const ROOT = path.resolve(__dirname, '../..');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface IcoEntry {
  width: number;
  height: number;
  bitCount: number;
  image: Buffer;
}

/** The images of an .ico file, by its directory (ICONDIR, then one 16-byte ICONDIRENTRY per image). */
function readIco(bytes: Buffer): IcoEntry[] {
  expect(bytes.readUInt16LE(0)).toBe(0);
  expect(bytes.readUInt16LE(2)).toBe(1); // 1 = icon
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    return {
      width: bytes[at] || 256, // 0 means 256
      height: bytes[at + 1] || 256,
      bitCount: bytes.readUInt16LE(at + 6),
      image: bytes.subarray(offset, offset + size),
    };
  });
}

/** A PNG's width from its IHDR chunk. */
const pngWidth = (png: Buffer): number => png.readUInt32BE(16);

describe('packIco', () => {
  it('stores each PNG unchanged, with its size in the directory', () => {
    const fake = (size: number) => Buffer.concat([PNG_SIGNATURE, Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, size, 0, 0, 0, size])]);
    const images = [16, 256].map((size) => ({ size, png: fake(size) }));
    const entries = readIco(packIco(images));
    expect(entries.map((e) => [e.width, e.height, e.bitCount])).toEqual([[16, 16, 32], [256, 256, 32]]);
    expect(entries.map((e) => e.image)).toEqual(images.map((i) => i.png));
  });
});

describe('the committed icons', () => {
  it('icon.ico has the hand-tuned 16, 24, 32, 48 and 256 px images', () => {
    const entries = readIco(fs.readFileSync(path.join(ROOT, 'src-tauri/icons/icon.ico')));
    expect(ICO_VARIANTS.map((v) => v.size)).toEqual([16, 24, 32, 48, 256]);
    expect(entries.map((e) => e.width)).toEqual([16, 24, 32, 48, 256]);
    for (const entry of entries) {
      expect(entry.image.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect(pngWidth(entry.image)).toBe(entry.width);
    }
  });

  it('every icon tauri.conf.json bundles exists', () => {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')) as { bundle: { icon: string[] } };
    for (const icon of conf.bundle.icon) expect(fs.existsSync(path.join(ROOT, 'src-tauri', icon)), icon).toBe(true);
  });

  it('each variant SVG is the touchstone mark with its own stroke width', () => {
    const strokes = ICO_VARIANTS.map((v) => {
      const svg = fs.readFileSync(path.join(ROOT, 'src-tauri/icons/source', v.svg), 'utf8');
      expect(svg).toContain('<rect x="4" y="4" width="120" height="120" rx="28" fill="#1E2328"/>');
      expect(svg).toContain('d="M34 68 L54 88 L96 40"');
      return Number(svg.match(/stroke-width="(\d+)"/)![1]);
    });
    expect(strokes).toEqual([18, 16, 15, 14, 13]);
  });
});
