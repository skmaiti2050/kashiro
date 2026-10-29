// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { findLockedSpans } from '@/engine/factLock';

/** `length` characters from `alphabet` in a fixed pseudo-random order. */
const token = (alphabet: string, length: number) => {
  let x = 12345;
  return Array.from({ length }, () => alphabet[(x = (x * 1103515245 + 12345) % 2 ** 31) % alphabet.length]).join('');
};

/**
 * Task F21d (F21c adversarial review I-4): with Harper no longer reading a long token, the email and percentage
 * patterns were the slow part of a check with one: each started again at every character of the token (854 ms for
 * 40,000 characters). Budget: 50 ms for 40,000 characters; a linear scan takes a few.
 */
const BUDGET_MS = 50;

describe('the fact lock reads one long token in linear time (Task F21d)', () => {
  it.each([
    ['base64url', token('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', 40_000)],
    ['digits', '1'.repeat(40_000)],
    ['digits and commas', '1,'.repeat(20_000)],
    ['dots and pluses', 'a.b+'.repeat(10_000)],
  ])('%s: 40,000 characters within the budget', (_name, long) => {
    findLockedSpans('warm up a@b.co 5% here');
    const start = performance.now();
    findLockedSpans(`Key: ${long} and more`);
    expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  });
});
