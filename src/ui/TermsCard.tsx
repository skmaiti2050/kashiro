import type { Decision } from '@/engine/decisions';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';

interface Props {
  controller: SessionController;
  card: Decision;
}

const NOTHING_FLAGGED: ReadonlySet<string> = new Set();

/**
 * The terms card (spec §5): unknown lowercase words the document uses consistently ("sarpanch ×5") are
 * probably intended terms. Ticked words join the personal dictionary; unticked ones become their own
 * decisions so a real typo can be fixed.
 */
export function TermsCard({ controller, card }: Props) {
  const counts = card.counts ?? {};

  return (
    <div className="card terms">
      <CategoryTag category="terms" />
      <h3>{card.label}</h3>
      <p className="hint">Words the dictionary doesn't know, spelled the same way every time. Untick any that are real typos.</p>
      <WordTickList
        words={Object.keys(counts)}
        flagged={NOTHING_FLAGGED}
        detail={(word) => <span className="hint"> ×{counts[word]}</span>}
        onAdd={(keepAsTypos) => void controller.acceptTerms(keepAsTypos)}
      />
    </div>
  );
}
