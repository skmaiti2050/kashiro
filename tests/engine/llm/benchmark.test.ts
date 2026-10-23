import { describe, expect, it, vi } from 'vitest';
import { BENCHMARK_SENTENCE, SLOW_SECONDS, timeOneSentence } from '@/engine/llm/benchmark';
import type { Rewriter } from '@/engine/llm/suggest';

/** A clock that moves `seconds` while the rewrite runs. */
function timed(seconds: number) {
  let now = 1000;
  const rewriter: Rewriter = {
    rewrite: vi.fn(async () => {
      now += seconds * 1000;
      return 'The results were clear to everyone who saw them.';
    }),
  };
  return { rewriter, now: () => now };
}

const live = () => new AbortController().signal;

describe('timeOneSentence', () => {
  it("times one rewrite of the sample sentence in the user's English, in seconds", async () => {
    const { rewriter, now } = timed(1.4);
    expect(await timeOneSentence(rewriter, 'Indian', live(), now)).toEqual({ seconds: 1.4, slow: false });
    expect(rewriter.rewrite).toHaveBeenCalledWith(BENCHMARK_SENTENCE, 'business', 'Indian', expect.any(AbortSignal));
  });

  it('calls a machine slow when one sentence takes longer than the plan allows (5 s on CPU)', async () => {
    expect(SLOW_SECONDS).toBe(5);
    const atLimit = timed(5);
    expect(await timeOneSentence(atLimit.rewriter, 'British', live(), atLimit.now)).toEqual({ seconds: 5, slow: false });
    const slow = timed(9.9);
    expect(await timeOneSentence(slow.rewriter, 'British', live(), slow.now)).toEqual({ seconds: 9.9, slow: true });
  });

  it('the sample is one ordinary sentence the guard can judge: no locked facts, about 25 words', () => {
    expect(BENCHMARK_SENTENCE.split(' ').length).toBeGreaterThanOrEqual(20);
    expect(BENCHMARK_SENTENCE).not.toMatch(/\d/);
  });

  it('a cancel rejects', async () => {
    const ac = new AbortController();
    ac.abort();
    const rewriter: Rewriter = { rewrite: async (_t, _p, _v, signal) => (signal.throwIfAborted(), null) };
    await expect(timeOneSentence(rewriter, 'American', ac.signal)).rejects.toThrow();
  });
});
