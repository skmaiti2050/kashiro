import { describe, it, expect } from 'vitest';
import { DecisionTally } from '@/ui/state/decisionTally';

describe('DecisionTally', () => {
  it('starts at 0 and counts decisions made', () => {
    const tally = new DecisionTally();
    expect(tally.decided).toBe(0);
    tally.made(1);
    tally.made(1);
    tally.made(0);
    expect(tally.decided).toBe(2);
  });

  it('a rejection counts one decision, however many places it covers', () => {
    const tally = new DecisionTally();
    tally.rejected('batch:x', ['a', 'b', 'c']);
    expect(tally.decided).toBe(1);
  });

  it('reopening a rejected place gives back one decision per rejection, not one per place', () => {
    const tally = new DecisionTally();
    tally.made(1);
    tally.rejected('batch:x', ['a', 'b']);
    expect(tally.decided).toBe(2);
    tally.reopen('a');
    expect(tally.decided).toBe(1);
    tally.reopen('b');
    expect(tally.decided).toBe(1);
  });

  it('a second rejection of the same decision gives back its own decision', () => {
    const tally = new DecisionTally();
    tally.rejected('single', ['a']);
    tally.reopen('a');
    tally.rejected('single', ['a']);
    expect(tally.decided).toBe(1);
    tally.reopen('a');
    expect(tally.decided).toBe(0);
  });

  it('reopening a place it never saw rejected gives back one decision (e.g. carried over by a re-check)', () => {
    const tally = new DecisionTally();
    tally.made(1);
    tally.reopen('unknown');
    expect(tally.decided).toBe(0);
  });

  it('never goes below 0', () => {
    const tally = new DecisionTally();
    tally.reopen('a');
    tally.made(-1);
    expect(tally.decided).toBe(0);
  });

  it('remap moves rejections to their new ids and forgets ones not carried', () => {
    const tally = new DecisionTally();
    tally.rejected('batch:x', ['0:1', '0:2']);
    tally.rejected('single', ['3:4']);
    tally.remap(new Map([['0:1', '1:1'], ['0:2', '1:2']]));
    tally.reopen('1:1');
    tally.reopen('1:2');
    expect(tally.decided).toBe(1); // the batch gave back one decision
    tally.reopen('3:4'); // forgotten: counted as a rejection made outside the tally
    expect(tally.decided).toBe(0);
  });

  it('reset forgets the count and the rejections', () => {
    const tally = new DecisionTally();
    tally.rejected('batch:x', ['a', 'b']);
    tally.reopen('a');
    tally.reset();
    expect(tally.decided).toBe(0);
    tally.made(2);
    tally.reopen('b'); // its rejection was forgotten: an unknown place gives one back
    expect(tally.decided).toBe(1);
  });
});
