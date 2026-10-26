/**
 * The vetted a/an table (Task F6): the only words before which the simple-fixes card ticks an article swap.
 * A word's article follows its first sound, so a vowel letter taking "a", or a consonant letter taking "an", must
 * be one of the words below, each checked by ear; a new one needs the same check before it joins this list.
 */
import { describe, it, expect } from 'vitest';
import { TAKES_A, TAKES_AN, VETTED_ARTICLES } from '@/engine/wordlists/articles';

/** Vowel letters said with a "you" or "w" sound: "a union", "a one-off". */
const VOWEL_LETTER_TAKES_A = [
  'european', 'euro', 'eulogy', 'one', 'once', 'union', 'unique', 'unit', 'united', 'uniform', 'universe', 'universal',
  'university', 'unanimous', 'unicorn', 'usage', 'useful', 'useless', 'user', 'usual', 'utensil', 'utility',
];
/** A silent "h": "an hour". */
const CONSONANT_LETTER_TAKES_AN = ['heir', 'heiress', 'honest', 'honor', 'honorable', 'honorary', 'honour', 'honourable', 'hour', 'hourly'];
const VOWEL_LETTER = /^[aeiou]/;

describe('the vetted a/an table', () => {
  it.each([
    ['apple', 'an'], ['book', 'a'], ['elephant', 'an'], ['idea', 'an'], ['hour', 'an'], ['honest', 'an'], ['honourable', 'an'],
    ['heir', 'an'], ['union', 'a'], ['unique', 'a'], ['useful', 'a'], ['university', 'a'], ['european', 'a'], ['one', 'a'],
    ['once', 'a'], ['umbrella', 'an'], ['uncle', 'an'], ['understanding', 'an'], ['house', 'a'], ['huge', 'a'],
    ['unidentified', 'an'], ['utmost', 'an'], ['urchin', 'an'], ['online', 'an'], ['only', 'an'], ['year', 'a'],
  ])('"%s" takes "%s"', (word, article) => {
    expect(VETTED_ARTICLES.get(word)).toBe(article);
  });

  it.each([
    // Said two ways, or a style choice ("an historic"): never ticked.
    'herb', 'historic', 'historical', 'hotel', 'homage', 'humble', 'onerous', 'ewe', 'ewer', 'unidentifiable', 'urticaria',
    // Abbreviations and initialisms, read letter by letter.
    'usb', 'mla', 'fir', 'hr', 'lpg', 'sms', 'nri', 'upsc', 'mba', 'ufo',
  ])('leaves out "%s"', (word) => {
    expect(VETTED_ARTICLES.has(word)).toBe(false);
  });

  it.each([
    // Also a verb right after a subject: after a one-letter variable the verb is meant ("Why does a equal b?",
    // "Will a increase?"), so "a" → "an" must not start ticked (F6 re-review 5, I-2).
    'honor', 'honour', 'umpire', 'update', 'upgrade', 'upset', 'usher', 'utter',
    'abstract', 'access', 'account', 'act', 'action', 'address', 'aim', 'alarm', 'alert', 'amount', 'angle', 'answer',
    'approach', 'architect', 'arm', 'attack', 'attempt', 'audit', 'audition', 'author', 'average', 'award', 'axe',
    'echo', 'edge', 'effect', 'egg', 'elbow', 'email', 'empty', 'end', 'engineer', 'equal', 'error', 'escape', 'estimate',
    'excuse', 'exercise', 'exit', 'eye',
    'image', 'impact', 'inch', 'increase', 'index', 'influence', 'initial', 'ink', 'institute', 'insult', 'interest',
    'interview', 'iron', 'issue',
    'object', 'offer', 'oil', 'open', 'order', 'outline',
  ])('leaves out the verb "%s"', (word) => {
    expect(VETTED_ARTICLES.has(word)).toBe(false);
  });

  it('holds about 300 lowercase words, each once, in the list its first letter suggests unless checked by ear', () => {
    const all = [...TAKES_A, ...TAKES_AN];
    expect(all.length).toBeGreaterThanOrEqual(300);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((w) => !/^[a-z]+$/.test(w))).toEqual([]);
    expect(TAKES_A.filter((w) => VOWEL_LETTER.test(w) && !VOWEL_LETTER_TAKES_A.includes(w))).toEqual([]);
    expect(TAKES_AN.filter((w) => !VOWEL_LETTER.test(w) && !CONSONANT_LETTER_TAKES_AN.includes(w))).toEqual([]);
  });
});
