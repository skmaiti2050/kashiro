import { describe, it, expect } from 'vitest';
import { findAlignedParagraphs, isZeroClickChange } from '@/engine/zeroClick';
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

const zeroClick = (c: Candidate, paragraph: Paragraph, aligned = false) => isZeroClickChange(c, paragraph, findLockedSpans(paragraph.text), aligned);
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

  it.each([
    ['aligned key-value lines in one paragraph (#8)', 'Name:      Rahul\nPhone: 98200 00000', 'Name:      Rahul'],
    ['a lone key-value line ending with a full stop (#8)', 'Address:  12 MG Road.', 'Address:  12 MG Road.'],
    ['a colon key before a value ending with a full stop (#8 ruling)', 'Note:  this is wrong.', 'Note:  this is wrong.'],
  ])('leaves the gap after a key with a colon: %s', (_name, text) => {
    const run = text.match(/ {2,}/)!;
    expect(zeroClick(flag(text, run[0], ' ', 'Formatting', run.index), para(text))).toBe(false);
  });

  it('still collapses a double space in a sentence without a colon key (#8)', () => {
    const text = 'This is  wrong.';
    expect(zeroClick(flag(text, '  ', ' '), para(text))).toBe(true);
  });

  it('leaves spaces in a paragraph lined up with its neighbours', () => {
    const text = 'Name      Rahul Sharma';
    expect(zeroClick(flag(text, '      ', ' '), para(text), true)).toBe(false);
    expect(zeroClick(flag(text, '      ', ' '), para(text), false)).toBe(true);
  });
});

describe('findAlignedParagraphs (F4 re-review 3, M-3)', () => {
  const paras = (...texts: string[]): Paragraph[] => texts.map((text, id) => ({ id, text }));

  it('finds one-line key–value paragraphs in a row: a block laid out with spaces, a line each', () => {
    const block = paras('Name      Rahul Sharma', 'City      Pune', 'Amount    500', 'Score: India 250  Australia 245', 'We went home.');
    expect([...findAlignedParagraphs(block)]).toEqual([0, 1, 2, 3]);
  });

  it('leaves sentences with a stray double space to the space rule, after a word or a full stop', () => {
    expect([...findAlignedParagraphs(paras('We went  home.', 'The hall was  full by ten.', 'It rained.', 'The end.  Next one.', 'The end.   Next one.'))]).toEqual([]);
  });

  it('leaves Hindi sentences with a stray double space to the space rule, after a word or a danda', () => {
    expect([...findAlignedParagraphs(paras('हम  घर गए।', 'सभा कक्ष  दस बजे भर गया।', 'बारिश हुई।', 'अंत।   अगला वाक्य।', 'पहला॥   दूसरा।'))]).toEqual([]);
  });

  it.each([
    ['keys with a colon', ['Name:      Rahul Sharma', 'City:      Pune'], [0, 1]],
    ['lines ending with a full stop', ['Company     Acme Pvt. Ltd.', 'Address     12 MG Road, Pune.'], [0, 1]],
    ['a block with one line ending with a full stop', ['Name      Rahul', 'Role      Engg. Lead.', 'City      Pune'], [0, 1, 2]],
    ['a lone line with a short key, between sentences', ['We went home.', 'Total      500', 'It rained.'], [1]],
    ['a lone line with a colon key', ['It rained.', 'Name:   Rahul Sharma', 'It rained.'], [1]],
    ['a lone colon-key line ending with a full stop (#8)', ['It rained.', 'Address:  12 MG Road.', 'It rained.'], [1]],
  ] as const)('finds %s (F5 re-review 4, M-3)', (_name, texts, aligned) => {
    expect([...findAlignedParagraphs(paras(...texts))]).toEqual(aligned);
  });
});
