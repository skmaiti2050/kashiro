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
 * The names card (spec §5): every unknown name on one card. Ticked words join the personal dictionary;
 * unticked ones become their own decisions so a real typo can be fixed. Both words of a near-duplicate
 * pair ("Pirya" / "Priya") start unticked: one is probably a typo, and only the writer knows which.
 */
export function NamesCard({ controller, card, candidates }: Props) {
  const words = distinctWords(card.candidateIds.map((id) => candidates.get(id)!));
  const [unticked, setUnticked] = useState(() => new Set((card.nearDuplicates ?? []).flat()));
  const toggle = (word: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  const ticked = words.length - words.filter((w) => unticked.has(w)).length;
  const addLabel = ticked === words.length ? 'Add all to my dictionary' : `Add ${ticked} to my dictionary`;

  return (
    <div className="card names">
      <h3>{card.label}</h3>
      <p className="hint">Names and places the dictionary doesn't know. Untick any that are real typos.</p>
      {(card.nearDuplicates ?? []).length > 0 && (
        <p className="warn">
          Look twice: {card.nearDuplicates!.map(([a, b]) => `${a} / ${b}`).join(', ')} differ by one letter.
        </p>
      )}
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
        <button className="primary" onClick={() => void controller.acceptNames(words.filter((w) => unticked.has(w)))}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

/** First spelling of each word, case-insensitively, in order of appearance. */
function distinctWords(cands: Candidate[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cands) if (!seen.has(c.original.toLowerCase())) seen.set(c.original.toLowerCase(), c.original);
  return [...seen.values()];
}
