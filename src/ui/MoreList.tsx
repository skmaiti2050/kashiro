import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { decisionTitle } from './state/labels';

interface Props {
  more: Decision[];
  currentId: string | undefined;
  candidates: Map<string, Candidate>;
  onPick(decision: Decision): void;
}

/** "More (N)": the ranked decisions beyond the review depth, each one a click away from the card. */
export function MoreList({ more, currentId, candidates, onPick }: Props) {
  if (more.length === 0) return null;
  return (
    <details className="more">
      <summary>More ({more.length})</summary>
      <ul>
        {more.map((d) => (
          <li key={d.id} className={d.id === currentId ? 'current' : undefined}>
            <button className="row-label" onClick={() => onPick(d)}>
              {decisionTitle(d, candidates.get(d.candidateIds[0])!)}
            </button>
            <button className="row-action" onClick={() => onPick(d)}>
              Review
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
