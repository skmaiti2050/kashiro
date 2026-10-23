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
  it('maps each unchanged old paragraph to its new id, in order, once each', () => {
    const before = ['A.', 'B.', 'A.', 'C.'].map((text, id) => ({ id, text }));
    const after = ['New.', 'A.', 'B!', 'A.', 'C.'].map((text, id) => ({ id, text }));
    expect([...matchUnchangedParagraphs(before, after)]).toEqual([
      [0, 1],
      [2, 3],
      [3, 4],
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
