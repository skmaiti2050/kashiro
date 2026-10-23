import type { CheckSession } from '../session';
import type { PresetId } from '../presets';
import { countWords } from '../words';
import type { GuardReason } from './guard';
import { rewriteCount } from '../depth';
import { firstRunBudget, pickSentences } from './select';
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
  /** True when `signal` aborted: the results that already came back are kept. */
  cancelled: boolean;
}

/** One word, with apostrophes and hyphens inside it ("it's", "well-known", "3.2"): changing one is a real edit. */
const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;

/**
 * True when `rewrite` has exactly the words of `original`, in order and case: only punctuation or spaces
 * changed ("lights and" → "lights, and"). Such a rewrite is noise, so it is never offered.
 */
export function onlyPunctuationChanged(original: string, rewrite: string): boolean {
  const words = (text: string) => (text.match(WORD) ?? []).join(' ');
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
  const words = session.paragraphs().reduce((n, p) => n + countWords(p.text), 0);
  const budget = more
    ? rewriteCount(session.depth, words, true)
    : firstRunBudget(words, session.rankedDecisionCount(), session.depth);
  const run: RewriteRun = { sent: 0, added: 0, punctuationOnly: 0, rejected: [], cancelled: false };
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
    if (rewrite !== null && onlyPunctuationChanged(s.text, rewrite)) {
      run.punctuationOnly++;
      rewrite = null; // recorded as sent, with nothing to offer
    }
    // The session runs the meaning-drift guard; this only records the outcome.
    const verdict = session.addRewrite(s.paraId, s.span, rewrite);
    if (verdict?.ok) run.added++;
    else if (verdict) run.rejected.push({ text: s.text, rewrite: rewrite!, reason: verdict.reason! });
  }
  run.cancelled = signal.aborted;
  return run;
}
