import { describe, it, expect } from 'vitest';
import { joinParagraphs, matchUnchangedParagraphs, siblingPath } from '@/ui/state/documentText';

describe('joinParagraphs', () => {
  it('joins paragraphs with a blank line and records their starts', () => {
    const { text, starts } = joinParagraphs([
      { id: 0, text: 'One.' },
      { id: 1, text: 'Two.' },
    ]);
    expect(text).toBe('One.\n\nTwo.');
    expect([...starts]).toEqual([
      [0, 0],
      [1, 6],
    ]);
  });
});

describe('matchUnchangedParagraphs', () => {
  const paras = (texts: string[]) => texts.map((text, id) => ({ id, text }));

  it('maps each unchanged paragraph to its new id, even when it moved', () => {
    expect([...matchUnchangedParagraphs(paras(['A.', 'B.', 'C.']), paras(['New.', 'C.', 'B!', 'A.']))]).toEqual([
      [2, 1],
      [0, 3],
    ]);
  });

  // Final F14 review I-3 (owner decision, Task F15): pairing copies in order put a decision on the other copy.
  it('never matches a text found in more than one paragraph, before or after', () => {
    // Two copies before, still two after.
    expect([...matchUnchangedParagraphs(paras(['A.', 'B.', 'A.', 'C.']), paras(['New.', 'A.', 'B!', 'A.', 'C.']))]).toEqual([[3, 4]]);
    // Two copies before, one deleted.
    expect([...matchUnchangedParagraphs(paras(['A.', 'Note.', 'A.']), paras(['Note.', 'A.']))]).toEqual([[1, 0]]);
    // One before, a copy pasted or typed to read the same.
    expect([...matchUnchangedParagraphs(paras(['A. Fine.', 'A.']), paras(['A.', 'A.']))]).toEqual([]);
  });

  // Final F15 review M-14: with the same list, which copy is which is certain.
  it('maps each paragraph to itself when the list is the same (count, text and order), copies included', () => {
    const after = ['A.', 'B.', 'A.'].map((text, i) => ({ id: i + 10, text }));
    expect([...matchUnchangedParagraphs(paras(['A.', 'B.', 'A.']), after)]).toEqual([
      [0, 10],
      [1, 11],
      [2, 12],
    ]);
  });
});

describe('siblingPath', () => {
  it.each([
    ['/docs/essay.docx', '.checked', undefined, '/docs/essay.checked.docx'],
    ['C:\\Users\\me\\essay.final.docx', '.checked', undefined, 'C:\\Users\\me\\essay.final.checked.docx'],
    ['/docs/essay.docx', '.report', '.md', '/docs/essay.report.md'],
    ['Untitled.txt', '.checked', undefined, 'Untitled.checked.txt'],
    ['/docs/README', '.checked', undefined, '/docs/README.checked'],
  ])('%s + %s', (path, suffix, ext, expected) => {
    expect(siblingPath(path, suffix, ext)).toBe(expected);
  });
});
