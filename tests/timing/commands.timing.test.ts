// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { findCommandText } from '@/engine/commands';

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
