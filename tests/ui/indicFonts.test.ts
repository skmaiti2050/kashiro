// Indic fonts (Task L1): Noto Sans Devanagari and Bengali are bundled, local, and in every font stack.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const css = read('src/ui/app.css') + read('src/ui/a11y.css');

/** Every value given to --ui-font or --reading-font ("--ui-font: 'Segoe UI', …;"). */
const FONT_STACK = /--(?:ui|reading)-font:\s*([^;]+);/g;

describe('Indic fonts', () => {
  it('fonts.ts imports the Devanagari and Bengali subsets of Noto Sans, regular and bold', () => {
    const fonts = read('src/ui/fonts.ts');
    for (const subset of ['noto-sans-devanagari/devanagari', 'noto-sans-bengali/bengali']) {
      expect(fonts).toContain(`@fontsource/${subset}-400.css`);
      expect(fonts).toContain(`@fontsource/${subset}-700.css`);
    }
  });

  it('the bundled font CSS points at local files only (no network)', () => {
    for (const file of ['noto-sans-devanagari/devanagari-400.css', 'noto-sans-bengali/bengali-700.css']) {
      const fontCss = read(`node_modules/@fontsource/${file}`);
      expect(fontCss).toMatch(/url\(\.\/files\//);
      expect(fontCss).not.toMatch(/url\((['"])?https?:/);
    }
  });

  it('every UI and document font stack falls back to both Noto families before the system font', () => {
    const stacks = [...css.matchAll(FONT_STACK)].map((m) => m[1]);
    expect(stacks.length).toBeGreaterThanOrEqual(6);
    for (const stack of stacks) expect(stack, stack).toContain('var(--indic-fonts)');
    expect(css).toMatch(/--indic-fonts:\s*'Noto Sans Devanagari',\s*'Noto Sans Bengali';/);
  });

  it('ATTRIBUTION lists both fonts with their copyright and the OFL text', () => {
    const attribution = read('resources/fonts/ATTRIBUTION.md');
    expect(attribution).toContain('`@fontsource/noto-sans-devanagari` | 5.3.0');
    expect(attribution).toContain('`@fontsource/noto-sans-bengali` | 5.3.0');
    expect(attribution).toContain('Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari)');
    expect(attribution).toContain('Copyright 2025 The Noto Project Authors (https://github.com/notofonts/bengali)');
    expect(attribution).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
  });
});
