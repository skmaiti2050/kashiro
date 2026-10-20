import { findLockedSpans } from '../factLock';
import { sentenceSpans } from '../sentences';
import { FUNCTION_WORDS } from '../tiers';
import { wordsOf } from '../words';

export type GuardReason = 'not one sentence' | 'fact changed' | 'too long' | 'negation changed' | 'hedge added' | 'meaning drift';

/** Negations: not, no, never, without, cannot, and n't ("didn't"). */
const NEGATION = /\b(?:not|no|never|without|cannot)\b|n['’]t\b/gi;
/** Hedges a rewrite must not add (the Turnitout audit found a tool adding "broadly speaking" to statistics). */
const HEDGE = /\b(?:broadly|arguably|generally|somewhat|perhaps|it\s+seems|to\s+some\s+extent)\b/gi;
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
 * `locked` is the original's fact-locked text (see lockedTokens); every token must survive verbatim,
 * and the rewrite may not bring in locked text (a number, name, quote) the original lacks.
 */
export function passesGuard(original: string, rewrite: string, locked: string[]): { ok: boolean; reason?: GuardReason } {
  const fail = (reason: GuardReason) => ({ ok: false, reason });
  if (sentenceSpans(rewrite).length !== 1) return fail('not one sentence');
  if (locked.some((t) => !rewrite.includes(t))) return fail('fact changed');
  if (lockedTokens(rewrite).some((t) => !original.includes(t))) return fail('fact changed');
  if (rewrite.length > MAX_LENGTH_RATIO * original.length) return fail('too long');
  if (count(rewrite, NEGATION) !== count(original, NEGATION)) return fail('negation changed');
  if (count(rewrite, HEDGE) > count(original, HEDGE)) return fail('hedge added');
  if (overlap(original, rewrite) < MIN_OVERLAP) return fail('meaning drift');
  return { ok: true };
}
