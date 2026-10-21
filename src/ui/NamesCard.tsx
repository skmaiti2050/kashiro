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
 * The names card (spec §5): every unknown name on one card. Ticked words join the personal dictionary;
 * unticked ones become their own decisions so a real typo can be fixed. Both words of a near-duplicate
 * pair ("Pirya" / "Priya") start unticked: one is probably a typo, and only the writer knows which.
 */
export function NamesCard({ controller, card, candidates }: Props) {
  const words = distinctWords(card.candidateIds.map((id) => candidates.get(id)!));
  const nearDuplicates = new Set((card.nearDuplicates ?? []).flat());
  // A re-check can change the card under the same key: only words on it now, and their flags now, count.
  const [ticks, setTicks] = useState(NO_TICKS);
  const ticked = (word: string) => isTicked(ticks, word, nearDuplicates);
  const toggle = (word: string) => setTicks((prev) => toggleTick(prev, word, nearDuplicates));
  const keepAsTypos = words.filter((w) => !ticked(w));
  const tickedCount = words.length - keepAsTypos.length;
  const addLabel = tickedCount === words.length ? 'Add all to my dictionary' : `Add ${tickedCount} to my dictionary`;

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
              <input type="checkbox" checked={ticked(word)} onChange={() => toggle(word)} />
              {word}
              {!ticked(word) && <span className="hint"> (review as a typo)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={() => void controller.acceptNames(keepAsTypos)}>
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
