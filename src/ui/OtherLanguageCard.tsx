import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { isTicked, NO_TICKS, toggleTick } from './state/cardTicks';

interface Props {
  controller: SessionController;
  card: Decision;
  candidates: Map<string, Candidate>;
}

/**
 * The words-in-Indian-languages card (spec §5): romanised words of ten Indian languages ("accha", "khub",
 * "konjam") that the English dictionary doesn't know. They are never changed automatically: ticked words join the personal
 * dictionary; unticked ones become their own decisions so a real typo can be fixed. A likely typo ("jion",
 * one letter from "join") starts unticked with a hint, and joins the dictionary only when ticked.
 */
export function OtherLanguageCard({ controller, card, candidates }: Props) {
  const words = [...new Set(card.candidateIds.map((id) => candidates.get(id)!.original.toLowerCase()))];
  const typoOf = new Map(card.likelyTypos ?? []);
  const likelyTypos = new Set(typoOf.keys());
  // A re-check can change the card under the same key: only words on it now, and their flags now, count.
  const [ticks, setTicks] = useState(NO_TICKS);
  const ticked = (word: string) => isTicked(ticks, word, likelyTypos);
  const toggle = (word: string) => setTicks((prev) => toggleTick(prev, word, likelyTypos));
  const keepAsTypos = words.filter((w) => !ticked(w));
  const tickedLikelyTypos = words.filter((w) => likelyTypos.has(w) && ticked(w));
  const tickedCount = words.length - keepAsTypos.length;
  const addLabel = tickedCount === words.length ? 'Add all to my dictionary' : `Add ${tickedCount} to my dictionary`;

  return (
    <div className="card other-language">
      <h3>{card.label}</h3>
      <p className="hint">Words that look like Indian-language words written in English letters. Untick any that are real typos.</p>
      <ul className="name-list">
        {words.map((word) => (
          <li key={word}>
            <label>
              <input type="checkbox" checked={ticked(word)} onChange={() => toggle(word)} />
              {word}
              {typoOf.has(word) && (
                <span className="hint">
                  {' '}
                  looks like a typo of <em>{typoOf.get(word)}</em>?
                </span>
              )}
              {!ticked(word) && <span className="hint"> (review as a typo)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={() => void controller.acceptOtherLanguage(keepAsTypos, tickedLikelyTypos)}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}
