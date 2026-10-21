import type { Candidate } from './types';
import { isRomanisedIndic } from './romanised/classifier';
import { WORD_REWRITE_KINDS } from './wordFlags';

/** A word written all in lowercase a-z: "chalo" (not "Chalo", "chalo's" or "चलो"). */
const LOWERCASE_WORD = /^[a-z]+$/;

/**
 * The words among `flags` (review-tier flags) that are romanised Hindi or Bengali (spec §5 words in other
 * languages), lowercased. Only a word the document writes in lowercase somewhere counts: a capitalised word
 * alone is more likely a name ("Venkatraman"). Words in `typoWords` (the user said they are typos) and
 * `exclude` (already on the terms card) are left out.
 */
export function findOtherLanguageWords(
  flags: Candidate[],
  typoWords: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
): Set<string> {
  const words = new Set<string>();
  for (const c of flags) {
    if (!WORD_REWRITE_KINDS.has(c.kind) || !LOWERCASE_WORD.test(c.original)) continue;
    if (typoWords.has(c.original) || exclude.has(c.original)) continue;
    if (isRomanisedIndic(c.original)) words.add(c.original);
  }
  return words;
}
