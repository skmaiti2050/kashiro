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
  it('position, category, before and after, and the message', () => {
    expect(cardLabel(single, candidate, 2, 9)).toBe('Card 2 of 9. Correctness, Spelling. Change “recieve” to “receive”. Did you mean “receive”?');
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
