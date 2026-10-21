import type { Candidate } from './types';
import { COMMON_WORDS } from './wordlists/common';
import { PLAIN_WORD, UPPER_START, WORD_REWRITE_KINDS, withinOneEdit, withinTwoEdits } from './wordFlags';

/** Spec §5 terms card: an unknown lowercase word used this many times is treated as an intended term. */
export const DEFAULT_TERM_MIN_REPEATS = 3;
const MIN_REPEATS_LOWEST = 2;
const MIN_REPEATS_HIGHEST = 5;

/** A lowercase-initial word of letters and digits: "sarpanch", "hba1c" (not "abc-123" or "Rao"). */
const TERM_SHAPE = /^\p{Ll}[\p{L}\p{N}]*$/u;
const LETTER = /\p{L}/gu;
/** One word token for counting uses: letters and digits ("dosha" in "dosha's" and in "(dosha)"). */
const WORD_TOKEN = /[\p{L}\p{N}]+/gu;
/** From this length a suggestion two edits away still marks a misspelling ("accomodate" → "accommodate"). */
const TWO_EDIT_LENGTH = 6;

/** Throws when `n` is not a whole number from 2 to 5 (the settings range). */
export function checkTermMinRepeats(n: number): void {
  if (!Number.isInteger(n) || n < MIN_REPEATS_LOWEST || n > MIN_REPEATS_HIGHEST) {
    throw new Error(`termMinRepeats must be a whole number from ${MIN_REPEATS_LOWEST} to ${MIN_REPEATS_HIGHEST} (got ${n})`);
  }
}

function isTermShaped(word: string): boolean {
  return TERM_SHAPE.test(word) && (word.match(LETTER) ?? []).length >= 3;
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

/**
 * True when one of the linter's own one-word suggestions is close to the flagged word: one edit, or two
 * for words of 6+ letters ("occurence" → "occurrence"). The linter's dictionary is far bigger than the
 * common-words list, so this catches misspellings of rarer words. Splits ("co infection") don't count:
 * joining two words is a style choice, not a sign of a typo.
 */
function hasCloseSuggestion(c: Candidate): boolean {
  const close = c.original.length >= TWO_EDIT_LENGTH ? withinTwoEdits : withinOneEdit;
  return c.replacements.some((r) => PLAIN_WORD.test(r) && close(c.original, r));
}

/** Uses of each word in the document, exact case, counted once per paraText map (one per session). */
const usesMemo = new WeakMap<ReadonlyMap<number, string>, Map<string, number>>();

function wordUses(paraText: ReadonlyMap<number, string>): Map<string, number> {
  let uses = usesMemo.get(paraText);
  if (!uses) {
    uses = new Map();
    for (const text of paraText.values()) {
      for (const [token] of text.matchAll(WORD_TOKEN)) uses.set(token, (uses.get(token) ?? 0) + 1);
    }
    usesMemo.set(paraText, uses);
  }
  return uses;
}

/**
 * The terms among `flags` (review-tier flags), as lowercase word → lowercase uses in the document
 * (spec §5): a lowercase word of 3+ letters and digits, written in lowercase at least `minRepeats`
 * times (unflagged uses count too), that is not a misspelling: not a common word or one edit from one
 * ("teh" ×3), and no flag of it has a close one-word suggestion ("occurence" ×3). Words in `typoWords`
 * (the user said they are typos) are left out. Capitalised uses ("Dosha" at a sentence start) don't count.
 */
export function findTerms(
  flags: Candidate[],
  paraText: ReadonlyMap<number, string>,
  minRepeats: number,
  typoWords: ReadonlySet<string>,
): Map<string, number> {
  const byWord = new Map<string, Candidate[]>();
  for (const c of flags) {
    if (!WORD_REWRITE_KINDS.has(c.kind)) continue;
    const word = c.original.toLowerCase();
    byWord.set(word, [...(byWord.get(word) ?? []), c]);
  }
  const uses = wordUses(paraText);
  const terms = new Map<string, number>();
  for (const [word, wordFlags] of byWord) {
    if (!wordFlags.some((c) => !UPPER_START.test(c.original))) continue; // only capitalised flags: names card
    const lowercaseUses = uses.get(word) ?? 0;
    if (lowercaseUses < minRepeats || typoWords.has(word) || !isTermShaped(word)) continue;
    if (wordFlags.some(hasCloseSuggestion) || isSlipOfCommonWord(word)) continue;
    terms.set(word, lowercaseUses);
  }
  return terms;
}
