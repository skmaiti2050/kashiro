import type { Candidate } from './types';
import { isSentenceStart, OPENERS } from './factLock';

export const UPPER_START = /^\p{Lu}/u;
/** Kinds that rewrite a word into a dictionary word: on a capitalised original that is likely a name. */
export const WORD_REWRITE_KINDS = new Set(['Spelling', 'Typo']);
/** A capital then lowercase letters ("Teh", "Priya"; not "NPCI", "MEGHNA" or "A."). */
export const TITLE_CASE_WORD = /^\p{Lu}\p{Ll}+$/u;
const PLAIN_WORD = /^[\p{L}'’]+$/u;

/** Capitalised-word Spelling/Typo flags are almost always names (spec §5 names card). */
export function isNameFlag(c: Candidate): boolean {
  return WORD_REWRITE_KINDS.has(c.kind) && UPPER_START.test(c.original);
}

/** Damerau-Levenshtein (optimal string alignment) distance, case-insensitive, stopping early above 1. */
export function withinOneEdit(a: string, b: string): boolean {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 1;
}

/**
 * A dictionary fix is only safe when it is a plain slip of one letter inside one word (teh → the,
 * occured → occurred, dont → don't). Bigger jumps (panchayat → penchant) usually mean an unknown word,
 * not a typo, and joining or splitting words (borewell → bore well, up stairs → upstairs,
 * mid-day → midday) is a meaning or style choice: auto-applying them can change meaning.
 */
export function isSlipFix(c: Candidate): boolean {
  return isSlip(c.original, c.replacements[0]);
}

function isSlip(original: string, replacement: string): boolean {
  return PLAIN_WORD.test(original) && PLAIN_WORD.test(replacement) && withinOneEdit(original, replacement);
}

/**
 * True when `word` (exact case) appears somewhere in the document other than at a sentence start.
 * An opening bracket or quote is looked through: "spent (Joshi and Pawar, 2020)" is mid-sentence.
 */
function usedMidSentence(word: string, paraText: ReadonlyMap<number, string>): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The whole word, e.g. "Rao" in "met Rao." but not in "Raona".
  const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}'’])${escaped}(?![\\p{L}\\p{N}'’])`, 'gu');
  for (const text of paraText.values()) {
    for (const m of text.matchAll(wholeWord)) {
      let start = m.index!;
      while (start > 0 && OPENERS.test(text[start - 1])) start--;
      if (!isSentenceStart(text, start)) return true;
    }
  }
  return false;
}

/**
 * A capitalised flag that is probably a typo, not a name: it starts a sentence (so its capital says
 * nothing), it has a one-letter fix ("Teh" → "The"), and the document never capitalises it mid-sentence,
 * where a name would be capitalised too. A word in capitals ("NPCI", a speaker label "MEGHNA") is never
 * one: its capitals are not from the sentence start. Without paragraph text nothing counts as a likely typo.
 */
export function isLikelyTypo(c: Candidate, paraText: ReadonlyMap<number, string> | undefined): boolean {
  const text = paraText?.get(c.paraId);
  if (!paraText || text === undefined || !isNameFlag(c) || !TITLE_CASE_WORD.test(c.original)) return false;
  if (!isSentenceStart(text, c.span.start) || !c.replacements.some((r) => isSlip(c.original, r))) return false;
  return !usedMidSentence(c.original, paraText);
}
