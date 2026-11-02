import { describe, it, expect } from 'vitest';
import {
  uncheckedText,
  otherScriptParagraphIds,
  otherScriptPassages,
  hasLatinLetter,
  uncheckedPassages,
  dominantScript,
  majorityScript,
} from '@/engine/uncheckedScripts';

const paras = (...texts: string[]) => texts.map((text, id) => ({ id, text }));

describe('majorityScript (#2b: which registered script a whole document is mostly written in)', () => {
  it('names a listed script with more letters than Latin and than each other listed one, across paragraphs', () => {
    expect(majorityScript(['यह एक परीक्षण है।', 'We met.', 'यह'], ['Devanagari', 'Bengali'])).toBe('Devanagari');
  });

  it('is undefined (English) when Latin has as many letters or more, or two listed scripts tie', () => {
    expect(majorityScript(['ab', 'कख'], ['Devanagari'])).toBeUndefined();
    expect(majorityScript(['We met on Monday.', 'कख'], ['Devanagari'])).toBeUndefined();
    expect(majorityScript(['कख', 'গঘ'], ['Devanagari', 'Bengali'])).toBeUndefined();
  });

  it('letters of unlisted scripts do not count', () => {
    expect(majorityScript(['a', 'कख', 'আমরা কাল বাজারে'], ['Devanagari'])).toBe('Devanagari');
  });
});

describe('dominantScript (#2b: which registered script a set-aside paragraph is written in)', () => {
  const both = ['Devanagari', 'Bengali'];

  it('names the script with the most letters', () => {
    expect(dominantScript('यह एक परीक्षण है। আমরা', both)).toBe('Devanagari');
    expect(dominantScript('আমরা কাল বাজারে গিয়েছিলাম। यह', both)).toBe('Bengali');
  });

  it('is undefined when an unregistered script has more letters, or on a tie', () => {
    expect(dominantScript('আমরা কাল বাজারে গিয়েছিলাম। यह', ['Devanagari'])).toBeUndefined();
    expect(dominantScript('कख গঘ', both)).toBeUndefined();
  });

  it('counts only letters of other scripts: Latin, digits and punctuation never decide', () => {
    expect(dominantScript('abc defgh 123 !!! कख', ['Devanagari'])).toBe('Devanagari');
  });

  it('an unknown script name is an error that says so', () => {
    expect(() => dominantScript('कख', ['Hindi'])).toThrow(/Hindi/);
  });
});

describe('otherScriptPassages (#29: words inside a checked paragraph that are not English)', () => {
  const words = (text: string) => otherScriptPassages(text).map((s) => text.slice(s.start, s.end));

  it('one Hindi word in an English sentence is one passage', () => {
    expect(words('She said नमस्ते and left.')).toEqual(['नमस्ते']);
  });

  it('a Hindi phrase is one passage, not one per word', () => {
    expect(words('We read रामायण और महाभारत yesterday.')).toEqual(['रामायण और महाभारत']);
  });

  it('keeps the span end-exclusive and leaves trailing punctuation out', () => {
    const text = 'Say नमस्ते, please.';
    expect(otherScriptPassages(text)).toEqual([{ start: 4, end: 10 }]);
  });

  it('Latin letters with accents (names) are not passages', () => {
    expect(words('José met Müller.')).toEqual([]);
  });

  it('emoji, digits and punctuation are not passages', () => {
    expect(words('🎉🎉 2024!')).toEqual([]);
  });

  it('Bengali and Tamil words are passages', () => {
    expect(words('He said কাল and then நேற்று twice.')).toEqual(['কাল', 'நேற்று']);
  });

  it('a Latin word between two other-script words splits them', () => {
    expect(words('क and then ख')).toEqual(['क', 'ख']);
  });
});

describe('uncheckedPassages never overlap (#29)', () => {
  const text = "We met. C'est la vie, mon ami नमस्ते. Then नमस्ते again.";
  const foreignStart = text.indexOf("C'est");
  const foreignEnd = text.indexOf('. Then') + 1;
  const list = () => uncheckedPassages([{ id: 0, text }], new Set(), new Map([[0, [{ start: foreignStart, end: foreignEnd }]]]));

  it('an other-script word inside a foreign sentence is covered by the sentence alone', () => {
    expect(list().map((p) => [p.kind, text.slice(p.span.start, p.span.end)])).toEqual([
      ['otherLanguage', "C'est la vie, mon ami नमस्ते."],
      ['otherScript', 'नमस्ते'],
    ]);
  });

  it('a run that runs on past a foreign sentence is clipped: the part outside is still reported', () => {
    const merged = "We met. C'est la vie नमस्ते. अगला वाक्य ok.";
    const end = merged.indexOf('नमस्ते') + 'नमस्ते.'.length;
    const list = uncheckedPassages([{ id: 0, text: merged }], new Set(), new Map([[0, [{ start: merged.indexOf("C'est"), end }]]]));
    expect(list.map((p) => [p.kind, merged.slice(p.span.start, p.span.end)])).toEqual([
      ['otherLanguage', "C'est la vie नमस्ते."],
      ['otherScript', 'अगला वाक्य'],
    ]);
  });

  it('a run cut by a foreign sentence keeps its piece before the sentence', () => {
    const cut = 'नमस्ते hello';
    const list = uncheckedPassages([{ id: 0, text: cut }], new Set(), new Map([[0, [{ start: 3, end: 12 }]]]));
    expect(list.map((p) => [p.kind, p.span.start, p.span.end])).toEqual([
      ['otherScript', 0, 3],
      ['otherLanguage', 3, 12],
    ]);
  });
});

describe('notation and code/math are not passages (#29 owner ruling)', () => {
  const words = (text: string) => otherScriptPassages(text).map((s) => text.slice(s.start, s.end));
  const inDoc = (text: string) => uncheckedPassages([{ id: 0, text }], new Set(), new Map()).map((p) => text.slice(p.span.start, p.span.end));

  it.each(['α = 0.05', 'π r²', 'Δt', '5 μm', 'Ω', 'Ж'])('a single Greek or Cyrillic letter is notation: %s', (text) => {
    expect(words(text)).toEqual([]);
  });

  it('whole Greek and Cyrillic words are still passages', () => {
    expect(words('He said ευχαριστώ and спасибо.')).toEqual(['ευχαριστώ', 'спасибо']);
  });

  it('any other script counts even as one letter', () => {
    expect(words('letter क here')).toEqual(['क']);
  });

  it.each([
    ['backticks', 'Run `नमस्ते` now.'],
    ['inline math', 'Let $नमस्ते + 1$ be it.'],
    ['display math', 'See $$नमस्ते$$ here.'],
    ['LaTeX parentheses', String.raw`Let \(नमस्ते\) be it.`],
    ['LaTeX brackets', String.raw`Let \[नमस्ते\] be it.`],
    ['a fenced code block', 'Code:\n```\nनमस्ते\n```\nDone.'],
  ])('a Hindi word inside %s is not a passage', (_name, text) => {
    expect(inDoc(text)).toEqual([]);
  });

  it('the same word inside quotes is a passage', () => {
    expect(inDoc('She said "नमस्ते" twice.')).toEqual(['नमस्ते']);
  });

  it('a run is cut at code, and its other part is still reported', () => {
    expect(inDoc('नमस्ते `x` और')).toEqual(['नमस्ते', 'और']);
  });
});

describe('hasLatinLetter', () => {
  it('is false for emoji, digits and punctuation, true for a Latin word', () => {
    expect(hasLatinLetter('🎉 2024 !?')).toBe(false);
    expect(hasLatinLetter('🎉 ok')).toBe(true);
    expect(hasLatinLetter('José')).toBe(true);
  });
});

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
