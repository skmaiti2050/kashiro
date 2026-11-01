import { describe, it, expect } from 'vitest';
import { uncheckedText, otherScriptParagraphIds } from '@/engine/uncheckedScripts';

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

  it.each([
    ['Tamil', 'நாங்கள் நேற்று சந்தைக்குச் சென்றோம்.'],
    ['Gujarati', 'અમે ગઈકાલે બજારમાં ગયા હતા.'],
    ['Urdu', 'ہم کل بازار گئے تھے۔'],
    ['Punjabi', 'ਅਸੀਂ ਕੱਲ੍ਹ ਬਾਜ਼ਾਰ ਗਏ ਸੀ।'],
    ['Russian', 'Мы вчера ходили на рынок.'],
    ['Chinese', '我们昨天去了市场。'],
  ])('a %s document is mostly unchecked too: any script but Latin (F3 re-review, M1)', (_name, text) => {
    expect(uncheckedText(paras(text, text))).toEqual({ paragraphs: 2, mostly: true });
  });

  it('accents, digits, symbols and emoji are not another language', () => {
    expect(uncheckedText(paras('Café naïve résumé, ₹500 at 10:30 👍🏽 — “done”.'))).toEqual({ paragraphs: 0, mostly: false });
  });

  it('a Hindi word quoted in an English paragraph is not an unchecked paragraph', () => {
    expect(uncheckedText(paras('She said "धन्यवाद" and left the room quietly.'))).toEqual({ paragraphs: 0, mostly: false });
  });
});

describe('otherScriptParagraphIds (#2a: the paragraphs the check sets aside)', () => {
  it('lists the Hindi and Bengali paragraphs by id, in document order', () => {
    const doc = paras('We met on Monday.', 'यह एक परीक्षण है।', 'The bus leaves at nine.', 'আমরা কাল বাজারে গিয়েছিলাম।');
    expect(otherScriptParagraphIds(doc)).toEqual([1, 3]);
  });

  it('is empty for English, and for an English paragraph with a quoted Hindi word', () => {
    expect(otherScriptParagraphIds(paras('We met on Monday.', 'She said "धन्यवाद" and left the room quietly.'))).toEqual([]);
  });

  it('agrees with uncheckedText on the count', () => {
    const doc = paras('The bus leaves at nine.', 'यह एक परीक्षण है।', 'ہم کل بازار گئے تھے۔');
    expect(otherScriptParagraphIds(doc).length).toBe(uncheckedText(doc).paragraphs);
  });
});
