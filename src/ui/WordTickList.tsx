import { useState, type ReactNode } from 'react';
import { Kbd } from './Kbd';
import { useT } from './i18n/useT';
import { isTicked, NO_TICKS, tickSummary, toggleTick } from './state/cardTicks';

interface Props {
  /** The words on the card now, in order. */
  words: string[];
  /** Words that start unticked and join the dictionary only when ticked explicitly (likely typos, near-duplicates). */
  flagged: ReadonlySet<string>;
  /** Extra text after a word ("×5", "looks like a typo of join?"). */
  detail?(word: string): ReactNode;
  onAdd(keepAsTypos: string[], tickedFlagged: string[]): void;
}

/**
 * The tick list shared by the names, terms and other-language cards: ticked words join the personal
 * dictionary, unticked ones become their own decisions so a real typo can be fixed. The card keeps its
 * ticks across a re-check (its key is the constant card id), so cardTicks keeps explicit ticks apart.
 */
export function WordTickList({ words, flagged, detail, onAdd }: Props) {
  const t = useT();
  const [ticks, setTicks] = useState(NO_TICKS);
  const { keepAsTypos, tickedFlagged, tickedCount } = tickSummary(ticks, words, flagged);
  const addLabel = tickedCount === words.length ? t.t('ticks.addAll') : t.t('ticks.addSome', { count: tickedCount });

  return (
    <>
      <ul className="name-list">
        {words.map((word) => {
          const ticked = isTicked(ticks, word, flagged);
          return (
            <li key={word}>
              <label>
                <input type="checkbox" checked={ticked} onChange={() => setTicks((prev) => toggleTick(prev, word, flagged))} />
                <span lang="en">{word}</span>
                {detail?.(word)}
                {!ticked && <span className="hint"> {t.t('ticks.reviewAsTypo')}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button className="primary" data-key="accept" aria-keyshortcuts="Enter" onClick={() => onAdd(keepAsTypos, tickedFlagged)}>
          {addLabel} <Kbd>Enter</Kbd>
        </button>
      </div>
    </>
  );
}
