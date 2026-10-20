import { useEffect, useRef, useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { DecisionCard } from './DecisionCard';
import { DepthSlider } from './DepthSlider';
import { NamesCard } from './NamesCard';
import { TermsCard } from './TermsCard';
import { decisionTitle } from './state/labels';
import type { ControllerState, SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Shows a candidate in the document view (highlighted and scrolled into view). */
  onLocate(candidate: Candidate): void;
}

/** The review queue: "N decisions", one at a time, the rest under "More (N)". */
export function ReviewPanel({ controller, state, onLocate }: Props) {
  const [skipped, setSkipped] = useState<string[]>([]);
  /** A decision picked from "More": shown on the card until it is decided or skipped. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Bumped when a decision is picked: the panel scrolls back up to the card and focuses it. */
  const [reveal, setReveal] = useState(0);
  const cardSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal === 0) return;
    // matchMedia is missing in some test and embedded environments.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    cardSlot.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    cardSlot.current?.focus({ preventScroll: true });
  }, [reveal]);
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
  const current = more.find((d) => d.id === picked) ?? queue[0];
  const candidates = new Map(session.candidates().map((c) => [c.id, c]));
  const paraText = new Map(session.paragraphs().map((p) => [p.id, p.text]));
  const skip = (id: string) => {
    if (id === picked) setPicked(null);
    else setSkipped((s) => [...s, id]);
  };
  const pick = (d: Decision) => {
    setPicked(d.id);
    setReveal((n) => n + 1);
    onLocate(candidates.get(d.candidateIds[0])!);
  };

  return (
    <aside className="review">
      <header>
        <h2>
          {top.length} {top.length === 1 ? 'decision' : 'decisions'}
          {state.phase === 'checking' && <span className="hint"> · checking…</span>}
        </h2>
        <DepthSlider value={session.depth} onChange={(d) => controller.setDepth(d)} />
      </header>

      <div ref={cardSlot} className="card-slot" role="group" tabIndex={-1} aria-label="Current decision">
        {current?.kind === 'names' && <NamesCard key={current.id} controller={controller} card={current} candidates={candidates} />}
        {current?.kind === 'terms' && <TermsCard key={current.id} controller={controller} card={current} />}
        {current && current.kind !== 'names' && current.kind !== 'terms' && (
          <DecisionCard
            key={current.id}
            controller={controller}
            decision={current}
            candidates={candidates}
            paraText={paraText}
            onSkip={() => skip(current.id)}
            onLocate={onLocate}
          />
        )}
      </div>
      {!current && (
        <p className="done">
          {skipped.length ? `${skipped.length} skipped. ` : 'Nothing left to decide. '}
          {skipped.length > 0 && <button onClick={() => setSkipped([])}>Show skipped</button>}
        </p>
      )}

      {more.length > 0 && (
        <details className="more">
          <summary>More ({more.length})</summary>
          <ul>
            {more.map((d) => (
              <li key={d.id} className={d.id === current?.id ? 'current' : undefined}>
                <button className="row-label" onClick={() => pick(d)}>
                  {decisionTitle(d, candidates.get(d.candidateIds[0])!)}
                </button>
                <button className="row-action" onClick={() => pick(d)}>
                  Review
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
