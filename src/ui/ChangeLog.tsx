import type { Outcome } from '@/engine/session';
import type { ControllerState, SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  state: ControllerState;
  open: boolean;
  onToggle(): void;
}

function statusLabel(o: Outcome): string {
  if (o.unplaceable !== undefined) return `couldn't place it: ${o.unplaceable}`;
  if (o.status === 'applied') return o.auto ? 'auto-fixed' : 'accepted';
  return o.reason ?? 'rejected';
}

/** Bottom drawer: every applied or rejected change with its own Undo, and the report export. */
export function ChangeLog({ controller, state, open, onToggle }: Props) {
  const session = state.session;
  const entries = session ? session.outcomes().filter((o) => o.status === 'applied' || o.status === 'rejected') : [];
  const applied = entries.filter((o) => o.status === 'applied').length;

  return (
    <footer className={open ? 'changelog open' : 'changelog'}>
      <div className="changelog-bar">
        <button className="quiet" onClick={onToggle} aria-expanded={open}>
          {open ? '▾' : '▸'} Change log ({applied} applied)
        </button>
        <button disabled={!session} onClick={() => void controller.exportReport()}>
          Export report
        </button>
      </div>
      {open && (
        <ol className="entries">
          {entries.length === 0 && <li className="hint">No changes yet.</li>}
          {entries.map((o) => (
            <li key={o.candidate.id} className={o.status}>
              <span className="where">¶{o.paragraphNumber}</span>
              <span className="change">
                <del>{o.candidate.original || '·'}</del> → <ins>{o.replacement === '' ? '(deleted)' : o.replacement}</ins>
              </span>
              <span className="status">
                {o.candidate.kind} · {statusLabel(o)}
              </span>
              {o.status === 'applied' && <button onClick={() => controller.undo(o.candidate.id)}>Undo</button>}
              {o.status === 'rejected' && o.unplaceable === undefined && (
                <button className="quiet" onClick={() => controller.undo(o.candidate.id)}>
                  Review again
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </footer>
  );
}
