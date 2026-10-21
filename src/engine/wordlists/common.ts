import { wordsByFrequency } from '../suggestions/frequency';

/** How many of the most frequent words are taken before the filter below. */
const TOP = 5000;
/** Letters only, at least three: "the", "receive" (not "uk", "ri" or "don't"). */
const KEPT_WORD = /^\p{Ll}{3,}$/u;

/**
 * About 4,800 of the most frequent English words (the wordfreq list's top 5,000; see
 * resources/frequency/ATTRIBUTION.md), used only to tell a typing slip from an intended term (spec §5
 * terms card): a repeated unknown word one edit from one of these ("teh", "recieve") is a slip. One- and
 * two-letter tokens are left out: "ri" or "uk" would make every three-letter term look like a slip.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set(wordsByFrequency().slice(0, TOP).filter((w) => KEPT_WORD.test(w)));
