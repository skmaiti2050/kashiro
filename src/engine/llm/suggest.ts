import type { CheckSession } from '../session';
import type { PresetId } from '../presets';
import { countWords } from '../words';
import type { GuardReason } from './guard';
import { firstRunBudget, pickSentences, rewriteBudget } from './select';
import type { LlmClient } from './client';

/** What suggestRewrites needs from the helper: LlmClient, or recorded answers in tests. */
export type Rewriter = Pick<LlmClient, 'rewrite'>;

export interface RewriteRun {
  /** Sentences the helper answered. */
  sent: number;
  /** Rewrites that passed the guard and are now pending review. */
  added: number;
  /** Rewrites the guard stopped, for the change log. */
  rejected: { text: string; rewrite: string; reason: GuardReason }[];
  /** True when `signal` aborted: the results that already came back are kept. */
  cancelled: boolean;
}

/**
 * "Check how it reads" (and "Check more sentences"): sends the next budgeted sentences, one at a time,
 * and offers each rewrite that passes the meaning-drift guard as a review-tier decision. Never applies
 * anything. A cancel ends the run quietly; any other helper error is thrown.
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
  const budget = more ? rewriteBudget(words) : firstRunBudget(words, session.rankedDecisionCount());
  const run: RewriteRun = { sent: 0, added: 0, rejected: [], cancelled: false };
  for (const s of pickSentences(session, budget)) {
    if (signal.aborted) break;
    let rewrite: string | null;
    try {
      rewrite = await helper.rewrite(s.text, preset, signal);
    } catch (e) {
      if (signal.aborted) break;
      throw e;
    }
    run.sent++;
    // The session runs the meaning-drift guard; this only records the outcome.
    const verdict = session.addRewrite(s.paraId, s.span, rewrite);
    if (verdict?.ok) run.added++;
    else if (verdict) run.rejected.push({ text: s.text, rewrite: rewrite!, reason: verdict.reason! });
  }
  run.cancelled = signal.aborted;
  return run;
}
