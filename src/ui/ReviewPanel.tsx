import { useEffect, useRef, useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { uncheckedText } from '@/engine/uncheckedScripts';
import { AiGroup } from './AiGroup';
import { DecisionCard } from './DecisionCard';
import { DepthSlider } from './DepthSlider';
import { Kbd } from './Kbd';
import { MoreList } from './MoreList';
import { NamesCard } from './NamesCard';
import { OtherLanguageCard } from './OtherLanguageCard';
import { TermsCard } from './TermsCard';
import { ReadAloudBar } from './ReadAloudBar';
import { translatorFor } from './i18n/translatorFor';
import { useT } from './i18n/useT';
import { cardLabel } from './state/announce';
import { isWordCard } from './state/labels';
import { progressLabel, progressOf } from './state/progress';
import { paragraphAt, sentenceAt, suggestionSpeech, type ReadTarget } from './state/readAloud';
import { cursorAt, currentDecision, decisionWith, moveCursor, START } from './state/reviewCursor';
import type { ReviewKeyAction } from './state/reviewKeys';
import type { ControllerState, SessionController } from './state/sessionController';
import { useReviewKeys } from './useKeys';
import type { ReadAloud } from './useReadAloud';

/** A request to bring up the card of a clicked underline; `seq` changes on every click. */
export interface CardRequest {
  candidateId: string;
  seq: number;
  /** Move keyboard focus to the card (Ctrl+. in the text); by default only in a read-only document. */
  focus?: boolean;
}

/** The document text and cursor position while the user is in the text, for "Read sentence". */
export interface CaretText {
  text: string;
  offset: number;
}

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Shows a candidate in the document view (outlined and scrolled into view). */
  onLocate(candidate: Candidate): void;
  request: CardRequest | null;
  /** False while a dialog is open: the review keys must not act behind it. */
  keysEnabled: boolean;
  onShowLog(): void;
  onSave(): void;
  /** Null hides read aloud (no local voice). */
  readAloud: ReadAloud | null;
  /** The text at the cursor while the document has focus, else null (read the card's text instead). */
  readCaret(): CaretText | null;
  /** "Look up" on a card; absent while word lookup is off. */
  onLookUp?: (words: string[]) => void;
}


const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The review queue: a progress header, one card at a time (Enter / Backspace / J / K), the rest under "More (N)". */
export function ReviewPanel({ controller, state, onLocate, request, keysEnabled, onShowLog, onSave, readAloud, readCaret, onLookUp }: Props) {
  const t = useT();
  const [cursor, setCursor] = useState(START);
  /**
   * Set when a card is picked from "More" or its underline clicked: the panel scrolls to the card and,
   * with `focus`, moves keyboard focus to it (not after a click in editable text: the caret stays there).
   */
  const [reveal, setReveal] = useState<{ seq: number; focus: boolean }>({ seq: 0, focus: false });
  const cardSlot = useRef<HTMLDivElement>(null);
  const session = state.session;
  const { top, more } = session ? session.decisions() : { top: [], more: [] };
  const current = currentDecision(top, more, cursor);
  const candidates = new Map((session?.candidates() ?? []).map((c) => [c.id, c]));
  const firstOf = (d: Decision) => candidates.get(d.candidateIds[0])!;

  // The current card's text is outlined in the document. When the decided card's button took the focus
  // with it (focus fell back to the page), it returns to the card slot so Enter-Enter-Enter keeps going.
  useEffect(() => {
    if (!current) return;
    onLocate(firstOf(current));
    const active = document.activeElement;
    if (!active || active === document.body) cardSlot.current?.focus({ preventScroll: true });
  }, [current?.id]);

  useEffect(() => {
    if (!request) return;
    const d = decisionWith(top, more, request.candidateId);
    if (!d) return;
    setCursor((c) => cursorAt(top, d.id, c));
    setReveal((r) => ({ seq: r.seq + 1, focus: request.focus ?? !state.document?.editable }));
  }, [request?.seq]);

  // "Improve this sentence" came back with a suggestion: bring up its card (focus as for a clicked underline).
  const ready = state.ai.ready;
  useEffect(() => {
    if (!ready) return;
    const d = decisionWith(top, more, ready.candidateId);
    if (!d) return;
    setCursor((c) => cursorAt(top, d.id, c));
    setReveal((r) => ({ seq: r.seq + 1, focus: !state.document?.editable }));
  }, [ready?.seq]);

  useEffect(() => {
    if (reveal.seq === 0) return;
    cardSlot.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (reveal.focus) cardSlot.current?.focus({ preventScroll: true });
  }, [reveal.seq]);

  useReviewKeys(keysEnabled && session !== null, state.document?.editable ?? false, (action: ReviewKeyAction) => {
    if (action === 'next' || action === 'previous') {
      setCursor((c) => moveCursor(top, more, c, action === 'next' ? 1 : -1));
      return;
    }
    cardSlot.current?.querySelector<HTMLButtonElement>(`[data-key~="${action}"]`)?.click();
  });

  if (!session) {
    return (
      <aside className="review">
        <p className="hint">{state.opening ? t.t('panel.opening') : state.phase === 'checking' ? t.t('panel.checking') : t.t('panel.emptyHint')}</p>
      </aside>
    );
  }

  const paraText = new Map(session.paragraphs().map((p) => [p.id, p.text]));
  const progress = progressOf(session, state.decided);
  const aiOn = controller.ai.available();
  /** Every fix in the text now, automatic or accepted. */
  const fixesApplied = session.outcomes().filter((o) => o.status === 'applied').length;
  /** Nothing left to decide: the panel says so in one line. */
  const allClear = !current && progress.left === 0;
  /** Text in another script the English-only check skipped: never an all-clear for a document that is mostly that. */
  const unchecked = uncheckedText(session.paragraphs());
  const englishOnly = unchecked.paragraphs > 0 ? t.t('panel.englishOnly') : null;
  const doneLine = unchecked.mostly ? englishOnly : t.t('panel.allClear', { count: fixesApplied });
  const pick = (d: Decision) => {
    setCursor((c) => cursorAt(top, d.id, c));
    setReveal((r) => ({ seq: r.seq + 1, focus: true }));
  };
  const queue = [...top, ...more];
  // The queue holds every open card, so its length is the "left" of the announcements (tracked-change rows aside).
  const slotLabel = current ? cardLabel(t, current, candidates, queue.indexOf(current) + 1, queue.length) : t.t('panel.currentCard');
  // Read aloud: the text at the cursor while the user is in the document, else the current card's.
  // The card is read in the UI language when this PC has a local voice for it, else in English.
  const textFor = (target: ReadTarget): { text: string; language: string } => {
    const first = current ? firstOf(current) : null;
    if (target === 'suggestion') {
      const speaker = readAloud?.speaks(t.language) ? t : translatorFor('en');
      return { text: current ? suggestionSpeech(speaker, current, candidates) : '', language: speaker.language };
    }
    // The document's own text is English.
    const at = readCaret() ?? (first ? { text: paraText.get(first.paraId) ?? '', offset: first.span.start } : null);
    if (!at) return { text: '', language: 'en' };
    return { text: target === 'sentence' ? sentenceAt(at.text, at.offset) : paragraphAt(at.text, at.offset), language: 'en' };
  };

  return (
    // tabIndex -1: a click on the panel's background keeps focus in the panel, so the review keys work.
    <aside className="review" aria-label={t.t('panel.label')} tabIndex={-1}>
      <header>
        {/* Not a live region: the app's announcer says "Accepted. 4 of 9 left." once per decision. */}
        {allClear ? (
          // Done: one calm line, and no depth controls, since there is nothing left to show more or less of.
          <h2>{doneLine}</h2>
        ) : (
          <>
            <h2>{progressLabel(t, progress)}</h2>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${progress.total ? ((progress.total - progress.left) / progress.total) * 100 : 100}%` }} />
            </div>
            <DepthSlider value={session.depth} onChange={(d) => controller.setDepth(d)} />
          </>
        )}
        {englishOnly && doneLine !== englishOnly && <p className="hint english-only">{englishOnly}</p>}
      </header>

      <div ref={cardSlot} className="card-slot" role="group" tabIndex={-1} aria-label={slotLabel}>
        {current && cardFor(current)}
      </div>
      {readAloud && <ReadAloudBar readAloud={readAloud} textFor={textFor} keysEnabled={keysEnabled} />}
      {current ? (
        <p className="key-legend hint">
          <Kbd>Enter</Kbd> {isWordCard(current) ? t.t('panel.keyAdd') : t.t('panel.keyAccept')} ·{' '}
          {!isWordCard(current) && (
            <>
              <Kbd>Backspace</Kbd> {t.t('panel.keyReject')} ·{' '}
            </>
          )}
          <Kbd>J</Kbd> / <Kbd>K</Kbd> {t.t('panel.keyNextPrevious')}
        </p>
      ) : (
        <div className="done-state">
          <div className="actions">
            <button onClick={onShowLog}>{t.t('panel.seeLog')}</button>
            <button className="primary" onClick={onSave}>
              {t.t('save.button')}
            </button>
          </div>
        </div>
      )}

      {aiOn && <AiGroup controller={controller} state={state} session={session} paraText={paraText} />}
      <MoreList more={more} currentId={current?.id} candidates={candidates} onPick={pick} />
    </aside>
  );

  function cardFor(d: Decision) {
    if (d.kind === 'names') return <NamesCard key={d.id} controller={controller} card={d as Decision & { kind: 'names' }} candidates={candidates} />;
    if (d.kind === 'terms') return <TermsCard key={d.id} controller={controller} card={d as Decision & { kind: 'terms' }} candidates={candidates} />;
    if (d.kind === 'otherLanguage')
      return <OtherLanguageCard key={d.id} controller={controller} card={d as Decision & { kind: 'otherLanguage' }} candidates={candidates} />;
    return (
      <DecisionCard
        key={d.id}
        controller={controller}
        session={session!}
        checking={state.checking}
        textChanges={state.textChanges}
        decision={d}
        candidates={candidates}
        paraText={paraText}
        touchesLocked={d.candidateIds.some((id) => session!.touchesLocked(id))}
        onNext={() => setCursor((c) => moveCursor(top, more, c, 1))}
        onLocate={onLocate}
        onLookUp={onLookUp}
        onImprove={aiOn ? (c) => controller.ai.improveSentence(c.paraId, c.span.start) : undefined}
      />
    );
  }
}
