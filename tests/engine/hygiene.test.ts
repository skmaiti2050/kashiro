import { describe, it, expect } from 'vitest';
import { findInvisible } from '../../src/engine/hygiene';

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
});
