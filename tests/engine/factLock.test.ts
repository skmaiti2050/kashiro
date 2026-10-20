import { describe, it, expect } from 'vitest';
import { findLockedSpans } from '../../src/engine/factLock';

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
    '`code`',
    '$x^2$',
    String.raw`$$\int f$$`,
    String.raw`\cite{key}`,
    'NASA',
  ])('locks %s fully', (needle) => {
    const text = `Before ${needle} after`;
    expect(covered(text, needle)).toBe(true);
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

  it('treats text after .?!: and openers as sentence start', () => {
    for (const t of ['Hi. The end', 'Why? The end', 'Note: The end', 'He said (The end)', 'He said “The end”']) {
      const i = t.indexOf('The');
      expect(findLockedSpans(t).some((s) => s.start <= i && s.end > i && !t.slice(s.start, s.end).startsWith('“') && t[s.start] !== '(' )).toBe(false);
    }
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
