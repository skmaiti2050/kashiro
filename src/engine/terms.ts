import type { Candidate } from './types';
import { COMMON_WORDS } from './wordlists/common';
import { UPPER_START, WORD_REWRITE_KINDS, withinOneEdit } from './wordFlags';

/** Spec §5 terms card: an unknown lowercase word used this many times is treated as an intended term. */
export const DEFAULT_TERM_MIN_REPEATS = 3;
const MIN_REPEATS_LOWEST = 2;
const MIN_REPEATS_HIGHEST = 5;

/** A lowercase-initial word of letters, digits, hyphens and apostrophes: "sarpanch", "hba1c", "gram-sabha". */
const TERM_SHAPE = /^\p{Ll}[\p{L}\p{N}'’-]*$/u;
const LETTER = /\p{L}/gu;
/** A part that is only digits, e.g. "123" in "abc-123". */
const DIGITS_ONLY = /^\p{N}+$/u;

/** Throws when `n` is not a whole number from 2 to 5 (the settings range). */
export function checkTermMinRepeats(n: number): void {
  if (!Number.isInteger(n) || n < MIN_REPEATS_LOWEST || n > MIN_REPEATS_HIGHEST) {
    throw new Error(`termMinRepeats must be a whole number from ${MIN_REPEATS_LOWEST} to ${MIN_REPEATS_HIGHEST} (got ${n})`);
  }
}

function isTermShaped(word: string): boolean {
  if (!TERM_SHAPE.test(word) || (word.match(LETTER) ?? []).length < 3) return false;
  return !word.split(/[-'’]/).some((part) => DIGITS_ONLY.test(part));
}

const COMMON_WORD_LIST = [...COMMON_WORDS];
/** Memo for isSlipOfCommonWord: decisions are rebuilt on every UI render. */
const slipMemo = new Map<string, boolean>();

/** True when `word` (lowercased) is a common word or one edit from one: "teh" → "the", "recieve" → "receive". */
function isSlipOfCommonWord(word: string): boolean {
  let slip = slipMemo.get(word);
  if (slip === undefined) {
    slip = COMMON_WORD_LIST.some((common) => Math.abs(common.length - word.length) <= 1 && withinOneEdit(word, common));
    slipMemo.set(word, slip);
  }
  return slip;
}

/** Whole-word uses of `word` in the document, any case ("sarpanch" in "Sarpanch's", not in "sarpanches"). */
function countUses(word: string, paraText: ReadonlyMap<number, string>): number {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The whole word, e.g. "dosha" in "a dosha." but not in "doshas".
  const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
  let n = 0;
  for (const text of paraText.values()) n += [...text.matchAll(wholeWord)].length;
  return n;
}

/** A Spelling/Typo flag on a lowercase-initial word, the only kind of flag a term can come from. */
export function isLowercaseWordFlag(c: Candidate): boolean {
  return WORD_REWRITE_KINDS.has(c.kind) && !UPPER_START.test(c.original);
}

/**
 * The terms among `flags` (review-tier flags), as lowercased word → uses in the document (spec §5):
 * a lowercase-initial word of 3+ letters, with no digits-only part, used at least `minRepeats` times in
 * the text (unflagged uses count too), and not a common word or one edit from one, so a repeated slip
 * ("teh" ×3) is never a term. Words in `typoWords` (the user said they are typos) are left out.
 */
export function findTerms(
  flags: Candidate[],
  paraText: ReadonlyMap<number, string>,
  minRepeats: number,
  typoWords: ReadonlySet<string>,
): Map<string, number> {
  const terms = new Map<string, number>();
  const seen = new Set<string>();
  for (const c of flags) {
    const word = c.original.toLowerCase();
    if (seen.has(word) || !isLowercaseWordFlag(c)) continue;
    seen.add(word);
    if (typoWords.has(word) || !isTermShaped(c.original) || isSlipOfCommonWord(word)) continue;
    const uses = countUses(word, paraText);
    if (uses >= minRepeats) terms.set(word, uses);
  }
  return terms;
}
