import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  card: Decision;
}

/**
 * The terms card (spec §5): unknown lowercase words the document uses consistently ("sarpanch ×5") are
 * probably intended terms. Ticked words join the personal dictionary; unticked ones become their own
 * decisions so a real typo can be fixed.
 */
export function TermsCard({ controller, card }: Props) {
  const counts = card.counts ?? {};
  const words = Object.keys(counts);
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
    <div className="card terms">
      <h3>{card.label}</h3>
      <p className="hint">Words the dictionary doesn't know, spelled the same way every time. Untick any that are real typos.</p>
      <ul className="name-list">
        {words.map((word) => (
          <li key={word}>
            <label>
              <input type="checkbox" checked={!unticked.has(word)} onChange={() => toggle(word)} />
              {word} <span className="hint">×{counts[word]}</span>
              {unticked.has(word) && <span className="hint"> (review as a typo)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={() => void controller.acceptTerms(keepAsTypos)}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}
