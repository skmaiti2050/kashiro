import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';
import { useT } from './i18n/useT';
import { wordCardTitle, wordCardWords } from './state/labels';

interface Props {
  controller: SessionController;
  card: Decision & { kind: 'names' };
  candidates: Map<string, Candidate>;
}

/**
 * The names card (spec §5): every unknown name on one card. Ticked words join the personal dictionary;
 * unticked ones become their own decisions so a real typo can be fixed. Both words of a near-duplicate
 * pair ("Pirya" / "Priya") start unticked: one is probably a typo, and only the writer knows which.
 */
export function NamesCard({ controller, card, candidates }: Props) {
  const t = useT();
  const words = wordCardWords(card, candidates);
  const nearDuplicates = new Set((card.nearDuplicates ?? []).flat());

  return (
    <div className="card names">
      <CategoryTag category="names" />
      <h3>{wordCardTitle(t, card, candidates)}</h3>
      <p className="hint">{t.t('names.hint')}</p>
      {(card.nearDuplicates ?? []).length > 0 && (
        <p className="warn">{t.t('names.lookTwice', { pairs: card.nearDuplicates!.map(([a, b]) => `${a} / ${b}`).join(', ') })}</p>
      )}
      <WordTickList words={words} flagged={nearDuplicates} onAdd={(keepAsTypos) => void controller.acceptNames(keepAsTypos)} />
    </div>
  );
}
