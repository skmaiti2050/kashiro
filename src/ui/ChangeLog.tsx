import { useEffect, useId, useRef, useState } from 'react';
import type { Outcome } from '@/engine/session';
import type { Span } from '@/engine/types';
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
  /**
   * Bumped each time something asks to show the log ("See the change log"): it takes focus, scrolls into view and
   * is highlighted for a moment, open or not before (Task F20 item 8). 0: never asked.
   */
  reveals?: number;
}

/** How long "See the change log" highlights the log. */
const REVEAL_MS = 1600;

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
export function ChangeLog({ controller, state, open, onToggle, reveals = 0 }: Props) {
  const t = useT();
  const session = state.session;
  const toggle = useRef<HTMLButtonElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (reveals === 0) return;
    const button = toggle.current;
    button?.focus();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    button?.closest('.changelog')?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    setRevealed(true);
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [reveals]);
  const entries = session ? session.outcomes().filter((o) => o.status === 'applied' || o.status === 'rejected') : [];
  const applied = entries.filter((o) => o.status === 'applied').length;
  // The paragraphs as read: every change's span is in their offsets.
  const paraText = new Map(open && session ? session.paragraphs().map((p) => [p.id, p.text]) : []);

  return (
    <section className={['changelog', open && 'open', revealed && 'reveal'].filter(Boolean).join(' ')} aria-label={t.t('log.label')}>
      <div className="changelog-bar">
        <button ref={toggle} className="quiet" onClick={onToggle} aria-expanded={open}>
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
            'batch' in row ? (
              <BatchRow key={row.batch} controller={controller} batch={row.batch} outcomes={row.outcomes} paraText={paraText} />
            ) : (
              <ChangeRow key={row.outcome.candidate.id} controller={controller} o={row.outcome} text={paraText.get(row.outcome.candidate.paraId)} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

/** Characters of the paragraph shown on each side of a change, before cutting to whole words (F5 re-review 4, M-6). */
const CONTEXT_CHARS = 12;
const SPACE = /\s/u;
const SPACES = /\s+/gu;
/** The rest of a word the cut started inside ("ks" of "works"), and the start of one it ended inside. */
const PARTIAL_WORD_AT_START = /^\S*/u;
const PARTIAL_WORD_AT_END = /\S*$/u;

/** A few words of `text` on each side of `span`, cut at whole words, with "…" where cut, on one line. */
function contextOf(text: string, { start, end }: Span): { before: string; after: string } {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  let before = text.slice(from, start);
  let after = text.slice(end, to);
  if (from > 0) {
    if (!SPACE.test(text[from - 1])) before = before.replace(PARTIAL_WORD_AT_START, '');
    before = `…${before.trimStart()}`;
  }
  if (to < text.length) {
    if (!SPACE.test(text[to])) after = after.replace(PARTIAL_WORD_AT_END, '');
    after = `${after.trimEnd()}…`;
  }
  // Named before spaces are collapsed: "\s" also matches U+FEFF.
  return { before: namedContext(before).replace(SPACES, ' '), after: namedContext(after).replace(SPACES, ' ') };
}

/** The Indic scripts of India: a ZWJ or ZWNJ between two characters of one of them shapes the word (a conjunct). */
const INDIC_SCRIPTS = [
  /\p{Script=Devanagari}/u,
  /\p{Script=Bengali}/u,
  /\p{Script=Gurmukhi}/u,
  /\p{Script=Gujarati}/u,
  /\p{Script=Oriya}/u,
  /\p{Script=Tamil}/u,
  /\p{Script=Telugu}/u,
  /\p{Script=Kannada}/u,
  /\p{Script=Malayalam}/u,
];
const ZWNJ = '\u{200C}';
const ZWJ = '\u{200D}';

/** True when `text[i]` is a ZWJ or ZWNJ inside a word of one Indic script, as hygiene keeps it. */
function isIndicJoiner(text: string, i: number): boolean {
  if (text[i] !== ZWJ && text[i] !== ZWNJ) return false;
  const [before, after] = [text[i - 1] ?? '', text[i + 1] ?? ''];
  return INDIC_SCRIPTS.some((script) => script.test(before) && script.test(after));
}

/**
 * The context `text` named like the change, except a joiner inside a Hindi or Bengali word: drawn as the real
 * character, so the word reads right and a screen reader doesn't read "U+200D" (F7 re-review 6, M-3).
 */
function namedContext(text: string): string {
  return text.replace(INVISIBLE, (ch: string, at: number) => (isIndicJoiner(text, at) ? ch : nameOf(ch)));
}

/** How whitespace at a change's edge is drawn, so a spacing fix isn't blank: "··" → "·", " ," → ", ". */
const WHITESPACE_SIGNS: Record<string, string> = { ' ': '·', '\t': '⇥', '\n': '↵' };
/** Whitespace at the start or end: "  " in "  ", " " in " ,"; not the space in "of of". */
const EDGE_WHITESPACE = /^\s+|\s+$/gu;
const ONLY_WHITESPACE = /^\s+$/u;
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** An invisible or direction character's name: "‹U+200B›". */
function nameOf(ch: string): string {
  return `‹U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}›`;
}

/** `text` with invisible and direction characters named ("‹U+200B›", "‹U+202E›"), so none acts unseen. */
function named(text: string): string {
  return text.replace(INVISIBLE, nameOf);
}

/** `text` named, and the whitespace at its edges drawn as signs. */
function drawn(text: string): string {
  return named(text).replace(EDGE_WHITESPACE, (run) => [...run].map((ch) => WHITESPACE_SIGNS[ch] ?? '·').join(''));
}

const DEVANAGARI = /\p{Script=Devanagari}/u;
const BENGALI = /\p{Script=Bengali}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * The language a piece of the document is read in by a screen reader: Hindi for Devanagari, Bengali for Bengali
 * script (the Indian languages Kashiro knows), English for Latin letters, and none for the rest (F6 re-review 5, M-5).
 */
function languageOf(text: string): 'hi' | 'bn' | 'en' | undefined {
  if (DEVANAGARI.test(text)) return 'hi';
  if (BENGALI.test(text)) return 'bn';
  return LATIN.test(text) ? 'en' : undefined;
}

/**
 * Changed text as drawn, isolated (<bdi>) so a right-to-left letter can't reorder the row; a run of only whitespace
 * is also named for screen readers ("2 spaces").
 */
function Drawn({ text }: { text: string }) {
  const t = useT();
  if (!ONLY_WHITESPACE.test(text)) return <bdi lang={languageOf(text)}>{drawn(text)}</bdi>;
  return (
    <>
      <bdi aria-hidden="true">{drawn(text)}</bdi>
      <span className="visually-hidden">{t.t('log.spaces', { count: [...text].length })}</span>
    </>
  );
}

/**
 * The change itself in a few words of its paragraph, struck through and inserted. Each piece is isolated (<bdi>),
 * so a direction character or right-to-left letter in the context can't reorder the row (F6 re-review 5, M-5).
 */
function Change({ o, text }: { o: Outcome; text: string | undefined }) {
  const t = useT();
  const { before, after } = text === undefined ? { before: '', after: '' } : contextOf(text, o.candidate.span);
  return (
    <span className="change">
      <bdi className="context" lang={languageOf(before)}>{before}</bdi>
      {/* "‸": nothing was there, the fix inserts. */}
      <del>{o.candidate.original === '' ? <bdi>‸</bdi> : <Drawn text={o.candidate.original} />}</del> →{' '}
      <ins>{o.replacement === '' ? <bdi>{t.t('log.deleted')}</bdi> : <Drawn text={o.replacement ?? ''} />}</ins>
      <bdi className="context" lang={languageOf(after)}>{after}</bdi>
    </span>
  );
}

/** Where a change is: "P 226", named in full on hover and to screen readers ("Paragraph 226", Task F20 item 3). */
function Where({ number }: { number: number }) {
  const t = useT();
  const full = t.t('log.paragraphFull', { number });
  return (
    <span className="where" title={full} aria-label={full}>
      {t.t('log.paragraph', { number })}
    </span>
  );
}

function ChangeRow({ controller, o, text }: { controller: SessionController; o: Outcome; text: string | undefined }) {
  const t = useT();
  return (
    <li className={o.status}>
      <Where number={o.paragraphNumber} />
      <Change o={o} text={text} />
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

/**
 * Every change of one "Apply all" (F4 re-review 3, M-7), collapsed under a header: hundreds of them in one wrapped
 * block could not be read (Task F20 item 2). Opened, each change has its own line and Undo; an undone change leaves
 * the batch and comes back as its own row.
 */
function BatchRow({ controller, batch, outcomes, paraText }: { controller: SessionController; batch: string; outcomes: Outcome[]; paraText: ReadonlyMap<number, string> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const listId = useId();
  // The simple-fixes card applies several kinds at once: name each (Task F4).
  const kinds = [...new Set(outcomes.map((o) => kindLabel(t, o.candidate.kind)))].join(', ');
  return (
    <li className="applied batch">
      <div className="batch-head">
        <span className="status">{t.t('log.batchStatus', { count: outcomes.length, kind: kinds })}</span>
        <span className="batch-actions">
          <button className="quiet batch-toggle" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)}>
            {open ? t.t('log.hideChanges') : t.t('log.showChanges', { count: outcomes.length })} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
          </button>
          <button onClick={() => controller.undoBatch(batch)}>{t.t('log.undoAll', { count: outcomes.length })}</button>
        </span>
      </div>
      {open && (
        <ol className="batch-changes" id={listId}>
          {outcomes.map((o) => (
            <li key={o.candidate.id}>
              <Where number={o.paragraphNumber} />
              <Change o={o} text={paraText.get(o.candidate.paraId)} />
              <span className="status">{kindLabel(t, o.candidate.kind)}</span>
              <button onClick={() => controller.undo(o.candidate.id)}>{t.t('log.undo')}</button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
