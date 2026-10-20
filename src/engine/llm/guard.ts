import { findLockedSpans } from '../factLock';
import { sentenceSpans } from '../sentences';
import { FUNCTION_WORDS } from '../tiers';
import { wordsOf } from '../words';

export type GuardReason = 'not one sentence' | 'fact changed' | 'too long' | 'negation changed' | 'hedge added' | 'meaning drift';
export type GuardVerdict = { ok: boolean; reason?: GuardReason };

/** Negations: not, no, never, without, cannot, and n't ("didn't"). */
const NEGATION = /\b(?:not|no|never|without|cannot)\b|n['’]t\b/gi;
/**
 * Hedges a rewrite must not add (the Turnitout audit found a tool adding "broadly speaking" to
 * statistics). Counted one by one, so swapping "perhaps" for "likely" is an added hedge too.
 */
const HEDGES: RegExp[] = [
  ...['broadly', 'arguably', 'generally', 'somewhat', 'perhaps', 'likely', 'possibly', 'probably', 'approximately', 'roughly', 'may', 'might', 'could'].map(
    (w) => new RegExp(String.raw`\b${w}\b`, 'gi'),
  ),
  /\bit\s+seems\b/gi,
  /\b(?:seems?|appears?|tends?)\s+to\b/gi,
  /\bto\s+some\s+extent\b/gi,
  /\bmore\s+or\s+less\b/gi,
  // "around"/"about" only right before a number: "about 3.2%", "around ₹1,000" (not "walked around").
  /\b(?:around|about)\s+(?=[₹$€£¥]?\d)/gi,
];
/** A rewrite may be at most this many times the original's length (spec §5). */
const MAX_LENGTH_RATIO = 1.5;
/** Minimum share of content words kept. Lexical overlap stands in for the spec's semantic similarity (no embedding model). */
const MIN_OVERLAP = 0.6;

/** The fact-locked text of a sentence (numbers, dates, names, quotes, citations, URLs, code, LaTeX). */
export function lockedTokens(sentence: string): string[] {
  return findLockedSpans(sentence).map((s) => sentence.slice(s.start, s.end));
}

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/** Lowercased words that carry meaning (function words removed). */
function contentWords(text: string): Set<string> {
  return new Set(wordsOf(text.toLowerCase().replace(/’/g, "'")).filter((w) => !FUNCTION_WORDS.has(w)));
}

/** Shared content words over the larger set: a rewrite that drops or adds many words scores low. */
function overlap(original: string, rewrite: string): number {
  const a = contentWords(original);
  const b = contentWords(rewrite);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
}

/**
 * The meaning-drift guard (spec §5): may an LLM rewrite of `original` be offered at all?
 * `locked` is the original's fact-locked text (see lockedTokens); the rewrite must hold exactly the
 * same locked text (no token lost, added or duplicated), with the numbers in the same order.
 * Known limit: antonym swaps ("rose" → "fell") and swapping a sentence-initial name pass the
 * lexical checks; the review tier and the before/after diff are the backstop.
 */
export function passesGuard(original: string, rewrite: string, locked: string[]): GuardVerdict {
  const fail = (reason: GuardReason) => ({ ok: false, reason });
  if (sentenceSpans(rewrite).length !== 1) return fail('not one sentence');
  if (!sameFacts(locked, lockedTokens(rewrite))) return fail('fact changed');
  if (rewrite.length > MAX_LENGTH_RATIO * original.length) return fail('too long');
  if (count(rewrite, NEGATION) !== count(original, NEGATION)) return fail('negation changed');
  if (HEDGES.some((h) => count(rewrite, h) > count(original, h))) return fail('hedge added');
  if (overlap(original, rewrite) < MIN_OVERLAP) return fail('meaning drift');
  return { ok: true };
}

/**
 * Same locked tokens, each as many times ("40 and 40" is not "40"), and the numbers in the same
 * order ("from 10 to 20" is not "from 20 to 10").
 */
function sameFacts(before: string[], after: string[]): boolean {
  const sorted = (xs: string[]) => [...xs].sort().join('\u0000');
  if (sorted(before) !== sorted(after)) return false;
  const numbers = (xs: string[]) => xs.filter((t) => /\d/.test(t)).join('\u0000');
  return numbers(before) === numbers(after);
}
