// The tick logic of the names and other-language cards. A card keeps its state across a re-check (its React
// key is the constant card id), so a word that becomes flagged after the re-check must not inherit a tick.
import { describe, it, expect } from 'vitest';
import { isTicked, NO_TICKS, toggleTick } from '@/ui/state/cardTicks';

const flagged = (...words: string[]) => new Set(words);

describe('card ticks', () => {
  it('plain words start ticked, flagged words (likely typos, near-duplicates) start unticked', () => {
    const f = flagged('jion');
    expect([isTicked(NO_TICKS, 'chalo', f), isTicked(NO_TICKS, 'jion', f)]).toEqual([true, false]);
  });

  it('a flagged word is ticked only by an explicit tick, and unticked again by a second toggle', () => {
    const f = flagged('jion');
    const ticked = toggleTick(NO_TICKS, 'jion', f);
    expect(isTicked(ticked, 'jion', f)).toBe(true);
    expect(isTicked(toggleTick(ticked, 'jion', f), 'jion', f)).toBe(false);
  });

  it('after a re-check, a word that is newly flagged starts unticked, so "Add all" cannot save it', () => {
    let ticks = toggleTick(NO_TICKS, 'chalo', flagged('jion')); // the user unticks "chalo" before the re-check
    ticks = toggleTick(ticks, 'jion', flagged('jion')); // and ticks "jion" explicitly
    const afterRecheck = flagged('jion', 'byos'); // "byos" was removed from the dictionary and is back
    expect(['chalo', 'jion', 'byos'].map((w) => isTicked(ticks, w, afterRecheck))).toEqual([false, true, false]);
  });

  it('a plain word that becomes flagged needs an explicit tick, whatever it was before', () => {
    const before = flagged();
    const left = NO_TICKS; // "byos" was ticked by default
    const unticked = toggleTick(NO_TICKS, 'byos', before); // or the user unticked it
    expect([isTicked(left, 'byos', flagged('byos')), isTicked(unticked, 'byos', flagged('byos'))]).toEqual([false, false]);
  });
});
