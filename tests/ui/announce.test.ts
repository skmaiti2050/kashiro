// Screen-reader text (Task A1 item 2): the card's name and the polite announcement after a decision.
import { describe, it, expect } from 'vitest';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { afterAction, cardLabel } from '@/ui/state/announce';
import { reviewProgress } from '@/ui/state/progress';

const candidate: Candidate = {
  id: 'c1',
  paraId: 0,
  span: { start: 0, end: 7 },
  original: 'recieve',
  replacements: ['receive'],
  kind: 'Spelling',
  message: 'Did you mean “receive”?',
  source: 'rules',
};
const single = { id: 'c1', kind: 'single', label: 'recieve', candidateIds: ['c1'], score: 1 } as Decision;

describe('cardLabel', () => {
  it('position among the cards left, category and kind label, before and after, and the message', () => {
    expect(cardLabel(single, candidate, 2, 9)).toBe('Card 2 of 9 left. Correctness: Spelling. Change “recieve” to “receive”. Did you mean “receive”?');
  });

  it('names a kind by its label, never by its rule name', () => {
    const joined = { ...candidate, kind: 'BoundaryError', original: 'any where', replacements: ['anywhere'] };
    expect(cardLabel(single, joined, 1, 3)).toMatch(/^Card 1 of 3 left\. Correctness: Words joined or split\. /);
  });
});

describe('afterAction', () => {
  it('"Accepted. 4 of 9 left."', () => {
    expect(afterAction('Accepted', reviewProgress(4, 5))).toBe('Accepted. 4 of 9 left.');
  });

  it('the last decision says all are reviewed', () => {
    expect(afterAction('Rejected', reviewProgress(0, 3))).toBe('Rejected. All reviewed.');
  });
});
