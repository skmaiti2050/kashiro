/**
 * What the user changed on a card's tick list (names, terms, other-language words). Plain words start ticked and
 * `unticked` holds the ones the user unticked; flagged words (likely typos, near-duplicates) start unticked
 * and `ticked` holds the ones the user ticked explicitly. Keeping the two apart matters because a card keeps
 * its state across a re-check: a word flagged only after it must not inherit a tick.
 */
export interface CardTicks {
  unticked: ReadonlySet<string>;
  ticked: ReadonlySet<string>;
}

export const NO_TICKS: CardTicks = { unticked: new Set(), ticked: new Set() };

/** True when `word` is ticked, given the card's flagged words now. */
export function isTicked(ticks: CardTicks, word: string, flagged: ReadonlySet<string>): boolean {
  return flagged.has(word) ? ticks.ticked.has(word) : !ticks.unticked.has(word);
}

/** What the card's "Add" button sends, for the words on the card now (a re-check can change them). */
export interface TickSummary {
  /** Unticked words: they leave the card as their own decisions. */
  keepAsTypos: string[];
  /** Flagged words the user ticked explicitly: the engine adds them only when told. */
  tickedFlagged: string[];
  addLabel: string;
}

export function tickSummary(ticks: CardTicks, words: string[], flagged: ReadonlySet<string>): TickSummary {
  const keepAsTypos = words.filter((w) => !isTicked(ticks, w, flagged));
  const tickedFlagged = words.filter((w) => flagged.has(w) && isTicked(ticks, w, flagged));
  const tickedCount = words.length - keepAsTypos.length;
  const addLabel = tickedCount === words.length ? 'Add all to my dictionary' : `Add ${tickedCount} to my dictionary`;
  return { keepAsTypos, tickedFlagged, addLabel };
}

/** The ticks after the user toggles `word`. */
export function toggleTick(ticks: CardTicks, word: string, flagged: ReadonlySet<string>): CardTicks {
  const key = flagged.has(word) ? 'ticked' : 'unticked';
  const next = new Set(ticks[key]);
  if (next.has(word)) next.delete(word);
  else next.add(word);
  return { ...ticks, [key]: next };
}
