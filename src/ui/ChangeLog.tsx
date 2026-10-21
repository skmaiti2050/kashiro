import type { Outcome } from '@/engine/session';
import { fixesLabel } from './state/labels';
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

/** One log row: a single change, or every change of one "Apply all" (undone together). */
type Row = { outcome: Outcome } | { batch: string; outcomes: Outcome[] };

function rowsOf(entries: Outcome[]): Row[] {
  const rows: Row[] = [];
  const batches = new Map<string, Outcome[]>();
  for (const o of entries) {
    if (o.batch === undefined) {
      rows.push({ outcome: o });
      continue;
    }
    const members = batches.get(o.batch);
    if (members) members.push(o);
    else {
      const first = [o];
      batches.set(o.batch, first);
      rows.push({ batch: o.batch, outcomes: first });
    }
  }
  return rows;
}

/** Bottom drawer: every applied or rejected change with its own Undo (a batch has one), and the report export. */
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
          {rowsOf(entries).map((row) =>
            'batch' in row ? <BatchRow key={row.batch} controller={controller} batch={row.batch} outcomes={row.outcomes} /> : <ChangeRow key={row.outcome.candidate.id} controller={controller} o={row.outcome} />,
          )}
        </ol>
      )}
    </footer>
  );
}

function ChangeRow({ controller, o }: { controller: SessionController; o: Outcome }) {
  return (
    <li className={o.status}>
      <span className="where">¶{o.paragraphNumber}</span>
      <span className="change">
        <del>{o.candidate.original || '·'}</del> → <ins>{o.replacement === '' ? '(deleted)' : o.replacement}</ins>
      </span>
      <span className="status">
        {o.candidate.kind} · {statusLabel(o)}
      </span>
      {o.status === 'applied' && <button onClick={() => controller.undo(o.candidate.id)}>Undo</button>}
      {/* A word in the dictionary stays unflagged until it is removed in Settings, so "Review again" would not hold. */}
      {o.status === 'rejected' && o.unplaceable === undefined && !o.reason?.endsWith('added to dictionary') && (
        <button className="quiet" onClick={() => controller.undo(o.candidate.id)}>
          Review again
        </button>
      )}
    </li>
  );
}

function BatchRow({ controller, batch, outcomes }: { controller: SessionController; batch: string; outcomes: Outcome[] }) {
  const first = outcomes[0];
  const paragraphs = [...new Set(outcomes.map((o) => `¶${o.paragraphNumber}`))].join(' ');
  return (
    <li className="applied batch">
      <span className="where">{paragraphs}</span>
      <span className="change">
        <del>{first.candidate.original || '·'}</del> → <ins>{first.replacement === '' ? '(deleted)' : first.replacement}</ins>
      </span>
      <span className="status">{fixesLabel(first.candidate.kind, outcomes.length)} applied together</span>
      <button onClick={() => controller.undoBatch(batch)}>Undo all {outcomes.length}</button>
    </li>
  );
}
