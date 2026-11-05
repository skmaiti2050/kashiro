import type { CheckSession } from '../session';
import { overlaps, type Edit } from '../sessionTypes';
import { DEFAULT_DEPTH, rewriteCount, upFrontRoom, type ReviewDepth } from '../depth';
import { sentenceSpans, sentenceWithEdits } from '../sentences';
import { countWords } from '../words';
import { isNameFlag } from '../wordFlags';
import type { Candidate, Paragraph, Span } from '../types';

/** A sentence to send to the helper. `text` is the sentence with its accepted rule edits applied. */
export interface PickedSentence {
  paraId: number;
  span: Span;
  text: string;
}

/**
 * True when the helper may read this part of a paragraph: English the proofreader checked. A set-aside or Hindi
 * paragraph, or a sentence holding an unchecked passage (other-script words, a reported foreign sentence), is out.
 * The 'en' id test is temporary: the engine-capabilities redesign replaces it.
 */
export function helperReads(session: CheckSession, paraId: number, span: Span): boolean {
  if (session.engineOf(paraId)?.id !== 'en') return false;
  return !session.uncheckedPassages().some((u) => u.paraId === paraId && overlaps(u.span, span));
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
      if (session.sentToHelper(p.id, span) || !helperReads(session, p.id, span)) continue;
      const score = scoreOf(p.text.slice(span.start, span.end), paraLints.filter((c) => overlaps(c.span, span)));
      if (score === 0) continue;
      const text = safeToRewrite(p, span, paraEdits);
      if (text !== null) scored.push({ score, sentence: { paraId: p.id, span, text } });
    }
  }
  // Array.prototype.sort is stable: equal scores keep document order.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)
    .map((s) => s.sentence);
}

/**
 * "Improve this sentence": the sentence of paragraph `paraId` at `offset` (a caret at a sentence's end, or in the
 * space after it, means that sentence), with its accepted edits applied. Null when there is none, or when a
 * whole-sentence replacement could damage it (as pickSentences skips). Sentences already sent are not skipped,
 * and neither are ones the helper must not read: callers check `helperReads`.
 */
export function sentenceAt(session: CheckSession, paraId: number, offset: number): PickedSentence | null {
  const p = session.paragraphs().find((x) => x.id === paraId);
  const span = p && spanAt(p, offset);
  if (!p || !span) return null;
  const text = safeToRewrite(p, span, session.acceptedEdits().filter((e) => e.paraId === paraId));
  return text === null ? null : { paraId, span, text };
}

/** The span of the sentence sentenceAt takes, even one it would refuse: so the caller can say why it was refused. */
export function sentenceSpanAt(session: CheckSession, paraId: number, offset: number): Span | null {
  const p = session.paragraphs().find((x) => x.id === paraId);
  return p ? spanAt(p, offset) : null;
}

/** The last sentence that starts at or before `offset` (the first one when the caret is before them all). */
function spanAt(p: Paragraph, offset: number): Span | null {
  const spans = sentenceSpans(p.text);
  let span = spans[0];
  if (!span) return null;
  for (const s of spans) if (s.start <= offset) span = s;
  return span;
}

/**
 * The sentence's text to send (its edits applied), or null when a whole-sentence replacement could damage it:
 * inline markup, an existing tracked change, or an accepted edit across the sentence edge.
 */
function safeToRewrite(p: Paragraph, span: Span, paraEdits: Edit[]): string | null {
  if (p.locked?.some((l) => overlaps(l, span)) || INLINE_MARKUP.test(p.text.slice(span.start, span.end))) return null;
  return sentenceWithEdits(p.text, span, paraEdits);
}
