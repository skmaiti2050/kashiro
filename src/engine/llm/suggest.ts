import type { CheckSession } from '../session';
import type { PresetId } from '../presets';
import { countWords } from '../words';
import type { GuardReason } from './guard';
import { rewriteCount, upFrontRoom } from '../depth';
import { firstRunBudget, pickSentences, type PickedSentence } from './select';
import type { LlmClient } from './client';

/** What suggestRewrites needs from the helper: LlmClient, or recorded answers in tests. */
export type Rewriter = Pick<LlmClient, 'rewrite'>;

export interface RewriteRun {
  /** Sentences the helper answered. */
  sent: number;
  /** Rewrites that passed the guard and are now pending review. */
  added: number;
  /** Rewrites dropped because they only changed punctuation or spaces (not worth a decision). */
  punctuationOnly: number;
  /** Rewrites the guard stopped, for the change log. */
  rejected: { text: string; rewrite: string; reason: GuardReason }[];
  /** Answers dropped because their sentence changed while the helper worked (the sentence can be asked again). */
  stale: number;
  /** True when `signal` aborted: the results that already came back are kept. */
  cancelled: boolean;
}

/**
 * One word, with apostrophes, hyphens or dots inside it ("it's", "well-known", "3.2") and combining marks
 * (the vowel sign in Devanagari "कि"): changing one is a real edit.
 */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['.\-][\p{L}\p{M}\p{N}]+)*/gu;
/** A typographic apostrophe: "dog’s" is the same word as "dog's". */
const CURLY_APOSTROPHE = /’/g;

/**
 * True when `rewrite` has exactly the words of `original`, in order and case: only punctuation or spaces
 * changed ("lights and" → "lights, and"). Such a rewrite is noise, so it is never offered.
 */
export function onlyPunctuationChanged(original: string, rewrite: string): boolean {
  const words = (text: string) => (text.replace(CURLY_APOSTROPHE, "'").match(WORD) ?? []).join(' ');
  return words(original) === words(rewrite);
}

/**
 * "Check how it reads" (and "Check more sentences"): sends the next budgeted sentences, one at a time, with
 * the document's English variant, and offers each rewrite that changes a word and passes the meaning-drift
 * guard as a review-tier decision. Never applies anything. A cancel ends the run quietly; any other helper
 * error is thrown.
 * The automatic first run stays within the decision budget (firstRunBudget); `more: true` is the
 * user's explicit "Check more sentences" and gets the full rewriteBudget even when that exceeds it.
 */
export async function suggestRewrites(
  session: CheckSession,
  helper: Rewriter,
  preset: PresetId,
  signal: AbortSignal,
  { more = false }: { more?: boolean } = {},
): Promise<RewriteRun> {
  const budget = runBudget(session, more);
  const run: RewriteRun = { sent: 0, added: 0, punctuationOnly: 0, rejected: [], stale: 0, cancelled: false };
  for (const s of pickSentences(session, budget)) {
    if (signal.aborted) break;
    let rewrite: string | null;
    try {
      rewrite = await helper.rewrite(s.text, preset, session.variant, signal);
    } catch (e) {
      if (signal.aborted) break;
      throw e;
    }
    run.sent++;
    const offer = offerRewrite(session, s, rewrite);
    if (offer === 'added') run.added++;
    else if (offer === 'punctuationOnly') run.punctuationOnly++;
    else if (offer === 'stale') run.stale++;
    else if (offer !== 'unchanged') run.rejected.push({ text: s.text, rewrite: rewrite!, reason: offer.rejected });
  }
  run.cancelled = signal.aborted;
  return run;
}

/**
 * Sentences a run may send: for "Check how it reads", the depth's rate but never more than the room left under
 * its decision budget (firstRunBudget); for "Check more sentences" (`more`), the depth's "more" rate.
 */
export function runBudget(session: CheckSession, more: boolean): number {
  const words = session.paragraphs().reduce((n, p) => n + countWords(p.text), 0);
  if (more) return rewriteCount(session.depth, words, true);
  const ranked = session.rankedDecisionCount();
  const budget = firstRunBudget(words, ranked, session.depth);
  // The click gets one sentence when the depth's room rounds down to 0 (a document under ~150 words, even one whose
  // review is full) or nothing is open for review. A longer document whose review is full gets none. `everything`
  // sends nothing (spec §5).
  const roomRoundsToNothing = upFrontRoom(session.depth, words) === 0 || ranked === 0;
  return budget === 0 && roomRoundsToNothing && rewriteCount(session.depth, words, false) > 0 ? 1 : budget;
}

/** What became of one answer: offered for review, nothing to offer, or why it was dropped. */
export type Offer = 'added' | 'unchanged' | 'punctuationOnly' | 'stale' | { rejected: GuardReason };

/**
 * Puts the helper's answer for `sentence` into the session: a rewrite that changes a word and passes the
 * meaning-drift guard (run by the session) becomes a pending review-tier decision. The sentence is marked as
 * sent, unless it no longer reads as `sentence.text` (then the answer is stale and dropped). Never applies anything.
 */
export function offerRewrite(session: CheckSession, sentence: PickedSentence, rewrite: string | null): Offer {
  const punctuationOnly = rewrite !== null && onlyPunctuationChanged(sentence.text, rewrite);
  // A punctuation-only rewrite is recorded as sent, with nothing to offer.
  const verdict = session.addRewrite(sentence.paraId, sentence.span, punctuationOnly ? null : rewrite, sentence.text);
  if (verdict === 'stale') return 'stale';
  if (punctuationOnly) return 'punctuationOnly';
  if (verdict === null) return 'unchanged';
  return verdict.ok ? 'added' : { rejected: verdict.reason! };
}
