import { describe, it, expect } from 'vitest';
import type { Candidate } from '@/engine/types';
import { improveSuggestions } from '@/engine/suggestions/improve';
import { isCommonWord, nearbyWords, wordsByFrequency, zipfOf } from '@/engine/suggestions/frequency';
import { isOffensive, OFFENSIVE_WORDS } from '@/engine/suggestions/offensive';
import { tierOf, type TierContext } from '@/engine/tiers';
import { PRESETS } from '@/engine/presets';

function flag(original: string, replacements: string[], kind = 'Spelling', start = 4): Candidate {
  return {
    id: `0:${start}:${original}`,
    paraId: 0,
    span: { start, end: start + original.length },
    original,
    replacements,
    kind,
    message: 'msg',
    source: 'rules',
  };
}

describe('word frequency list', () => {
  it('gives Zipf frequencies, 0 for unknown words, case-insensitively', () => {
    expect(zipfOf('the')).toBeCloseTo(7.7);
    expect(zipfOf('The')).toBeCloseTo(7.7);
    expect(zipfOf("don't")).toBeGreaterThan(6);
    expect(zipfOf('qwzxv')).toBe(0);
  });

  it('lists 100,000 words, most frequent first', () => {
    const words = wordsByFrequency();
    expect(words).toHaveLength(100_000);
    expect(words.slice(0, 3)).toEqual(['the', 'to', 'and']);
  });

  it('a common word is at least Zipf 3.0: "occurrence" is, "dosh" is not', () => {
    expect(isCommonWord('occurrence')).toBe(true);
    expect(isCommonWord('accommodate')).toBe(true);
    expect(isCommonWord('dosh')).toBe(false);
    expect(isCommonWord('a dress')).toBe(false);
  });

  it('finds common words within the given edits, nearest and most frequent first', () => {
    expect(nearbyWords('arived', 1).map((n) => n.word)).toContain('arrived');
    expect(nearbyWords('litle', 1)[0].word).toBe('little');
    expect(nearbyWords('existant', 1).map((n) => n.word)).toContain('existent');
    for (const n of nearbyWords('acommodate', 2)) expect(n.distance).toBeLessThanOrEqual(2);
    expect(nearbyWords('acommodate', 2).map((n) => n.word)).toContain('accommodate');
  });
});

describe('offensive words', () => {
  it('blocks the listed words and their uses inside a suggestion', () => {
    for (const w of OFFENSIVE_WORDS) expect(isOffensive(w)).toBe(true);
    expect(isOffensive('Shit')).toBe(true);
    expect(isOffensive('bull shit')).toBe(true);
    expect(isOffensive('suit')).toBe(false);
    expect(isOffensive('Scunthorpe')).toBe(false);
  });
});

describe('improveSuggestions (spec §5 better suggestions)', () => {
  it('never suggests an offensive word for an ordinary one: Sujit → Shit is impossible', () => {
    expect(improveSuggestions(flag('Sujit', ['Suit', 'Suji', 'Shit'])).replacements).toEqual(['Suit', 'Suji']);
    expect(improveSuggestions(flag('sujit', ['suit', 'shit', 'sit'])).replacements).not.toContain('shit');
  });

  it('keeps an offensive suggestion when the original is that word misspelt ("shitt")', () => {
    expect(improveSuggestions(flag('shitt', ['shit'])).replacements).toEqual(['shit']);
  });

  it('ranks the more likely word first: frequent, close, same length', () => {
    expect(improveSuggestions(flag('recods', ['recons', 'records', "rec's"])).replacements[0]).toBe('records');
  });

  it('adds a common word the linter missed when it only offered a split ("arived" → "a rived")', () => {
    const c = improveSuggestions(flag('arived', ['a rived'], 'Typo'));
    expect(c.replacements[0]).toBe('arrived');
    expect(c.replacements).toContain('a rived');
    expect(c.replacements.length).toBeLessThanOrEqual(4);
    expect(c.linterReplacements).toEqual(['a rived']);
  });

  it('adds a far more common one-edit word to a list of rare ones ("litle" → "little")', () => {
    expect(improveSuggestions(flag('litle', ['lithe', 'lisle', 'lite'])).replacements[0]).toBe('little');
  });

  it('adds up to 3 words within 2 edits when the linter offers nothing close', () => {
    const c = improveSuggestions(flag('acommodatte', []));
    expect(c.replacements[0]).toBe('accommodate');
    expect(c.replacements.length).toBeLessThanOrEqual(3);
  });

  it('leaves a single one-letter fix untouched (it may be auto-applied)', () => {
    const c = flag('teh', ['the'], 'Typo');
    expect(improveSuggestions(c)).toBe(c);
  });

  it('leaves names, code tokens, fact-locked and non a-z words in the linter order', () => {
    const name = flag('Recods', ['Recons', 'Records']);
    expect(improveSuggestions(name)).toBe(name);
    const code = flag('recods', ['recons', 'records']);
    expect(improveSuggestions(code, 'see src/recods/x.ts')).toBe(code);
    expect(improveSuggestions(code, 'the recods here', [{ start: 0, end: 20 }])).toBe(code);
    const transliterated = flag('āyus', ["Ky's", "Ty's", 'anus']);
    expect(improveSuggestions(transliterated)).toBe(transliterated);
  });

  it('only rewrites spelling flags', () => {
    const grammar = flag('recods', ['recons', 'records'], 'Grammar');
    expect(improveSuggestions(grammar)).toBe(grammar);
  });
});

describe('tiers on adjusted suggestions', () => {
  const ctx: TierContext = { locked: new Map(), variantWords: new Set(), preset: PRESETS.blog };

  it('a list the engine added to or filtered is never auto-applied, even with one slip fix left', () => {
    const added = { ...flag('arived', ['arrived'], 'Typo'), linterReplacements: [] };
    expect(tierOf(added, ctx)).toBe('review');
    expect(tierOf(flag('arived', ['arrived'], 'Typo'), ctx)).toBe('safe');
  });
});
