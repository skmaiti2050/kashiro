import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  card: Decision;
  candidates: Map<string, Candidate>;
}

/**
 * The words-in-other-languages card (spec §5): romanised Hindi or Bengali words ("accha", "khub") that the
 * English dictionary doesn't know. They are never changed automatically: ticked words join the personal
 * dictionary; unticked ones become their own decisions so a real typo can be fixed.
 */
export function OtherLanguageCard({ controller, card, candidates }: Props) {
  const words = [...new Set(card.candidateIds.map((id) => candidates.get(id)!.original.toLowerCase()))];
  const [unticked, setUnticked] = useState(() => new Set<string>());
  const toggle = (word: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  // A re-check can change the card under the same key: only words on it now count.
  const keepAsTypos = words.filter((w) => unticked.has(w));
  const ticked = words.length - keepAsTypos.length;
  const addLabel = ticked === words.length ? 'Add all to my dictionary' : `Add ${ticked} to my dictionary`;

  return (
    <div className="card other-language">
      <h3>{card.label}</h3>
      <p className="hint">Words that look like romanised Hindi or Bengali. Untick any that are real typos.</p>
      <ul className="name-list">
        {words.map((word) => (
          <li key={word}>
            <label>
              <input type="checkbox" checked={!unticked.has(word)} onChange={() => toggle(word)} />
              {word}
              {unticked.has(word) && <span className="hint"> (review as a typo)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={() => void controller.acceptOtherLanguage(keepAsTypos)}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}
