// Text size, readable fonts, spacing and voice settings (Task A1 items 3–5).
import { describe, it, expect } from 'vitest';
import { DEFAULT_READING, readingStyle, resolveReading } from '@/ui/state/readingSettings';
import { defaultSettings, withSavedSettings } from '@/ui/state/settings';

describe('resolveReading', () => {
  it('nothing saved: the defaults (100 %, the usual fonts, line height 1.6, no extra letter spacing)', () => {
    expect(resolveReading(undefined)).toEqual({
      uiTextSize: 100,
      documentTextSize: 100,
      font: 'default',
      lineSpacing: 1.6,
      letterSpacing: 0,
      voice: null,
      rate: 1,
      pitch: 1,
      keyHints: true,
      theme: 'system',
    });
    expect(DEFAULT_READING.uiTextSize).toBe(100);
  });

  it('the theme: System, Light or Dark; anything else is System (Task F21b item 4)', () => {
    expect(resolveReading({ theme: 'dark' }).theme).toBe('dark');
    expect(resolveReading({ theme: 'light' }).theme).toBe('light');
    expect(resolveReading({ theme: 'sepia' }).theme).toBe('system');
  });

  it('keyboard shortcut hints on buttons: on unless switched off (Task F21b item 10)', () => {
    expect(resolveReading({ keyHints: false }).keyHints).toBe(false);
    expect(resolveReading({ keyHints: 'no' }).keyHints).toBe(true);
  });

  it('keeps valid saved values and fills in the rest', () => {
    expect(resolveReading({ uiTextSize: 150, font: 'atkinson', voice: 'David' })).toEqual({
      ...DEFAULT_READING,
      uiTextSize: 150,
      font: 'atkinson',
      voice: 'David',
    });
  });

  it('clamps sizes to 90–200 % and the other ranges', () => {
    expect(resolveReading({ uiTextSize: 400, documentTextSize: 50, lineSpacing: 9, letterSpacing: -1, rate: 5, pitch: 0 })).toEqual({
      ...DEFAULT_READING,
      uiTextSize: 200,
      documentTextSize: 90,
      lineSpacing: 2.4,
      letterSpacing: 0,
      rate: 2,
      pitch: 0.5,
    });
  });

  it.each([null, 'big', 42, []])('a damaged value (%j) gives the defaults', (saved) => {
    expect(resolveReading(saved)).toEqual(DEFAULT_READING);
  });

  it('drops values of the wrong type and unknown fonts', () => {
    expect(resolveReading({ uiTextSize: '150', font: 'Comic Sans', voice: 7, rate: Number.NaN })).toEqual(DEFAULT_READING);
  });
});

describe('settings', () => {
  it('defaults and old saved settings get the default reading settings', () => {
    expect(defaultSettings('en-US').reading).toEqual(DEFAULT_READING);
    expect(withSavedSettings(defaultSettings('en-US'), { preset: 'blog' }).reading).toEqual(DEFAULT_READING);
  });

  it('saved reading settings are resolved, not copied', () => {
    const saved = { reading: { uiTextSize: 999, font: 'opendyslexic' } } as never;
    expect(withSavedSettings(defaultSettings('en-US'), saved).reading).toEqual({ ...DEFAULT_READING, uiTextSize: 200, font: 'opendyslexic' });
  });
});

describe('readingStyle', () => {
  it('the CSS custom properties the app and document view read', () => {
    expect(readingStyle({ ...DEFAULT_READING, uiTextSize: 150, documentTextSize: 125, lineSpacing: 2, letterSpacing: 0.12 })).toEqual({
      '--ui-zoom': '1.5',
      '--doc-scale': '1.25',
      '--doc-line': '2',
      '--doc-letter': '0.12em',
    });
  });
});
