import { describe, it, expect } from 'vitest';
import { findDoubleSpaces } from '@/engine/doubleSpaces';

const para = (text: string) => ({ id: 3, text });

describe('findDoubleSpaces', () => {
  it('finds two spaces between two words, shaped like Harper’s own lint', () => {
    expect(findDoubleSpaces(para('यह  परीक्षण है।'), undefined)).toEqual([
      {
        id: '3:2:4:Formatting',
        paraId: 3,
        span: { start: 2, end: 4 },
        original: '  ',
        replacements: [' '],
        kind: 'Formatting',
        message: 'There are 2 spaces where there should be only one.',
        source: 'rules',
      },
    ]);
  });

  it('finds one candidate over a run of three spaces', () => {
    const found = findDoubleSpaces(para('यह   परीक्षण है।'), undefined);
    expect(found.map((c) => [c.span, c.original, c.message])).toEqual([
      [{ start: 2, end: 5 }, '   ', 'There are 3 spaces where there should be only one.'],
    ]);
  });

  it('finds nothing in a leading or trailing run', () => {
    expect(findDoubleSpaces(para('  यह परीक्षण है।'), undefined)).toEqual([]);
    expect(findDoubleSpaces(para('यह परीक्षण है।  '), undefined)).toEqual([]);
  });

  it('finds nothing inside a locked span', () => {
    expect(findDoubleSpaces(para('यह  परीक्षण है।'), [{ start: 0, end: 6 }])).toEqual([]);
  });

  it('finds nothing at a single space', () => {
    expect(findDoubleSpaces(para('यह परीक्षण है।'), undefined)).toEqual([]);
  });
});
