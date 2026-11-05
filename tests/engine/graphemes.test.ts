import { describe, it, expect, vi, afterEach } from 'vitest';
import { splitsCharacter } from '@/engine/graphemes';

describe('splitsCharacter', () => {
  it.each([
    ['a base letter before its combining accent', 'cafe\u0301 au lait', { start: 0, end: 4 }, true],
    ['the whole accented word', 'cafe\u0301 au lait', { start: 0, end: 5 }, false],
    ['a Devanagari consonant without its vowel sign', 'किताब', { start: 0, end: 1 }, true], // क + ि
    ['a whole Devanagari syllable', 'किताब', { start: 0, end: 2 }, false],
    ['half of a conjunct (virama)', 'क्षमा', { start: 0, end: 2 }, true], // क ् | ष
    ['क्ष in क्षत्रिय, cut after the halant', 'क्षत्रिय', { start: 0, end: 2 }, true],
    ['the whole क्ष in क्षत्रिय', 'क्षत्रिय', { start: 0, end: 3 }, false],
    ['the first क of क्क in नक्काशी', 'नक्काशी', { start: 1, end: 3 }, true],
    ['the whole क्का in नक्काशी', 'नक्काशी', { start: 1, end: 5 }, false],
    ['भ् of भ्य in अभ्यास', 'अभ्यास', { start: 1, end: 3 }, true],
    ['the whole भ्या in अभ्यास', 'अभ्यास', { start: 1, end: 5 }, false],
    ['ऋ in ऋषि is one code point', 'ऋषि', { start: 0, end: 1 }, false],
    ['क without its ृ in कृषि', 'कृषि', { start: 0, end: 1 }, true],
    ['a Bengali conjunct cut after the hasanta', 'ক্ষমা', { start: 0, end: 2 }, true],
    ['inside an emoji ZWJ sequence', 'Hi 👩‍💻 there', { start: 3, end: 5 }, true],
    ['a zero-length insertion between two letters', 'ab', { start: 1, end: 1 }, false],
    ['the end of the text', 'ab', { start: 1, end: 2 }, false],
  ])('%s', (_name, text, span, splits) => {
    expect(splitsCharacter(text, span)).toBe(splits);
  });

  it('an explicit half form (halant + ZWNJ) is two characters on purpose', () => {
    expect(splitsCharacter('क्\u200Cष', { start: 0, end: 3 })).toBe(false);
  });

  it('a word ending in a halant ends at its halant', () => {
    expect(splitsCharacter('जगत् है', { start: 0, end: 4 })).toBe(false);
  });
});

describe('splitsCharacter on an engine older than Unicode 15.1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const RealSegmenter = Intl.Segmenter;

  /** After a halant, or after a halant and ZWJ ("क्|ष", "क्\u200D|ष"). */
  const OLD_BREAK = /(?<=[्্]\u200D?)(?!\u200D)/;

  /** The real segmenter, but breaking after every halant as pre-15.1 engines do ('क्ष' → 'क्', 'ष'). */
  class OldSegmenter {
    private readonly real: Intl.Segmenter;
    constructor(locales?: string | string[], options?: Intl.SegmenterOptions) {
      this.real = new RealSegmenter(locales, options);
    }
    segment(text: string) {
      const pieces: Intl.SegmentData[] = [];
      for (const s of this.real.segment(text)) {
        let index = s.index;
        for (const part of s.segment.split(OLD_BREAK)) {
          pieces.push({ segment: part, index, input: text });
          index += part.length;
        }
      }
      return {
        containing: (at: number) => pieces.find((p) => p.index <= at && at < p.index + p.segment.length),
        [Symbol.iterator]: () => pieces[Symbol.iterator](),
      };
    }
  }

  it('still keeps a conjunct whole by the halant rule', async () => {
    const segmenter = new OldSegmenter(undefined, { granularity: 'grapheme' });
    expect([...segmenter.segment('क्ष')].map((s) => s.segment)).toEqual(['क्', 'ष']);
    vi.resetModules();
    // Intl's members aren't enumerable, so a spread would drop them: inherit them instead.
    vi.stubGlobal('Intl', Object.assign(Object.create(Intl), { Segmenter: OldSegmenter }));
    const old = await import('@/engine/graphemes');
    expect(old.splitsCharacter('क्षत्रिय', { start: 0, end: 2 })).toBe(true);
    expect(old.splitsCharacter('नक्काशी', { start: 1, end: 3 })).toBe(true);
    expect(old.splitsCharacter('क्षत्रिय', { start: 0, end: 3 })).toBe(false);
    expect([...new OldSegmenter(undefined, { granularity: 'grapheme' }).segment('क्\u200Dष')].map((s) => s.segment)).toEqual(['क्\u200D', 'ष']);
    expect(old.splitsCharacter('क्\u200Dष', { start: 0, end: 3 })).toBe(true); // the ZWJ half form: क्\u200D|ष
    expect(old.splitsCharacter('क्\u200Cष', { start: 0, end: 3 })).toBe(false); // the ZWNJ one is two characters
  });
});
