import type { CheckSession } from '../session';
import { overlaps } from '../sessionTypes';
import { DEFAULT_DEPTH, rewriteCount, upFrontRoom, type ReviewDepth } from '../depth';
import { sentenceSpans, sentenceWithEdits } from '../sentences';
import { countWords } from '../words';
import { isNameFlag } from '../wordFlags';
import type { Candidate, Span } from '../types';

/** A sentence to send to the helper. `text` is the sentence with its accepted rule edits applied. */
export interface PickedSentence {
  paraId: number;
  span: Span;
  text: string;
}

/** Lint kinds that say a sentence reads awkwardly. */
const AWKWARD_KINDS = new Set(['Readability', 'Style', 'WordOrder']);
const LONG_SENTENCE_WORDS = 30;
/** Inline markup a rewrite could silently drop: Markdown emphasis, code, links, math, HTML, tables, escapes. */
const INLINE_MARKUP = /[*_`$[\]<>|\\]/;

/** Sentences to rewrite per document at this depth (rate per 1,500 words, at least 1; 0 when automatic is off). */
export function rewriteBudget(words: number, depth: ReviewDepth = DEFAULT_DEPTH): number {
  return rewriteCount(depth, words, false);
}

/**
 * Sentences for the automatic first run: rewriteBudget, but never more than the room left under the
 * depth's decision budget, so the helper cannot push a document over it (an explicit "check more" may).
 */
export function firstRunBudget(words: number, rankedDecisions: number, depth: ReviewDepth = DEFAULT_DEPTH): number {
  const room = upFrontRoom(depth, words) - rankedDecisions;
  return Math.max(0, Math.min(rewriteBudget(words, depth), room));
}

/**
 * Awkward lint +3, more than 30 words +2, two or more rules lints +1. Unknown names (capitalised
 * Spelling/Typo flags) do not count: a rewrite cannot help a sentence that only holds names.
 */
function scoreOf(sentence: string, lints: Candidate[]): number {
  const real = lints.filter((c) => !isNameFlag(c));
  let score = 0;
  if (real.some((c) => AWKWARD_KINDS.has(c.kind))) score += 3;
  if (countWords(sentence) > LONG_SENTENCE_WORDS) score += 2;
  if (real.length >= 2) score += 1;
  return score;
}

/**
 * Up to `budget` sentences most worth a rewrite, best first (ties in document order). Skipped:
 * sentences already sent to the helper, sentences with no reason to rewrite (score 0), and sentences
 * a whole-sentence replacement could damage (inline markup, an existing tracked change, an accepted
 * edit across the sentence edge).
 */
export function pickSentences(session: CheckSession, budget: number): PickedSentence[] {
  const edits = session.acceptedEdits();
  const lints = session.candidates().filter((c) => c.source === 'rules' && session.tier(c.id) !== 'hidden');
  const scored: { score: number; sentence: PickedSentence }[] = [];
  for (const p of session.paragraphs()) {
    const paraEdits = edits.filter((e) => e.paraId === p.id);
    const paraLints = lints.filter((c) => c.paraId === p.id);
    for (const span of sentenceSpans(p.text)) {
      if (session.sentToHelper(p.id, span) || p.locked?.some((l) => overlaps(l, span))) continue;
      const original = p.text.slice(span.start, span.end);
      if (INLINE_MARKUP.test(original)) continue;
      const score = scoreOf(original, paraLints.filter((c) => overlaps(c.span, span)));
      if (score === 0) continue;
      const text = sentenceWithEdits(p.text, span, paraEdits);
      if (text !== null) scored.push({ score, sentence: { paraId: p.id, span, text } });
    }
  }
  // Array.prototype.sort is stable: equal scores keep document order.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)
    .map((s) => s.sentence);
}
