import { describe, it, expect } from 'vitest';
import { editsChangingTokens, keepsTokens } from '@/engine/tokenGuard';

const edit = (text: string, original: string, replacement: string) => {
  const start = text.indexOf(original);
  return { paraId: 0, span: { start, end: start + original.length }, replacement };
};

describe('keepsTokens (the backstop on changes made without a click, Task F4)', () => {
  it('allows removed invisible characters and changed whitespace between tokens', () => {
    expect(keepsTokens('We went  home.', 'We went home.')).toBe(true);
    expect(keepsTokens('mod\u{200B}els and \u{2060}more', 'models and more')).toBe(true);
    expect(keepsTokens('a\u{202E}b\u{202C} c', 'ab c')).toBe(true);
    expect(keepsTokens('end.\n\nNext', 'end. Next')).toBe(true);
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
  ])('refuses %s', (_name, before, after) => {
    expect(keepsTokens(before, after)).toBe(false);
  });
});

describe('editsChangingTokens', () => {
  it('names only the edit that changes a token, and nothing when every edit keeps them', () => {
    const text = 'We went  home. The Govt. of India said\u{200B} so.';
    const spaces = edit(text, '  ', ' ');
    const capital = edit(text, 'of', 'Of');
    const invisible = edit(text, '\u{200B}', '');
    expect(editsChangingTokens(text, [spaces, invisible])).toEqual([]);
    expect(editsChangingTokens(text, [spaces, capital, invisible])).toEqual([1]);
  });

  it('takes back every edit when the rest still change a token together', () => {
    // Each deletion alone leaves one space between "a" and "b"; together they join them into "ab".
    const text = 'a  b';
    const first = { paraId: 0, span: { start: 1, end: 2 }, replacement: '' };
    const second = { paraId: 0, span: { start: 2, end: 3 }, replacement: '' };
    expect(editsChangingTokens(text, [first, second])).toEqual([0, 1]);
  });
});
