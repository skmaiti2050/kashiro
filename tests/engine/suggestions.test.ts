import { describe, it, expect } from 'vitest';
import type { Candidate } from '@/engine/types';
import { improveSuggestions } from '@/engine/suggestions/improve';
import { nearbyWords, wordsByFrequency, zipfOf } from '@/engine/suggestions/frequency';
import { isOffensive, writtenOnPurpose } from '@/engine/suggestions/offensive';
import { CheckSession } from '@/engine/session';
import type { RulesLinter } from '@/engine/linter';
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

  it('rounds frequencies to 0.1 and knows only single words', () => {
    expect(zipfOf('occurrence')).toBe(3.8);
    expect(zipfOf('kappa')).toBe(3.5);
    expect(zipfOf('dosh')).toBe(2.3);
    expect(zipfOf('a dress')).toBe(0);
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
  it('blocks profanity anywhere in a suggestion, compounds included', () => {
    for (const w of ['Shit', "Shit's", 'bull shit', 'bullshit', 'horseshit', 'Dipshit', 'Dipshits', 'shithead', 'motherfucker']) {
      expect(isOffensive(w)).toBe(true);
    }
    expect(isOffensive('Mishit')).toBe(true); // accepted casualty
  });

  it('blocks other offensive words as whole words only', () => {
    for (const w of ['Dick', "Dick's", 'Dicks', 'dumbass', 'jackass', 'cunt', 'nigger', 'Nazi', 'pornographic']) {
      expect(isOffensive(w)).toBe(true);
    }
    for (const w of ['suit', 'Dickens', 'cocktail', 'class', 'Scunthorpe', 'niggle', 'snigger', 'swanky']) {
      expect(isOffensive(w)).toBe(false);
    }
  });

  it('a profane original is meant only when it is one edit from a profane word ("shitt", "fuckin")', () => {
    expect(writtenOnPurpose('shitt')).toBe(true);
    expect(writtenOnPurpose('fuckin')).toBe(true);
    for (const w of ['Shital', 'Shitij', 'Dikshit', 'Dickns', 'Sujit']) expect(writtenOnPurpose(w)).toBe(false);
  });
});

describe('improveSuggestions (spec §5 better suggestions)', () => {
  it('never suggests an offensive word for an ordinary one: Sujit → Shit is impossible', () => {
    expect(improveSuggestions(flag('Sujit', ['Suit', 'Suji', 'Shit'])).replacements).toEqual(['Suit', 'Suji']);
    expect(improveSuggestions(flag('sujit', ['suit', 'shit', 'sit'])).replacements).not.toContain('shit');
  });

  it('filters names that start with or hold a profane word (real Harper lists)', () => {
    expect(improveSuggestions(flag('Shital', ["Shit's", 'Shit', 'Shoal'])).replacements).toEqual(['Shoal']);
    expect(improveSuggestions(flag('Shitij', ["Shit's", 'Shit', 'Shiite'])).replacements).toEqual(['Shiite']);
    expect(improveSuggestions(flag('Dikshit', ['Dipshit', 'Dipshits', 'Mishit'])).replacements).toEqual([]);
    expect(improveSuggestions(flag('Dickns', ["Dick's", 'Dickens', 'Dicks'])).replacements).toEqual(['Dickens']);
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

  it('end to end: when the linter offers ["shit", "suit"] for "siut", "suit" alone is left and goes to review', async () => {
    const text = 'A new siut.';
    const linter: RulesLinter = {
      variant: 'American',
      lintParagraphs: async () => [{ ...flag('siut', ['shit', 'suit'], 'Spelling', 6) }],
      lintSpelling: async () => [],
      addWords: async () => {},
      setVariant: async () => {},
    };
    const s = await CheckSession.start(
      [{ id: 0, text }],
      { preset: 'blog', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] },
      { linter },
    );
    const siut = s.candidates().find((c) => c.original === 'siut')!;
    expect(siut.replacements).toEqual(['suit']);
    expect(s.tier(siut.id)).toBe('review');
    expect(s.log().filter((e) => e.auto)).toEqual([]);
  });
});
