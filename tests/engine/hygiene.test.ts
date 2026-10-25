import { describe, it, expect } from 'vitest';
import { findInvisible, visibleText } from '../../src/engine/hygiene';

const p = (text: string) => ({ id: 7, text });
const ZWSP = '​';
const ZWNJ = '‌';
const ZWJ = '‍';
const WJ = '⁠';
const BOM = '﻿';
const SHY = '­';

describe('findInvisible', () => {
  it.each([
    ['U+200B', ZWSP],
    ['U+2060', WJ],
    ['U+FEFF', BOM],
  ])('flags %s anywhere', (_n, ch) => {
    const text = `ab${ch}cd`;
    const [c, ...rest] = findInvisible(p(text));
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      id: '7:2:3:Invisible',
      paraId: 7,
      span: { start: 2, end: 3 },
      original: ch,
      replacements: [''],
      kind: 'Invisible',
      source: 'hygiene',
    });
    expect(c.message).toMatch(/^Invisible character \(U\+[0-9A-F]{4}/);
  });

  it('flags a lone BOM at paragraph start', () => {
    expect(findInvisible(p(`${BOM}Hello`)).map((c) => c.span)).toEqual([{ start: 0, end: 1 }]);
  });

  it('flags soft hyphen between Latin letters', () => {
    expect(findInvisible(p(`co${SHY}operate`))).toHaveLength(1);
  });

  it('flags ZWJ/ZWNJ between Latin letters', () => {
    expect(findInvisible(p(`a${ZWJ}b`))).toHaveLength(1);
    expect(findInvisible(p(`a${ZWNJ}b`))).toHaveLength(1);
  });

  it('keeps ZWJ in emoji sequences', () => {
    expect(findInvisible(p(`\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`))).toEqual([]);
    expect(findInvisible(p(`❤️${ZWJ}\u{1F525}`))).toEqual([]);
  });

  it('keeps ZWJ/ZWNJ in Devanagari and Bengali', () => {
    expect(findInvisible(p(`क्${ZWJ}ष`))).toEqual([]);
    expect(findInvisible(p(`ক্${ZWNJ}ষ`))).toEqual([]);
  });

  it('keeps ZWNJ in Arabic-script text', () => {
    expect(findInvisible(p(`می${ZWNJ}خواهم`))).toEqual([]);
  });

  it('makes each invisible character its own candidate', () => {
    const r = findInvisible(p(`a${ZWSP}b${ZWSP}c${WJ}d`));
    expect(r.map((c) => c.span.start)).toEqual([1, 3, 5]);
    expect(new Set(r.map((c) => c.id)).size).toBe(3);
  });

  it('uses UTF-16 offsets after astral characters', () => {
    const [c] = findInvisible(p(`\u{1F600} a${ZWSP}b`));
    expect(c.span).toEqual({ start: 4, end: 5 });
  });

  it('flags direction controls U+202A–U+202E and U+180E in Latin text (review #4)', () => {
    const controls = ['\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}', '\u{202E}', '\u{180E}'];
    const r = findInvisible(p(controls.map((ch) => `a${ch}b`).join(' ')));
    // U+202B … U+202C is a pair; the other direction controls have no partner, so they stay (F3 re-review, D3).
    expect(r.map((c) => c.message)).toEqual([
      'Direction character left in place (U+202A LEFT-TO-RIGHT EMBEDDING)',
      'Invisible character (U+202B RIGHT-TO-LEFT EMBEDDING)',
      'Invisible character (U+202C POP DIRECTIONAL FORMATTING)',
      'Direction character left in place (U+202D LEFT-TO-RIGHT OVERRIDE)',
      'Direction character left in place (U+202E RIGHT-TO-LEFT OVERRIDE)',
      'Invisible character (U+180E MONGOLIAN VOWEL SEPARATOR)',
    ]);
  });

  /** Each flagged character's offset and whether hygiene offers to delete it. */
  const flagged = (text: string, locked?: { start: number; end: number }[]) =>
    findInvisible(p(text), locked).map((c) => [c.span.start, c.replacements.length === 1 && c.replacements[0] === '']);

  it('deletes direction controls only as balanced pairs (F3 re-review, D3)', () => {
    // RLO … PDF, and a nested LRE … PDF inside it: both pairs go.
    expect(flagged('a\u{202E}b\u{202A}c\u{202C}d\u{202C}e')).toEqual([[1, true], [3, true], [5, true], [7, true]]);
  });

  it('reports an unpaired direction control without deleting it: removing it alone would change what the reader sees', () => {
    const [rlo] = findInvisible(p('Read the note\u{202E}s first.'));
    expect(rlo).toMatchObject({ span: { start: 13, end: 14 }, replacements: [], kind: 'Invisible', source: 'hygiene' });
    expect(rlo.message).toBe('Direction character left in place (U+202E RIGHT-TO-LEFT OVERRIDE)');
    expect(flagged('a\u{202C}b')).toEqual([[1, false]]); // an end with nothing open
    expect(flagged('a\u{202D}b\u{202E}c\u{202C}d')).toEqual([[1, false], [3, true], [5, true]]); // the outer one never ends
  });

  it('keeps both ends of a pair when either is inside a protected span (F3 re-review, D3)', () => {
    const text = 'He said "\u{202E}sales" today\u{202C} and left.';
    const quote = { start: 8, end: 16 };
    expect(flagged(text, [quote])).toEqual([[9, false], [22, false]]);
    expect(flagged(text)).toEqual([[9, true], [22, true]]);
  });

  it('never flags a variation selector: emoji need it (F3 re-review, D2)', () => {
    expect(findInvisible(p('a\u{FE0F}b \u{2764}\u{FE0F} c\u{FE00}d'))).toEqual([]);
  });

  it('keeps direction controls in a paragraph with right-to-left text, and U+180E in Mongolian', () => {
    expect(findInvisible(p(`He wrote \u{202B}שלום\u{202C} twice.`))).toEqual([]);
    expect(findInvisible(p(`ᠮᠣᠷᠢ\u{180E}ᠠ`))).toEqual([]);
  });
});

describe('visibleText', () => {
  const text = `mod${ZWSP}els and t${WJ}eh${ZWSP}`;
  const view = visibleText(p(text), findInvisible(p(text)));

  it('is the text without the flagged characters', () => {
    expect(view.text).toBe('models and teh');
  });

  it('maps spans back to the paragraph, covering what they straddle and nothing after', () => {
    expect(view.toParagraph({ start: 0, end: 6 })).toEqual({ start: 0, end: 7 }); // "mod<ZWSP>els"
    expect(view.toParagraph({ start: 7, end: 10 })).toEqual({ start: 8, end: 11 }); // "and"
    expect(view.toParagraph({ start: 11, end: 14 })).toEqual({ start: 12, end: 16 }); // "t<WJ>eh", not the ZWSP after
    expect(view.toParagraph({ start: 14, end: 14 })).toEqual({ start: 17, end: 17 }); // the end
  });

  it('is the paragraph itself when nothing is flagged', () => {
    const clean = visibleText(p('क्\u{200D}ष'), []);
    expect(clean.text).toBe('क्\u{200D}ष');
    expect(clean.toParagraph({ start: 1, end: 2 })).toEqual({ start: 1, end: 2 });
  });
});
