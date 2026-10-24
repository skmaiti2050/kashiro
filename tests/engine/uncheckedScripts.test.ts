import { describe, it, expect } from 'vitest';
import { uncheckedText } from '@/engine/uncheckedScripts';

const paras = (...texts: string[]) => texts.map((text, id) => ({ id, text }));

describe('uncheckedText (review #4: no false all-clear on Hindi or Bengali)', () => {
  it('an English document has nothing unchecked', () => {
    expect(uncheckedText(paras('We met on Monday.', 'The fee is ₹500.'))).toEqual({ paragraphs: 0, mostly: false });
  });

  it('a Hindi or Bengali document is mostly unchecked', () => {
    expect(uncheckedText(paras('यह एक परीक्षण है।', 'আমরা কাল বাজারে গিয়েছিলাম।'))).toEqual({ paragraphs: 2, mostly: true });
  });

  it('a mostly English document counts its Hindi paragraphs, and is not mostly unchecked', () => {
    const doc = paras('We met on Monday and planned the trip in detail.', 'यह एक परीक्षण है।', 'The bus leaves at nine.');
    expect(uncheckedText(doc)).toEqual({ paragraphs: 1, mostly: false });
  });

  it('a Hindi word quoted in an English paragraph is not an unchecked paragraph', () => {
    expect(uncheckedText(paras('She said "धन्यवाद" and left the room quietly.'))).toEqual({ paragraphs: 0, mostly: false });
  });
});
