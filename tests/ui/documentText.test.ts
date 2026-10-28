import { describe, it, expect } from 'vitest';
import { joinParagraphs, matchParagraphs, siblingPath } from '@/ui/state/documentText';

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

describe('matchParagraphs', () => {
  const paras = (texts: string[]) => texts.map((text, id) => ({ id, text }));
  const unchanged = (before: string[], after: string[]) => [...matchParagraphs(paras(before), paras(after)).unchanged];
  const copies = (before: string[], after: string[]) => [...matchParagraphs(paras(before), paras(after)).copies];

  it('maps each unchanged paragraph to its new id, even when it moved', () => {
    expect(unchanged(['A.', 'B.', 'C.'], ['New.', 'C.', 'B!', 'A.'])).toEqual([
      [2, 1],
      [0, 3],
    ]);
    expect(copies(['A.', 'B.', 'C.'], ['New.', 'C.', 'B!', 'A.'])).toEqual([]);
  });

  // Final F14 review I-3 (owner decision, Task F15): pairing copies in order put a decision on the other copy.
  it('never matches a text found in more than one paragraph, before or after', () => {
    // Two copies before, still two after.
    expect(unchanged(['A.', 'B.', 'A.', 'C.'], ['New.', 'A.', 'B!', 'A.', 'C.'])).toEqual([[3, 4]]);
    // Two copies before, one deleted.
    expect(unchanged(['A.', 'Note.', 'A.'], ['Note.', 'A.'])).toEqual([[1, 0]]);
    // One before, a copy pasted or typed to read the same.
    expect(unchanged(['A. Fine.', 'A.'], ['A.', 'A.'])).toEqual([]);
  });

  // Final F15 review M-13: an auto-fix undone there is held back on every copy.
  it('gives each paragraph left out for its copies the new paragraphs with its text', () => {
    expect(copies(['A.', 'B.', 'A.', 'C.'], ['New.', 'A.', 'B!', 'A.', 'C.'])).toEqual([
      [0, [1, 3]],
      [2, [1, 3]],
    ]);
    expect(copies(['A.', 'Note.', 'A.'], ['Note.', 'A.'])).toEqual([
      [0, [1]],
      [2, [1]],
    ]);
    expect(copies(['A. Fine.', 'A.'], ['A.', 'A.'])).toEqual([[1, [0, 1]]]);
  });

  // Final F15 review M-14: with the same list, which copy is which is certain.
  it('maps each paragraph to itself when the list is the same (count, text and order), copies included', () => {
    const after = ['A.', 'B.', 'A.'].map((text, i) => ({ id: i + 10, text }));
    const match = matchParagraphs(paras(['A.', 'B.', 'A.']), after);
    expect([...match.unchanged]).toEqual([
      [0, 10],
      [1, 11],
      [2, 12],
    ]);
    expect([...match.copies]).toEqual([]);
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
