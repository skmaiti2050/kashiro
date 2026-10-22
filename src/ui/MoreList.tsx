import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { useT } from './i18n/useT';
import { DecisionTitle } from './DecisionTitle';

interface Props {
  more: Decision[];
  currentId: string | undefined;
  candidates: Map<string, Candidate>;
  onPick(decision: Decision): void;
}

/** "More (N)": the ranked decisions beyond the review depth, each one a click away from the card. */
export function MoreList({ more, currentId, candidates, onPick }: Props) {
  const t = useT();
  if (more.length === 0) return null;
  return (
    <details className="more">
      <summary>{t.t('more.summary', { count: more.length })}</summary>
      <ul>
        {more.map((d) => (
          <li key={d.id} className={d.id === currentId ? 'current' : undefined}>
            <button className="row-label" onClick={() => onPick(d)}>
              <DecisionTitle decision={d} candidates={candidates} />
            </button>
            <button className="row-action" onClick={() => onPick(d)}>
              {t.t('more.review')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
