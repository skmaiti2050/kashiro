// Bundled fonts (Task L1): Noto Sans Devanagari and Bengali plus the readable fonts, woff2 only, local, each
// limited to its script by unicode-range, and the Indic families in every font stack.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const FONTS_CSS = 'src/ui/fonts.css';
const fontsCss = read(FONTS_CSS);
const appCss = read('src/ui/app.css') + read('src/ui/a11y.css');

/** Every value given to --ui-font or --reading-font ("--ui-font: 'Segoe UI', …;"). */
const FONT_STACK = /--(?:ui|reading)-font:\s*([^;]+);/g;
/** One @font-face rule's body. */
const FONT_FACE = /@font-face\s*\{([^}]*)\}/g;

interface Face {
  family: string;
  weight: string;
  src: string;
  range: string | null;
}

const faces: Face[] = [...fontsCss.matchAll(FONT_FACE)].map(([, body]) => ({
  family: /font-family:\s*'([^']+)'/.exec(body)![1],
  weight: /font-weight:\s*(\d+)/.exec(body)![1],
  src: /src:\s*([^;]+);/.exec(body)![1],
  range: /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? null,
}));

const facesOf = (family: string) => faces.filter((f) => f.family === family);

describe('bundled fonts', () => {
  it('fonts.ts loads our own font rules, not the @fontsource CSS (which adds unused .woff files)', () => {
    const fonts = read('src/ui/fonts.ts');
    expect(fonts).toContain("import './fonts.css';");
    expect(fonts).not.toContain('@fontsource/');
  });

  it('each family has regular and bold', () => {
    for (const family of ['Noto Sans Devanagari', 'Noto Sans Bengali', 'Atkinson Hyperlegible', 'OpenDyslexic']) {
      expect([...new Set(facesOf(family).map((f) => f.weight))].sort(), family).toEqual(['400', '700']);
    }
  });

  it('every face is one woff2 file from the installed @fontsource package, by a relative URL (no network)', () => {
    for (const face of faces) {
      const url = /^url\('([^']+)'\) format\('woff2'\)$/.exec(face.src);
      expect(url, face.src).not.toBeNull();
      expect(url![1]).toMatch(/^\.\.\/\.\.\/node_modules\/@fontsource\/[\w-]+\/files\/[\w-]+\.woff2$/);
      expect(existsSync(resolve(dirname(FONTS_CSS), url![1])), url![1]).toBe(true);
    }
  });

  it('the Indic faces cover only their script, so Latin text keeps the fonts before them', () => {
    for (const face of facesOf('Noto Sans Devanagari')) expect(face.range).toMatch(/^U\+0900-097F,/);
    for (const face of facesOf('Noto Sans Bengali')) expect(face.range).toContain('U+0980-09FE');
    for (const face of [...facesOf('Noto Sans Devanagari'), ...facesOf('Noto Sans Bengali')]) expect(face.range).not.toContain('U+0000-00FF');
  });

  it('every UI and document font stack falls back to both Noto families before the system font', () => {
    const stacks = [...appCss.matchAll(FONT_STACK)].map((m) => m[1]);
    expect(stacks.length).toBeGreaterThanOrEqual(6);
    for (const stack of stacks) expect(stack, stack).toContain('var(--indic-fonts)');
    expect(appCss).toMatch(/--indic-fonts:\s*'Noto Sans Devanagari',\s*'Noto Sans Bengali';/);
  });

  it('ATTRIBUTION lists both Indic fonts with their copyright and the OFL text', () => {
    const attribution = read('resources/fonts/ATTRIBUTION.md');
    expect(attribution).toContain('`@fontsource/noto-sans-devanagari` | 5.3.0');
    expect(attribution).toContain('`@fontsource/noto-sans-bengali` | 5.3.0');
    expect(attribution).toContain('Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari)');
    expect(attribution).toContain('Copyright 2025 The Noto Project Authors (https://github.com/notofonts/bengali)');
    expect(attribution).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    expect(attribution).not.toContain('`.woff`');
  });
});
