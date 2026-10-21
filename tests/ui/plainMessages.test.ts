// Card explanations in plain words (Task A1 item 6): the Harper messages with grammar terms that the
// 22 reference documents produce, rewritten; anything else is shown as it is.
import { describe, it, expect } from 'vitest';
import { sentenceSpans } from '@/engine/sentences';
import { plainMessage } from '@/ui/state/plainMessages';

/** Grammar terms a reader may not know (verb and noun are left: they are widely known). */
const JARGON = /\b(adverb|adjective|preposition|pronoun|infinitive|article|mass noun|compound noun|phrasal|clause|participle|grammatical)s?\b/i;

/** [Harper's message, the flagged text, the plain rewrite]. */
const CASES: [string, string, string][] = [
  ['Did you mean the closed compound noun “heatwave”?', 'heat wave', 'Did you mean “heatwave”, as one word?'],
  ['`clay` is a mass noun.', 'clays', '“clay” is not usually counted, so it takes no plural and no “a”.'],
  ['The word `chilli` is a mass noun and should not be pluralized.', 'chillies', '“chilli” is not usually counted, so it takes no plural.'],
  ['Incorrect indefinite article.', 'a', 'Use “a” before a consonant sound and “an” before a vowel sound.'],
  ['Did you mean the definite article?', 'teh', 'Did you mean “the”?'],
  ['You may be missing a preposition here.', 'went', 'A small linking word such as “to”, “of” or “in” may be missing here.'],
  ['There are too many personal pronouns in sequence here.', 'I you', 'Too many words like “I”, “you” or “they” in a row here.'],
  ['The adverbs of frequency ‘usually’ and ‘monthly’ are either redundant or contradictory', 'usually monthly', '“usually” and “monthly” both say how often: keep one.'],
  ['The construction `one of the ...` should use a plural noun.', 'book', 'After “one of the”, use the plural (“one of the books”).'],
  ['Insert `to` to complete the infinitive (e.g., `need to talk`).', 'need talk', 'Add “to” here, as in “need to talk”.'],
  ['This word might be a phrasal verb rather than a compound noun.', 'checkout', 'If “checkout” is an action here, write it as two words.'],
  ['Use the infinitive marker `to` here instead of the adverb `too`, which indicates excess degree.', 'too', 'Use “to” here: “too” means “also” or “more than enough”.'],
  ['The form of the verb must agree in grammatical number with the pronoun.', 'walk', 'Make the verb match the word before it (“he walks”, “they walk”).'],
  ['Make the verb agree with its subject.', 'walk', 'Make the verb match its subject (“he walks”, “they walk”).'],
  [
    "Use the possessive pronoun `its` (without an apostrophe) to show ownership. The word `it's` (with an apostrophe) is a contraction of 'it is' or 'it has' and should not be used to indicate possession.",
    "it's",
    'Use “its” (no apostrophe) for ownership. “It’s” means “it is” or “it has”.',
  ],
  ['Drop the repeated verb form so only one instance of `be` remains.', 'be be', 'Remove the repeated “be”.'],
  ['You probably mean the adverb `every day` here.', 'everyday', 'You probably mean “every day” here.'],
];

describe('plainMessage', () => {
  it.each(CASES)('%s', (message, original, plain) => {
    expect(plainMessage({ message, original })).toBe(plain);
  });

  it('every rewrite is at most two sentences, with no grammar terms', () => {
    for (const [message, original] of CASES) {
      const plain = plainMessage({ message, original });
      expect(sentenceSpans(plain).length).toBeLessThanOrEqual(2);
      expect(plain).not.toMatch(JARGON);
    }
  });

  it('assumes nothing about the flagged word: no "(two words)", no fixed "set up" example', () => {
    const phrasal = plainMessage({ message: 'This word might be a phrasal verb rather than a compound noun.', original: 'login' });
    expect(phrasal).toContain('“login”');
    expect(phrasal).not.toContain('set up');
    expect(plainMessage({ message: 'You probably mean the adverb `anymore` here.', original: 'any more' })).not.toContain('two words');
  });

  it('other messages are shown as they are', () => {
    expect(plainMessage({ message: 'Did you mean “receive”?', original: 'recieve' })).toBe('Did you mean “receive”?');
    expect(plainMessage({ message: 'This sentence is 42 words long.', original: 'This' })).toBe('This sentence is 42 words long.');
  });
});
