import type { Outcome } from '@/engine/session';
import type { Translator } from './i18n/translator';
import { useT } from './i18n/useT';
import { reasonMessage, unplaceableMessage } from './state/engineReasons';
import { kindLabel } from './state/kindLabels';
import type { ControllerState, SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  state: ControllerState;
  open: boolean;
  onToggle(): void;
}

function statusLabel(t: Translator, o: Outcome): string {
  if (o.unplaceable !== undefined) return t.t('log.couldNotPlace', { reason: t.format(unplaceableMessage(o.unplaceable)) });
  if (o.status === 'applied') return o.auto ? t.t('log.autoFixed') : t.t('log.accepted');
  return o.reason ? t.format(reasonMessage(o.reason)) : t.t('log.rejected');
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
  const t = useT();
  const session = state.session;
  const entries = session ? session.outcomes().filter((o) => o.status === 'applied' || o.status === 'rejected') : [];
  const applied = entries.filter((o) => o.status === 'applied').length;

  return (
    <section className={open ? 'changelog open' : 'changelog'} aria-label={t.t('log.label')}>
      <div className="changelog-bar">
        <button className="quiet" onClick={onToggle} aria-expanded={open}>
          {open ? '▾' : '▸'} {t.t('log.toggle', { count: applied })}
        </button>
        <button disabled={!session} onClick={() => void controller.exportReport()}>
          {t.t('log.export')}
        </button>
      </div>
      {open && (
        <ol className="entries">
          {entries.length === 0 && <li className="hint">{t.t('log.empty')}</li>}
          {rowsOf(entries).map((row) =>
            'batch' in row ? <BatchRow key={row.batch} controller={controller} batch={row.batch} outcomes={row.outcomes} /> : <ChangeRow key={row.outcome.candidate.id} controller={controller} o={row.outcome} />,
          )}
        </ol>
      )}
    </section>
  );
}

/** The change itself: the document's English text, struck through and inserted. */
function Change({ o }: { o: Outcome }) {
  const t = useT();
  return (
    <span className="change">
      <del lang="en">{o.candidate.original || '·'}</del> → {o.replacement === '' ? <ins>{t.t('log.deleted')}</ins> : <ins lang="en">{o.replacement}</ins>}
    </span>
  );
}

function ChangeRow({ controller, o }: { controller: SessionController; o: Outcome }) {
  const t = useT();
  return (
    <li className={o.status}>
      <span className="where">{t.t('log.paragraph', { number: o.paragraphNumber })}</span>
      <Change o={o} />
      <span className="status">
        {kindLabel(t, o.candidate.kind)} · {statusLabel(t, o)}
      </span>
      {o.status === 'applied' && <button onClick={() => controller.undo(o.candidate.id)}>{t.t('log.undo')}</button>}
      {/* A word in the dictionary stays unflagged until it is removed in Settings, so "Review again" would not hold. */}
      {o.status === 'rejected' && o.unplaceable === undefined && !o.reason?.endsWith('added to dictionary') && (
        <button className="quiet" onClick={() => controller.undo(o.candidate.id)}>
          {t.t('log.reviewAgain')}
        </button>
      )}
    </li>
  );
}

function BatchRow({ controller, batch, outcomes }: { controller: SessionController; batch: string; outcomes: Outcome[] }) {
  const t = useT();
  const paragraphs = [...new Set(outcomes.map((o) => t.t('log.paragraph', { number: o.paragraphNumber })))].join(' ');
  // The simple-fixes card applies several kinds at once: name each (Task F4).
  const kinds = [...new Set(outcomes.map((o) => kindLabel(t, o.candidate.kind)))].join(', ');
  return (
    <li className="applied batch">
      <span className="where">{paragraphs}</span>
      {/* Every change the batch made, not only the first: they are undone together (F4 re-review 3, M-7). */}
      <span className="changes">
        {outcomes.map((o) => (
          <Change key={o.candidate.id} o={o} />
        ))}
      </span>
      <span className="status">{t.t('log.batchStatus', { count: outcomes.length, kind: kinds })}</span>
      <button onClick={() => controller.undoBatch(batch)}>{t.t('log.undoAll', { count: outcomes.length })}</button>
    </li>
  );
}
