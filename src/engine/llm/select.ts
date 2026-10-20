import type { CheckSession, Edit } from '../session';
import { overlaps } from '../sessionTypes';
import { sentenceSpans } from '../sentences';
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

/** Sentences to rewrite per document: 3 per 1,500 words, at least 1 (Claude's call). */
export function rewriteBudget(words: number): number {
  return Math.max(1, Math.round((3 * words) / 1500));
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

/** The sentence with the accepted edits inside it applied; null when one straddles its edge (a rewrite would undo half of it). */
function withAcceptedEdits(original: string, span: Span, edits: Edit[]): string | null {
  let text = original;
  // Right to left, so earlier offsets stay valid.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i].span;
    const inside = e.start >= span.start && e.end <= span.end;
    if (!inside && overlaps(e, span)) return null;
    if (!inside) continue;
    text = text.slice(0, e.start - span.start) + edits[i].replacement + text.slice(e.end - span.start);
  }
  return text;
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
      const text = withAcceptedEdits(original, span, paraEdits);
      if (text !== null) scored.push({ score, sentence: { paraId: p.id, span, text } });
    }
  }
  // Array.prototype.sort is stable: equal scores keep document order.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)
    .map((s) => s.sentence);
}
