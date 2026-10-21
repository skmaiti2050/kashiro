// Which card is current, and the progress header (U1 items 1, 2 and 4).
import { describe, it, expect } from 'vitest';
import { cursorAt, currentDecision, decisionWith, moveCursor, START } from '@/ui/state/reviewCursor';
import { progressLabel, reviewProgress } from '@/ui/state/progress';

const d = (id: string, ...candidateIds: string[]) => ({ id, candidateIds: candidateIds.length ? candidateIds : [id] });
const top = [d('a'), d('b'), d('c')];
const more = [d('m', 'm1', 'm2')];

describe('review cursor', () => {
  it('starts on the first card', () => {
    expect(currentDecision(top, more, START)?.id).toBe('a');
  });

  it('J/K move without deciding and wrap around', () => {
    let cursor = moveCursor(top, more, START, 1);
    expect(currentDecision(top, more, cursor)?.id).toBe('b');
    cursor = moveCursor(top, more, cursor, 1);
    cursor = moveCursor(top, more, cursor, 1);
    expect(currentDecision(top, more, cursor)?.id).toBe('a');
    expect(currentDecision(top, more, moveCursor(top, more, START, -1))?.id).toBe('c');
  });

  it('after the current card is decided, the card that slid into its place is current', () => {
    const onB = moveCursor(top, more, START, 1);
    expect(currentDecision([d('a'), d('c')], more, onB)?.id).toBe('c');
    // The last one decided: the new last one.
    const onC = cursorAt(top, 'c');
    expect(currentDecision([d('a'), d('b')], more, onC)?.id).toBe('b');
    expect(currentDecision([], [], onC)).toBeUndefined();
  });

  it('a card picked from "More" stays current; J from it goes back into the queue', () => {
    const picked = cursorAt(top, 'm');
    expect(currentDecision(top, more, picked)?.id).toBe('m');
    expect(currentDecision(top, more, moveCursor(top, more, picked, 1))?.id).toBe('a');
  });

  it('finds the decision holding a candidate (clicking an underline)', () => {
    expect(decisionWith(top, more, 'm2')?.id).toBe('m');
    expect(decisionWith(top, more, 'zz')).toBeUndefined();
  });
});

describe('progress header', () => {
  it('"N of M left · ~X min", counting the decisions made so far', () => {
    expect(reviewProgress(4, 5)).toEqual({ left: 4, total: 9, minutes: 1 });
    expect(progressLabel(reviewProgress(4, 5))).toBe('4 of 9 left · ~1 min');
    expect(progressLabel(reviewProgress(13, 0))).toBe('13 of 13 left · ~3 min');
  });

  it('Done when nothing is left; never a score', () => {
    expect(progressLabel(reviewProgress(0, 7))).toBe('Done: 7 decisions made');
    expect(progressLabel(reviewProgress(0, 1))).toBe('Done: 1 decision made');
    expect(progressLabel(reviewProgress(0, 0))).toBe('Done: nothing to decide');
  });
});
