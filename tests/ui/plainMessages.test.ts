// Card explanations in plain words (Task A1 item 6): the Harper messages with grammar terms that the
// 22 reference documents produce, rewritten; anything else is shown as it is.
import { describe, it, expect } from 'vitest';
import { sentenceSpans } from '@/engine/sentences';
import { plainMessage } from '@/ui/state/plainMessages';

/** Grammar terms a reader may not know (verb and noun are left: they are widely known). */
const JARGON = /\b(adverb|adjective|preposition|pronoun|infinitive|article|mass noun|compound noun|phrasal|clause|participle|grammatical)s?\b/i;

const CASES: [string, string][] = [
  ['Did you mean the closed compound noun “heatwave”?', 'Did you mean “heatwave”, as one word?'],
  ['`clay` is a mass noun.', '“clay” is not usually counted, so it takes no plural and no “a”.'],
  ['The word `chilli` is a mass noun and should not be pluralized.', '“chilli” is not usually counted, so it takes no plural.'],
  ['Incorrect indefinite article.', 'Use “a” before a consonant sound and “an” before a vowel sound.'],
  ['Did you mean the definite article?', 'Did you mean “the”?'],
  ['You may be missing a preposition here.', 'A small linking word such as “to”, “of” or “in” may be missing here.'],
  ['There are too many personal pronouns in sequence here.', 'Too many words like “I”, “you” or “they” in a row here.'],
  ['The adverbs of frequency ‘usually’ and ‘monthly’ are either redundant or contradictory', '“usually” and “monthly” both say how often: keep one.'],
  ['The construction `one of the ...` should use a plural noun.', 'After “one of the”, use the plural (“one of the books”).'],
  ['Insert `to` to complete the infinitive (e.g., `need to talk`).', 'Add “to” here, as in “need to talk”.'],
  ['This word might be a phrasal verb rather than a compound noun.', 'If this is an action, write it as two words (“set up”, not “setup”).'],
  ['Use the infinitive marker `to` here instead of the adverb `too`, which indicates excess degree.', 'Use “to” here: “too” means “also” or “more than enough”.'],
  ['The form of the verb must agree in grammatical number with the pronoun.', 'Make the verb match the word before it (“he walks”, “they walk”).'],
  ['Make the verb agree with its subject.', 'Make the verb match its subject (“he walks”, “they walk”).'],
  [
    "Use the possessive pronoun `its` (without an apostrophe) to show ownership. The word `it's` (with an apostrophe) is a contraction of 'it is' or 'it has' and should not be used to indicate possession.",
    'Use “its” (no apostrophe) for ownership. “It’s” means “it is” or “it has”.',
  ],
  ['Drop the repeated verb form so only one instance of `be` remains.', 'Remove the repeated “be”.'],
  ['You probably mean the adverb `every day` here.', 'You probably mean “every day” (two words) here.'],
];

describe('plainMessage', () => {
  it.each(CASES)('%s', (message, plain) => {
    expect(plainMessage(message)).toBe(plain);
  });

  it('every rewrite is at most two sentences, with no grammar terms', () => {
    for (const [message] of CASES) {
      const plain = plainMessage(message);
      expect(sentenceSpans(plain).length).toBeLessThanOrEqual(2);
      expect(plain).not.toMatch(JARGON);
    }
  });

  it('other messages are shown as they are', () => {
    expect(plainMessage('Did you mean “receive”?')).toBe('Did you mean “receive”?');
    expect(plainMessage('This sentence is 42 words long.')).toBe('This sentence is 42 words long.');
  });
});
