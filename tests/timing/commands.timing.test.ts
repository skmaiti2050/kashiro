// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { findCommandText } from '@/engine/commands';
import { PATH } from '@/engine/commandShapes';

/** One paragraph of `words` words, `unit` repeated (a pasted log, or a huge single-paragraph .docx). */
const paragraph = (unit: string, words: number) => {
  const per = unit.trim().split(/\s+/).length;
  return Array.from({ length: Math.ceil(words / per) }, () => unit).join(' ');
};

/**
 * Task F21c (F21 adversarial review M-28): the command scan was quadratic on one long paragraph (872 ms for 20,000
 * words of "the docker", 1.18 s for a line of "sudo"). Budget: 200 ms for 20,000 words. The whole check may take
 * 300 ms per 1,500 words (CLAUDE.md), about 4 s for 20,000 words, so the scan stays under 5% of it; a linear scan
 * takes a few tens of milliseconds here, and a quadratic one is several times over.
 */
const BUDGET_MS = 200;

describe('the command scan is linear in a paragraph\'s length (Task F21c, review M-28)', () => {
  it.each([
    ['nouns after an article', 'the docker'],
    ['command words, one clause', 'sudo'],
    ['command clauses and weak signs', 'Then run git commit -am wip, the the rest; cd /app; make the target -v until sudo ls ${X}.'],
    ['prose with signs', 'We moved app.py to /etc and | the plan; changed key=value here.'],
  ])('%s: 20,000 words in one paragraph within the budget', (_name, unit) => {
    const text = paragraph(unit, 20_000);
    findCommandText([{ id: 0, text: 'warm up sudo ls -la' }]);
    const start = performance.now();
    findCommandText([{ id: 0, text }]);
    expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  });
});

/** A token of `length` characters drawn in a fixed order from `alphabet` (a pasted key, hash or data URI). */
const token = (alphabet: string, length: number) => Array.from({ length }, (_, i) => alphabet[(i * 7919 + 13) % alphabet.length]).join('');

/**
 * Task F21d (F21c adversarial review M-29): the path pattern ran twice over one long token with no "/" (5.2 s for
 * 100,000 letters). Budget: 50 ms for a 100,000-character token, the brief's figure; a linear scan takes a few.
 */
const LONG_TOKEN_BUDGET_MS = 50;

describe('one long token is scanned in linear time (Task F21d, review M-29)', () => {
  it.each([
    ['letters', 'a'.repeat(100_000)],
    ['base64url', token('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', 100_000)],
    ['hex', token('0123456789abcdef', 100_000)],
    ['letters then one "/"', 'a'.repeat(100_000) + '/b'],
    ['letters and dashes', 'a-'.repeat(50_000)],
  ])('%s: the path pattern and the whole scan within the budget', (_name, long) => {
    const line = `Key: ${long} and more`;
    findCommandText([{ id: 0, text: 'warm up sudo ls -la ./x/y.z' }]);
    let start = performance.now();
    [...line.matchAll(PATH)];
    expect(performance.now() - start).toBeLessThan(LONG_TOKEN_BUDGET_MS);
    start = performance.now();
    findCommandText([{ id: 0, text: line }]);
    expect(performance.now() - start).toBeLessThan(LONG_TOKEN_BUDGET_MS);
  });
});
