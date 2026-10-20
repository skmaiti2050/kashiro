import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { CheckSession } from '@/engine/session';
import { DecisionCard } from './DecisionCard';
import { DepthSlider } from './DepthSlider';
import { NamesCard } from './NamesCard';
import type { ControllerState, SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  state: ControllerState;
}

/** The review queue: "N decisions", one at a time, the rest under "More (N)". */
export function ReviewPanel({ controller, state }: Props) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const session = state.session;
  if (!session) {
    return (
      <aside className="review">
        <p className="hint">{state.phase === 'checking' ? 'Checking…' : 'Decisions show up here after a check.'}</p>
      </aside>
    );
  }

  const { top, more } = session.decisions();
  const queue = top.filter((d) => !skipped.includes(d.id));
  const current = queue[0];
  const candidates = new Map(session.candidates().map((c) => [c.id, c]));
  const paraText = new Map(session.paragraphs().map((p) => [p.id, p.text]));

  return (
    <aside className="review">
      <header>
        <h2>
          {top.length} {top.length === 1 ? 'decision' : 'decisions'}
          {state.phase === 'checking' && <span className="hint"> · checking…</span>}
        </h2>
        <DepthSlider value={session.depth} onChange={(d) => controller.setDepth(d)} />
      </header>

      {current?.kind === 'names' && <NamesCard key={current.id} controller={controller} card={current} candidates={candidates} />}
      {current && current.kind !== 'names' && (
        <DecisionCard
          key={current.id}
          controller={controller}
          decision={current}
          candidates={candidates}
          paraText={paraText}
          onSkip={() => setSkipped((s) => [...s, current.id])}
        />
      )}
      {!current && (
        <p className="done">
          {skipped.length ? `${skipped.length} skipped. ` : 'Nothing left to decide. '}
          {skipped.length > 0 && <button onClick={() => setSkipped([])}>Show skipped</button>}
        </p>
      )}

      {more.length > 0 && <MoreList controller={controller} session={session} more={more} />}
    </aside>
  );
}

function MoreList({ controller, session, more }: { controller: SessionController; session: CheckSession; more: Decision[] }) {
  const candidates = new Map(session.candidates().map((c) => [c.id, c]));
  return (
    <details className="more">
      <summary>More ({more.length})</summary>
      <ul>
        {more.map((d) => {
          if (d.kind === 'names') {
            return (
              <li key={d.id}>
                <NamesCard controller={controller} card={d} candidates={candidates} />
              </li>
            );
          }
          const first = candidates.get(d.candidateIds[0])!;
          return (
            <li key={d.id}>
              <span>{d.label}</span>
              {first.replacements.length > 0 && <button onClick={() => controller.accept(d.id)}>Accept</button>}
              <button onClick={() => controller.reject(d.id)}>Reject</button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
