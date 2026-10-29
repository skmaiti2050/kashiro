import { isRecord } from '@/engine/modules';

export type ReadingFont = 'default' | 'atkinson' | 'opendyslexic';
/** The app's colours: Windows' light or dark mode (System), or one of them always (Task F21b item 4). */
export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

/** Settings › Reading and accessibility: text size, readable fonts, spacing and the read-aloud voice. */
export interface ReadingSettings {
  /** The app's own text and controls, in percent (90–200). */
  uiTextSize: number;
  /** The document text, in percent of its 17 px (90–200). */
  documentTextSize: number;
  /** Atkinson Hyperlegible or OpenDyslexic (both bundled, SIL OFL) for the document and the app. */
  font: ReadingFont;
  /** Line height of the document text. */
  lineSpacing: number;
  /** Extra space between letters in the document, in em (WCAG 1.4.12 asks that 0.12 works). */
  letterSpacing: number;
  /** The read-aloud voice's voiceURI; null, or a voice that is gone, uses the default local voice. */
  voice: string | null;
  /** Speech rate (1 is normal). */
  rate: number;
  /** Speech pitch (1 is normal). */
  pitch: number;
  /** Shortcut hints on buttons ("Enter", "Ctrl+O"); off hides them, the shortcuts still work (Task F21b item 10). */
  keyHints: boolean;
  /** Light or dark colours; a Windows contrast theme overrides both. */
  theme: ThemeChoice;
}

export const DEFAULT_READING: ReadingSettings = {
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
};

/** The choices Settings offers; resolveReading clamps a hand-edited file to the same ranges. */
export const TEXT_SIZES = [90, 100, 110, 125, 150, 175, 200];
export const LINE_SPACINGS = [1.4, 1.6, 1.8, 2, 2.4];
export const LETTER_SPACINGS = [0, 0.05, 0.12];
const FONTS: ReadingFont[] = ['default', 'atkinson', 'opendyslexic'];

const RANGES = {
  uiTextSize: [90, 200],
  documentTextSize: [90, 200],
  lineSpacing: [1.4, 2.4],
  letterSpacing: [0, 0.12],
  rate: [0.5, 2],
  pitch: [0.5, 1.5],
} as const;

/** A saved number clamped to its range; anything else (a string, NaN) gives the default. */
function numberIn(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** The saved reading settings over the defaults, with every value checked: a damaged file can't break the layout. */
export function resolveReading(saved: unknown): ReadingSettings {
  if (!isRecord(saved)) return { ...DEFAULT_READING };
  const resolved = { ...DEFAULT_READING };
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    resolved[key] = numberIn(saved[key], RANGES[key], DEFAULT_READING[key]);
  }
  if (FONTS.includes(saved.font as ReadingFont)) resolved.font = saved.font as ReadingFont;
  if (typeof saved.voice === 'string') resolved.voice = saved.voice;
  if (typeof saved.keyHints === 'boolean') resolved.keyHints = saved.keyHints;
  if (THEMES.includes(saved.theme as ThemeChoice)) resolved.theme = saved.theme as ThemeChoice;
  return resolved;
}

/** The CSS custom properties a11y.css reads: UI zoom, document size, line height and letter spacing. */
export function readingStyle(reading: ReadingSettings): Record<string, string> {
  return {
    '--ui-zoom': String(reading.uiTextSize / 100),
    '--doc-scale': String(reading.documentTextSize / 100),
    '--doc-line': String(reading.lineSpacing),
    '--doc-letter': `${reading.letterSpacing}em`,
  };
}
