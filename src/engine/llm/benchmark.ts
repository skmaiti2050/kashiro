import type { Rewriter } from './suggest';

/** An ordinary awkward sentence with nothing fact-locked, about as long as the sentences the helper is sent. */
export const BENCHMARK_SENTENCE =
  'The report that was written by the team last week was not very clear about what the next steps for the project are going to be.';

/** Above this, one sentence is too slow for the helper to feel usable (the plan's limit per sentence on CPU). */
export const SLOW_SECONDS = 5;

/**
 * The warm-up benchmark: how long the started helper takes for one sample sentence. The UI can use `slow`
 * for its first-run advice (use a smaller model, or keep AI rewrites off). `now` is in milliseconds.
 */
export async function timeOneSentence(
  rewriter: Rewriter,
  signal: AbortSignal,
  now: () => number = () => performance.now(),
): Promise<{ seconds: number; slow: boolean }> {
  const started = now();
  await rewriter.rewrite(BENCHMARK_SENTENCE, 'business', signal);
  const seconds = (now() - started) / 1000;
  return { seconds, slow: seconds > SLOW_SECONDS };
}
