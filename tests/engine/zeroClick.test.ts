import { describe, it, expect } from 'vitest';
import { isZeroClickChange } from '@/engine/zeroClick';
import { findLockedSpans } from '@/engine/factLock';
import type { Candidate, Paragraph } from '@/engine/types';

/** A rules flag on the first `original` in `text`. */
function flag(text: string, original: string, replacement: string, kind = 'Formatting', at = text.indexOf(original)): Candidate {
  return {
    id: `0:${at}:${at + original.length}:${kind}`,
    paraId: 0,
    span: { start: at, end: at + original.length },
    original,
    replacements: [replacement],
    kind,
    message: '',
    source: 'rules',
  };
}

const zeroClick = (c: Candidate, paragraph: Paragraph) => isZeroClickChange(c, paragraph, findLockedSpans(paragraph.text));
const para = (text: string, over: Partial<Paragraph> = {}): Paragraph => ({ id: 0, text, ...over });

describe('isZeroClickChange (Task F4: only invisible characters and spaces between words)', () => {
  it('collapses a run of spaces between two words', () => {
    const text = 'We went  home. The end.   Next one.';
    expect(zeroClick(flag(text, '  ', ' '), para(text))).toBe(true);
    expect(zeroClick(flag(text, '   ', ' '), para(text))).toBe(true);
  });

  it('deletes an invisible character hygiene flagged with its fix, and nothing hygiene only reports', () => {
    const text = 'mod\u{200B}els';
    const hygiene = (replacements: string[]): Candidate => ({ ...flag(text, '\u{200B}', ''), kind: 'Invisible', source: 'hygiene', replacements });
    expect(zeroClick(hygiene(['']), para(text))).toBe(true);
    expect(zeroClick(hygiene([]), para(text))).toBe(false);
  });

  it.each([
    ['a spelling fix', 'I think teh plan works.', 'teh', 'the', 'Typo'],
    ['an article', 'He ate a apple.', 'a', 'an', 'Miscellaneous'],
    ['a doubled word', 'We went to the the market.', 'the the', 'the', 'Repetition'],
    ['a capital', 'The Govt. of India.', 'of', 'Of', 'Capitalization'],
    ['punctuation', 'We went home,and left.', ',', ', ', 'Punctuation'],
    ['a space before a full stop', 'We went home .', ' ', '', 'Formatting'],
    ['a grammar fix', 'He go home.', 'go', 'goes', 'Grammar'],
  ])('never applies %s', (_name, text, original, replacement, kind) => {
    expect(zeroClick(flag(text, original, replacement, kind), para(text))).toBe(false);
  });

  it.each([
    ['at the end of the paragraph', 'Ends with spaces.   ', '   '],
    ['before a line break (a Markdown hard break)', 'Line one  \nLine two', '  '],
    ['a run of tabs', 'Tabs\t\tthere.', '\t\t'],
    ['next to an invisible character', 'today  \u{202C}  and left.', '  '],
  ])('leaves spaces %s', (_name, text, original) => {
    expect(zeroClick(flag(text, original, ' '), para(text))).toBe(false);
  });

  it.each([
    ['inside a quote', 'He wrote "we went  home" then.'],
    ['inside a code span', 'Run `ls  -la` now.'],
    ['in a table cell', 'Pens  and ink', { tableCell: true }],
    ['in columns lined up with spaces', 'Stock today:\nPens    10\nInk     25'],
    ['in a line with two column gaps', 'Name    Age    City'],
    ['in an indented line', '    x  = 1'],
    ['in a paragraph with a tab', 'Name:\tSujit  Rao'],
  ] as const)('leaves spaces %s', (_name, text, over: Partial<Paragraph> = {}) => {
    // The last run of spaces: the one between two words.
    const run = [...text.matchAll(/ {2,}/g)].at(-1)!;
    expect(zeroClick(flag(text, run[0], ' ', 'Formatting', run.index), para(text, over))).toBe(false);
  });
});
