import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';

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

  return (
    <div className="card names">
      <CategoryTag category="names" />
      <h3>{card.label}</h3>
      <p className="hint">Names and places the dictionary doesn't know. Untick any that are real typos.</p>
      {(card.nearDuplicates ?? []).length > 0 && (
        <p className="warn">
          Look twice: {card.nearDuplicates!.map(([a, b]) => `${a} / ${b}`).join(', ')} differ by one letter.
        </p>
      )}
      <WordTickList words={words} flagged={nearDuplicates} onAdd={(keepAsTypos) => void controller.acceptNames(keepAsTypos)} />
    </div>
  );
}

/** First spelling of each word, case-insensitively, in order of appearance. */
function distinctWords(cands: Candidate[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cands) if (!seen.has(c.original.toLowerCase())) seen.set(c.original.toLowerCase(), c.original);
  return [...seen.values()];
}
