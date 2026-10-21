import type { Candidate, Span } from '../types';
import { overlapsLocked } from '../factLock';
import { editDistance, isCodeNoiseFlag, PLAIN_WORD, TWO_EDIT_LENGTH, WORD_REWRITE_KINDS, withinOneEdit } from '../wordFlags';
import { nearbyWords, zipfOf } from './frequency';
import { isOffensive, writtenOnPurpose } from './offensive';

/** Words the engine adds to one flag at most. */
const MAX_ADDED = 3;
/** A one-edit word the linter missed is added only when it is this much more frequent (Zipf) than its best ("litle": "little" 5.8 vs "lite" 3.5). */
const MISSED_WORD_MARGIN = 1.0;
/** Zipf for a suggestion not in the frequency list: rarer than its rarest word (1.9). */
const UNKNOWN_ZIPF = 1.5;

// Likelihood weights, tuned on the reference corpus' planted errors (task S6 report).
const EDIT_WEIGHT = 2.0;
const ZIPF_WEIGHT = 0.5;
const NEIGHBOUR_KEY_BONUS = 0.5;
const FIRST_LETTER_BONUS = 0.5;
const SAME_LENGTH_BONUS = 0.5;

/**
 * Lowercase a-z and apostrophes only: "recieve", "dont" (not "Rao", "co-op", "q2" or "āyus": the frequency
 * list is a-z, so it can't judge a transliterated word, and Harper's order is kept).
 */
const PLAIN_LOWERCASE_WORD = /^[a-z'’]+$/;
/** The parts of a split or hyphenated suggestion: "a rived" → "a", "rived". */
const SUGGESTION_PART = /[^\s-]+/gu;

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
/** Pairs of neighbouring keys, both ways: "qw", "wq", "qa", "aq"… (a row's key i touches keys i and i+1 above it). */
const NEIGHBOUR_KEYS: ReadonlySet<string> = (() => {
  const pairs = new Set<string>();
  const add = (a: string | undefined, b: string | undefined) => {
    if (a && b) pairs.add(a + b).add(b + a);
  };
  QWERTY_ROWS.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      add(row[i], row[i + 1]);
      if (r > 0) {
        add(row[i], QWERTY_ROWS[r - 1][i]);
        add(row[i], QWERTY_ROWS[r - 1][i + 1]);
      }
    }
  });
  return pairs;
})();

/**
 * Better spelling suggestions (spec §5): drops offensive words, then for a lowercase Spelling/Typo flag
 * that is not a name, a code token or fact-locked, adds likely words the linter missed and ranks the
 * list by likelihood (see `likelihood`). A single one-letter fix is left as it is: it may be auto-applied.
 * A flag whose list gained or lost words keeps the linter's list in `linterReplacements`.
 * `paraText` is the flag's paragraph and `locked` its fact-locked spans.
 */
export function improveSuggestions(c: Candidate, paraText?: string, locked?: Span[]): Candidate {
  const allowed = writtenOnPurpose(c.original) ? c.replacements : c.replacements.filter((r) => !isOffensive(r));
  if (!canImprove(c, paraText, locked)) return withReplacements(c, allowed);
  return withReplacements(c, improvedList(c.original, allowed));
}

/** Memo for improvedList: a word repeats in a document ("coinfection" ×20) and each 2-edit search costs a few ms. */
const listMemo = new Map<string, string[]>();
const MEMO_LIMIT = 10_000;

function improvedList(original: string, allowed: string[]): string[] {
  const key = [original, ...allowed].join('\n');
  let list = listMemo.get(key);
  if (!list) {
    list = rankByLikelihood(original, [...allowed, ...missedWords(original, allowed)]);
    if (listMemo.size >= MEMO_LIMIT) listMemo.clear();
    listMemo.set(key, list);
  }
  return list;
}

function canImprove(c: Candidate, paraText: string | undefined, locked: Span[] | undefined): boolean {
  if (!WORD_REWRITE_KINDS.has(c.kind) || !PLAIN_LOWERCASE_WORD.test(c.original)) return false;
  return !overlapsLocked(c, locked) && !isCodeNoiseFlag(c, paraText);
}

function isSlip(original: string, replacement: string): boolean {
  return PLAIN_WORD.test(replacement) && withinOneEdit(original, replacement);
}

/**
 * Common words the linter did not offer: up to 3 within one edit (two for 6+ letters) when none of its
 * suggestions is a one-edit word ("arived" → only "a rived"), or a far more frequent one-edit word when
 * it offered several rare ones ("litle" → "lithe", "lisle", "lite"). Never for a single one-edit fix.
 */
function missedWords(original: string, offered: string[]): string[] {
  const known = new Set(offered.map((r) => r.toLowerCase()));
  const fresh = (word: string) => !known.has(word) && !isOffensive(word);
  if (!offered.some((r) => isSlip(original, r))) {
    const maxEdits = original.length >= TWO_EDIT_LENGTH ? 2 : 1;
    const near = nearbyWords(original, maxEdits).map((n) => n.word).filter(fresh);
    return rankByLikelihood(original, near).slice(0, MAX_ADDED);
  }
  if (offered.length < 2) return [];
  const bestOffered = Math.max(...offered.map(suggestionZipf));
  return nearbyWords(original, 1)
    .filter((n) => n.zipf >= bestOffered + MISSED_WORD_MARGIN && fresh(n.word))
    .slice(0, MAX_ADDED)
    .map((n) => n.word);
}

/** Most likely first; equal scores keep their order (the linter's). */
function rankByLikelihood(original: string, suggestions: string[]): string[] {
  return suggestions
    .map((word, i) => ({ word, i, score: likelihood(original, word) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.word);
}

/**
 * How likely `suggestion` is the intended word: fewer edits (a swap counts as one), a more frequent
 * word, a slip onto a neighbouring key, the same first letter and the same length all make it likelier.
 */
function likelihood(original: string, suggestion: string): number {
  const o = original.toLowerCase();
  const s = suggestion.toLowerCase();
  const distance = editDistance(o, s);
  let score = -EDIT_WEIGHT * distance + ZIPF_WEIGHT * suggestionZipf(s);
  if (distance === 1 && isNeighbourKeySlip(o, s)) score += NEIGHBOUR_KEY_BONUS;
  if (o[0] === s[0]) score += FIRST_LETTER_BONUS;
  if (o.length === s.length) score += SAME_LENGTH_BONUS;
  return score;
}

/** Zipf of a suggestion; a split ("a rived") is as rare as its rarest part. */
function suggestionZipf(suggestion: string): number {
  const parts = suggestion.match(SUGGESTION_PART) ?? [];
  if (parts.length === 0) return UNKNOWN_ZIPF;
  return Math.min(...parts.map((p) => zipfOf(p) || UNKNOWN_ZIPF));
}

/** One letter replaced by its neighbour on a QWERTY keyboard: "tge" / "the". */
function isNeighbourKeySlip(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const differ = [...a].flatMap((ch, i) => (ch === b[i] ? [] : [ch + b[i]]));
  return differ.length === 1 && NEIGHBOUR_KEYS.has(differ[0]);
}

/** The flag with `replacements`; the same object when nothing changed. */
function withReplacements(c: Candidate, replacements: string[]): Candidate {
  if (replacements.length === c.replacements.length && replacements.every((r, i) => r === c.replacements[i])) return c;
  const sameWords = replacements.length === c.replacements.length && replacements.every((r) => c.replacements.includes(r));
  return sameWords ? { ...c, replacements } : { ...c, replacements, linterReplacements: c.replacements };
}
