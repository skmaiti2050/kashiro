import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';
import { useT } from './i18n/useT';
import { wordCardTitle } from './state/labels';

interface Props {
  controller: SessionController;
  card: Decision & { kind: 'terms' };
  candidates: Map<string, Candidate>;
}

const NOTHING_FLAGGED: ReadonlySet<string> = new Set();

/**
 * The terms card (spec §5): unknown lowercase words the document uses consistently ("sarpanch ×5") are
 * probably intended terms. Ticked words join the personal dictionary; unticked ones become their own
 * decisions so a real typo can be fixed.
 */
export function TermsCard({ controller, card, candidates }: Props) {
  const t = useT();
  const counts = card.counts ?? {};

  return (
    <div className="card terms">
      <CategoryTag category="terms" />
      <h3>{wordCardTitle(t, card, candidates)}</h3>
      <p className="hint">{t.t('terms.hint')}</p>
      <WordTickList
        words={Object.keys(counts)}
        flagged={NOTHING_FLAGGED}
        detail={(word) => <span className="hint"> {t.t('terms.uses', { count: counts[word] })}</span>}
        onAdd={(keepAsTypos) => void controller.acceptTerms(keepAsTypos)}
      />
    </div>
  );
}
