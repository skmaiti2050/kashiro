import { describe, it, expect } from 'vitest';
import { editsChangingTokens, keepsTokens } from '@/engine/tokenGuard';

const edit = (text: string, original: string, replacement: string) => {
  const start = text.indexOf(original);
  return { paraId: 0, span: { start, end: start + original.length }, replacement };
};

/** The offsets of every invisible character in `text`: hygiene may delete them all. */
const allInvisible = (text: string) => new Set([...text.matchAll(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu)].map((m) => m.index!));
const NONE = new Set<number>();

describe('keepsTokens (the backstop on changes made without a click, Task F4)', () => {
  it('allows removed invisible characters hygiene may delete, and changed whitespace between tokens', () => {
    expect(keepsTokens('We went  home.', 'We went home.', NONE)).toBe(true);
    expect(keepsTokens('mod\u{200B}els and \u{2060}more', 'models and more', new Set([3, 12]))).toBe(true);
    expect(keepsTokens('a\u{202E}b\u{202C} c', 'ab c', new Set([1, 3]))).toBe(true);
    expect(keepsTokens('end.\n\nNext', 'end. Next', NONE)).toBe(true);
    // A tag character outside the BMP: its offset is where it starts.
    expect(keepsTokens('flag\u{E0041} here', 'flag here', new Set([4]))).toBe(true);
  });

  it.each([
    ['a case change', 'The Govt. of India.', 'The Govt. Of India.'],
    ['a question mark made a full stop', 'Is it done?', 'Is it done.'],
    ['a hyphen made a space', 'Send an e-mail.', 'Send an e mail.'],
    ['an apostrophe made a space', "Don't go.", 'Don t go.'],
    ['a slash made a space', 'Use and/or here.', 'Use and or here.'],
    ['a word removed', 'He had had enough.', 'He had enough.'],
    ['a word changed', 'Plug in a usb drive.', 'Plug in an usb drive.'],
    ['two words joined', 'Send the file name.', 'Send the filename.'],
    ['a space removed before a full stop', 'We went home .', 'We went home.'],
    ['a digit removed', 'It fell 50% today.', 'It fell 5% today.'],
    // No normalisation: an accent written another way, or a vowel sign lost, is a change (F4 re-review 3, M-2).
    ['a precomposed accent decomposed', 'Caf\u{00E9} open.', 'Cafe\u{0301} open.'],
    ['a vowel sign removed', 'कि गया', 'क गया'],
    ['a nukta removed', 'ज़रा', 'जरा'],
  ])('refuses %s', (_name, before, after) => {
    expect(keepsTokens(before, after, allInvisible(before))).toBe(false);
  });

  it.each([
    ['an invisible character added (a reversing RLO)', 'He paid 100 today.', 'He paid 1\u{202E}00 today.', NONE],
    ['a joiner swapped for a non-joiner (another conjunct)', 'क्\u{200D}ष', 'क्\u{200C}ष', allInvisible('क्\u{200D}ष')],
    ['a joiner hygiene keeps deleted', 'क्\u{200D}ष', 'क्ष', NONE],
  ])('refuses %s (F4 re-review 3, M-1)', (_name, before, after, removable) => {
    expect(keepsTokens(before, after, removable)).toBe(false);
  });
});

describe('editsChangingTokens', () => {
  it('names only the edit that changes a token, and nothing when every edit keeps them', () => {
    const text = 'We went  home. The Govt. of India said\u{200B} so.';
    const spaces = edit(text, '  ', ' ');
    const capital = edit(text, 'of', 'Of');
    const invisible = edit(text, '\u{200B}', '');
    const removable = allInvisible(text);
    expect(editsChangingTokens(text, [spaces, invisible], removable)).toEqual([]);
    expect(editsChangingTokens(text, [spaces, capital, invisible], removable)).toEqual([1]);
    // The same deletion, of a character hygiene does not flag, is taken back.
    expect(editsChangingTokens(text, [spaces, invisible], NONE)).toEqual([1]);
  });

  it('takes back every edit when the rest still change a token together', () => {
    // Each deletion alone leaves one space between "a" and "b"; together they join them into "ab".
    const text = 'a  b';
    const first = { paraId: 0, span: { start: 1, end: 2 }, replacement: '' };
    const second = { paraId: 0, span: { start: 2, end: 3 }, replacement: '' };
    expect(editsChangingTokens(text, [first, second], NONE)).toEqual([0, 1]);
  });
});
