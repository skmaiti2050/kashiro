import { describe, it, expect } from 'vitest';
import { findLockedSpans, followsAbbreviation } from '../../src/engine/factLock';

function covered(text: string, needle: string, from = 0): boolean {
  const start = text.indexOf(needle, from);
  expect(start).toBeGreaterThanOrEqual(0);
  const spans = findLockedSpans(text);
  return spans.some((s) => s.start <= start && s.end >= start + needle.length);
}

describe('findLockedSpans', () => {
  it.each([
    '3 March 2025',
    '2025-03-03',
    '₹1,200',
    'p < 0.001',
    '45%',
    'v2.3.1',
    'https://exmple.com/teh',
    'a@b.co',
    '"quoted words"',
    '“quoted words”',
    '[12]',
    '(Smith, 2020)',
    '(Smith et al., 2020, p. 4)',
    '(Afridi, 2010; Singh et al., 2014)',
    '(Joshi and Pawar, 2020; Shah, 2009a)',
    '`code`',
    '$x^2$',
    String.raw`$$\int f$$`,
    String.raw`\cite{key}`,
    'NASA',
    'FPOs',
    'MSMEs',
  ])('locks %s fully', (needle) => {
    const text = `Before ${needle} after`;
    expect(covered(text, needle)).toBe(true);
  });

  it.each(['42', '3.14', '1,200', '1,20,000', '-7', '3rd', '21st', '10-20', '10–20'])(
    'locks bare number %s',
    (needle) => {
      expect(covered(`we saw ${needle} here`, needle)).toBe(true);
    },
  );

  it.each(['60s', '1990s', "’90s", "1990's"])('locks decade or age %s', (needle) => {
    expect(covered(`RAMESH (${needle}) waits`, needle)).toBe(true);
  });

  it('leaves an ordinary word next to a number unlocked', () => {
    const t = 'teh 5 cats';
    expect(findLockedSpans(t)).toEqual([{ start: 4, end: 5 }]);
  });

  it('locks it when it is the whole paragraph', () => {
    expect(covered('3 March 2025', '3 March 2025')).toBe(true);
  });

  it('does not swallow a trailing period of a URL', () => {
    const t = 'See https://exmple.com/teh.';
    const spans = findLockedSpans(t);
    expect(spans.every((s) => s.end <= t.length - 1)).toBe(true);
  });

  it('locks capitalised words not at sentence start, but not sentence-initial ones', () => {
    const t = 'The kid went to Kolkata with Sujit.';
    expect(covered(t, 'Kolkata')).toBe(true);
    expect(covered(t, 'Sujit')).toBe(true);
    const spans = findLockedSpans(t);
    expect(spans.some((s) => s.start < 3)).toBe(false);
  });

  it.each(['## The end', '- The end', '* The end', '1. The end', '> The end', 'Intro\n### The end'])(
    'treats a Markdown line start as a sentence start: %j',
    (t) => {
      expect(covered(t, 'The')).toBe(false);
    },
  );

  it('a hyphen inside a line is not a Markdown line start', () => {
    expect(covered('We met - The end', 'The')).toBe(true);
  });

  it('treats text after .?!: and openers as sentence start', () => {
    for (const t of ['Hi. The end', 'Why? The end', 'Note: The end', 'He said (The end)', 'He said “The end”']) {
      const i = t.indexOf('The');
      expect(findLockedSpans(t).some((s) => s.start <= i && s.end > i && !t.slice(s.start, s.end).startsWith('“') && t[s.start] !== '(' )).toBe(false);
    }
  });

  it.each([
    ['Dr.', 'We thanked Dr. Anjali Rao for the data.', 'Anjali'],
    ['Mr.', 'Ask Mr. Kumar first.', 'Kumar'],
    ['Mrs.', 'Ask Mrs. Iyer first.', 'Iyer'],
    ['Ms.', 'Ask Ms. Nair first.', 'Nair'],
    ['Prof.', 'As Prof. Mehta argued, it holds.', 'Mehta'],
    ['St.', 'They live on St. Marks Road.', 'Marks'],
    ['Mt.', 'We climbed Mt. Abu last year.', 'Abu'],
    ['Jr.', 'Sammy Davis Jr. Foundation funds it.', 'Foundation'],
    ['Sr.', 'Ken Griffey Sr. Field opened.', 'Field'],
    ['e.g.', 'Some cities, e.g. Pune, grew.', 'Pune'],
    ['i.e.', 'The capital, i.e. Delhi, grew.', 'Delhi'],
    ['etc.', 'Rice, dal etc. Tata supplied all.', 'Tata'],
    ['vs.', 'It was India vs. Australia again.', 'Australia'],
    ['Fig.', 'As shown in Fig. Three below.', 'Three'],
    ['approx.', 'It took approx. Twenty minutes.', 'Twenty'],
  ])('a capitalised word after %s is not a sentence start', (_abbr, t, word) => {
    expect(covered(t, word)).toBe(true);
  });

  it.each(["D'Souza", 'O’Brien', '234B', '44ADA', '80C', 'e521', 'B2B'])('locks %s mid-sentence', (needle) => {
    expect(covered(`under the rule ${needle} we go`, needle)).toBe(true);
  });

  it('locks the word right after a title, whatever its case', () => {
    expect(covered('We thank Mr. and Mrs. Qureshi today.', 'and')).toBe(true);
    expect(covered('We thank Mr. and Mrs. Qureshi today.', 'Qureshi')).toBe(true);
    expect(covered('We met Dr. smith at noon.', 'smith')).toBe(true);
  });

  it('locks initials like "A." and "R.K."', () => {
    const t = 'Joshi, A. and Pawar, R. K. wrote it with Mehta, S.';
    expect(covered(t, 'A.')).toBe(true);
    expect(covered(t, 'R. K.')).toBe(true);
    expect(covered(t, 'S.')).toBe(true);
    expect(covered('We read R. K. Narayan today.', 'Narayan')).toBe(true);
  });

  it('sentence-initial "Dr." itself is still a sentence start, and real sentence ends still count', () => {
    const t = 'Dr. Rao spoke. The hall was full.';
    expect(covered(t, 'Rao')).toBe(true);
    const spans = findLockedSpans(t);
    const the = t.indexOf('The');
    expect(spans.some((s) => s.start <= the && s.end > the)).toBe(false);
    expect(spans.some((s) => s.start === 0)).toBe(false);
  });

  it('a word ending in an abbreviation-like suffix is still a sentence end', () => {
    // "Hello." ends with "lo." not "No." — only whole tokens count.
    const t = 'He said hello. Then he left.';
    const i = t.indexOf('Then');
    expect(findLockedSpans(t).some((s) => s.start <= i && s.end > i)).toBe(false);
  });

  it('returns sorted, merged, non-overlapping spans', () => {
    const spans = findLockedSpans('a "see [12] and NASA" b 45%');
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThan(spans[i - 1].end - 1);
    expect(spans).toEqual([...spans].sort((a, b) => a.start - b.start));
  });

  it('returns nothing for plain lowercase prose', () => {
    expect(findLockedSpans('just some plain words here')).toEqual([]);
  });
});

describe('abbreviation edge cases', () => {
  const unlocked = (t: string, word: string) => {
    const i = t.indexOf(word);
    return !findLockedSpans(t).some((s) => s.start <= i && s.end > i);
  };

  it('"No." is an abbreviation only as case-sensitive "No." before a digit', () => {
    expect(unlocked('He said No. Then he left.', 'Then')).toBe(true);
    expect(unlocked('I said no. Then he left.', 'Then')).toBe(true);
    expect(followsAbbreviation('see No. 5 here', 8)).toBe(true);
    expect(followsAbbreviation('I said no. the end', 11)).toBe(false);
  });

  it('a single capital initial counts only before a capitalised word', () => {
    // "Plan B. the end": the linter is right to want "The".
    expect(followsAbbreviation('We chose Plan B. the end', 17)).toBe(false);
    expect(followsAbbreviation('Mr. and Mrs. Rao', 4)).toBe(true);
  });
});
