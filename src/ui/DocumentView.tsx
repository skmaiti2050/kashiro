import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import type { Decision } from '@/engine/decisions';
import { EmptyState } from './EmptyState';
import { QuickFixPopover, type WordBox } from './QuickFixPopover';
import { decisionWith } from './state/reviewCursor';
import type { CaretText } from './ReviewPanel';
import { CATEGORIES } from './state/categories';
import { highlightRanges, locateCandidate, paragraphAt, toEditorPosition } from './state/highlights';
import type { Translator } from './i18n/translator';
import { useT } from './i18n/useT';
import { explanation } from './state/plainMessages';
import type { ControllerState, OpenDocument, SessionController } from './state/sessionController';
import type { RecentReview } from './state/sessionStore';
import { caretPosition, wordAtSelection } from './editorWords';
import { useImproveKey, useLookUpKey } from './useKeys';
import { findInDocument, findPhrases, openFind } from './findInDocument';
import { useTextMenu } from './useTextMenu';

/** The replacement text of an applied edit, shown right after the struck-through original. */
class ReplacementWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly auto: boolean,
  ) {
    super();
  }

  eq(other: ReplacementWidget): boolean {
    return other.text === this.text && other.auto === this.auto;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = this.auto ? 'cm-new cm-new-auto' : 'cm-new';
    el.textContent = this.text;
    return el;
  }
}

const setMarks = StateEffect.define<DecorationSet>();

/** The highlights; between checks they move with the user's typing. */
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) if (effect.is(setMarks)) return effect.value;
    return marks.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const setFocusMark = StateEffect.define<DecorationSet>();

/** The review item the user clicked, outlined in the text. */
const focusField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) if (effect.is(setFocusMark)) return effect.value;
    return marks.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const FOCUS_MARK = Decoration.mark({ class: 'cm-focus' });

/**
 * Decorations for the session's state: applied edits (auto-fixes subtle) as old text struck through
 * plus the new text, pending decisions underlined. Null while the view shows text the session has not
 * checked yet.
 */
function documentMarks(t: Translator, doc: OpenDocument, viewText: string, session: CheckSession): DecorationSet | null {
  const highlights = highlightRanges(doc, viewText, session);
  if (!highlights) return null;
  const at = toEditorPosition(doc.text, doc.lineSeparator);
  const ranges: Range<Decoration>[] = [];
  for (const h of highlights) {
    const from = at(h.from);
    const to = at(h.to);
    if (h.kind === 'pending') {
      const category = h.category ?? 'correctness';
      // The tooltip shows the glyph; the spoken description leaves it out ("black circle" says nothing).
      const description = t.t('doc.flag', { category: t.t(CATEGORIES[category].label), explanation: h.flag ? t.format(explanation(h.flag)) : '' });
      const title = `${CATEGORIES[category].glyph} ${description}`;
      const mark = Decoration.mark({ class: `cm-pending cat-${category}`, attributes: { title }, candidateId: h.candidateId, description });
      ranges.push(mark.range(from, to));
      continue;
    }
    const auto = h.kind === 'auto';
    if (to > from) ranges.push(Decoration.mark({ class: auto ? 'cm-old cm-old-auto' : 'cm-old' }).range(from, to));
    if (h.replacement) ranges.push(Decoration.widget({ widget: new ReplacementWidget(h.replacement, auto), side: 1 }).range(to));
  }
  return Decoration.set(ranges, true);
}

/** A review item to show; `seq` changes on every click, so clicking the same item again scrolls again. */
export interface DocumentFocus {
  candidate: Candidate;
  seq: number;
}

/** A pending flag's underline: its candidate, its spoken "Correctness: message" description, and where it is. */
interface FlagMark {
  candidateId: string;
  description: string;
  from: number;
  to: number;
}

/** The pending flag whose underline covers `pos`, from the marks' `candidateId` and `description`. */
function flagAt(state: EditorState, pos: number): FlagMark | null {
  let found: FlagMark | null = null;
  state.field(marksField).between(pos, pos, (from, to, mark) => {
    const { candidateId, description } = mark.spec as Partial<FlagMark>;
    if (typeof candidateId !== 'string' || pos < from || pos > to) return;
    found = { candidateId, description: description ?? '', from, to };
    return false;
  });
  return found;
}

/** The pending flag whose underline was clicked. */
function flagClicked(view: EditorView, event: MouseEvent): FlagMark | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  return pos === null ? null : flagAt(view.state, pos);
}

/** The box of the text from `from` to `to`, relative to the document pane; the pane's corner when it can't be measured. */
function wordBox(view: EditorView, from: number, to: number): WordBox {
  const pane = view.dom.closest('.document')?.getBoundingClientRect();
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  if (!pane || !start) return { left: 0, top: 0, width: 0, height: 0 };
  // A word wrapped onto the next line: the box covers its first line.
  const right = end && end.top === start.top ? end.right : start.right;
  return { left: start.left - pane.left, top: start.top - pane.top, width: Math.max(0, right - start.left), height: start.bottom - start.top };
}

/** The element that describes the flag under the cursor (aria-describedby of the text, and a polite live region). */
const FLAG_AT_CURSOR_ID = 'flag-at-cursor';

/**
 * The editor's own words (placeholder, name): reconfigured when the UI language changes. The text itself is
 * English (lang="en"), so screen readers and the browser read it as English in any UI language, and left to
 * right (dir="ltr") even in a right-to-left UI.
 */
function editorLabels(t: Translator) {
  return [
    placeholder(t.t('doc.placeholder')),
    findPhrases(t),
    EditorView.contentAttributes.of({ 'aria-label': t.t('doc.textLabel'), 'aria-describedby': FLAG_AT_CURSOR_ID, lang: 'en', dir: 'ltr' }),
  ];
}

/** Room kept around a scrolled-to underline, so it never sits flush against the pane's edges. */
const SCROLL_MARGINS = { top: 32, bottom: 32 };

interface Props {
  controller: SessionController;
  state: ControllerState;
  focus: DocumentFocus | null;
  /**
   * Clicking an underline brings up its card. `focusCard` (CardRequest.focus): true for Ctrl+. on it, false when its
   * quick fix opened, undefined for the default.
   */
  onUnderlineClick(candidateId: string, focusCard: boolean | undefined): void;
  onOpen(): void;
  onPaste(): void;
  onSample(): void;
  /** A row of the start screen's Recent reviews. */
  onOpenRecent(review: RecentReview): void;
  /** Set to a reader of the text at the cursor while the text has focus (for "Read sentence"). */
  caretReader: MutableRefObject<() => CaretText | null>;
  /** Ctrl+D, and right-click → Look up in read-only text; null while word lookup is off or a dialog is open. */
  onLookUp: ((word: string) => void) | null;
  /** AI rewrites are on and no dialog is open: Ctrl+I and right-click → "Improve this sentence". */
  aiOn: boolean;
  /** Set to "Improve this sentence" at the cursor, for the toolbar's button. */
  improveAtCaret: MutableRefObject<() => void>;
  /** Set to "Look up" of the selected word or the word at the cursor (the ⋯ menu); false when there is none. */
  lookUpAtCaret: MutableRefObject<() => boolean>;
  /** Bumped to open Find (Ctrl+F outside the text, the command palette); 0 asks for nothing. */
  findRequest: number;
}

/** CodeMirror view of the document: read-only for .docx, editable (and re-checked as you type) for text. */
export function DocumentView({
  controller,
  state,
  focus,
  onUnderlineClick,
  onOpen,
  onPaste,
  onSample,
  onOpenRecent,
  caretReader,
  onLookUp,
  aiOn,
  improveAtCaret,
  lookUpAtCaret,
  findRequest,
}: Props) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const labels = useRef(new Compartment());
  const underlineClick = useRef(onUnderlineClick);
  const lookUp = useRef(onLookUp);
  /** "Improve this sentence" at a position in the text; null while AI rewrites are off. Read by the editor's handlers. */
  const improve = useRef<((position: number | null) => void) | null>(null);
  useEffect(() => {
    underlineClick.current = onUnderlineClick;
    lookUp.current = onLookUp;
    improve.current = aiOn ? improveAt : null;
    improveAtCaret.current = () => improveAt(view.current && caretPosition(view.current));
  });
  const { openTextMenu, textMenu } = useTextMenu(lookUp, improve, controller);
  /** The flag under the cursor, read out when the cursor moves onto it. */
  const [flagAtCursor, setFlagAtCursor] = useState('');
  const spokenFlag = useRef('');
  /** The underline whose quick fix is open (F23 item 5), with the element that had focus before it. */
  const [quickFix, setQuickFix] = useState<{ candidateId: string; at: WordBox; returnTo: Element | null; takeFocus: boolean } | null>(null);
  const doc = state.document;
  // Any change to the text or a new check moves the words: the popover goes.
  useEffect(() => setQuickFix(null), [state.textChanges, state.session]);

  // A new editor per opened document; typing goes to the controller, which re-checks after a pause.
  useEffect(() => {
    if (!doc || !host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          marksField,
          focusField,
          // The file's own line break, so sliceDoc() gives back CRLF text unchanged (doc.toString() is always LF).
          EditorState.lineSeparator.of(doc.lineSeparator),
          EditorView.lineWrapping,
          EditorView.editable.of(doc.editable),
          EditorState.readOnly.of(!doc.editable),
          history(),
          // Before the default keymap, whose Escape would only collapse the selection.
          findInDocument,
          keymap.of([
            { key: 'Mod-.', run: showCardAtCursor },
            { key: 'Alt-Enter', run: quickFixAtCursor },
            { key: 'Mod-i', run: improveAtCursor },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          labels.current.of(editorLabels(t)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) controller.editText(update.state.sliceDoc());
            // New marks from a re-check can add or remove the flag under a caret that did not move.
            const marksChanged = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setMarks)));
            if (update.docChanged || update.selectionSet || update.focusChanged || marksChanged) {
              const flag = update.view.hasFocus ? flagAt(update.state, update.state.selection.main.head) : null;
              const description = flag?.description ?? '';
              // Only when it changes: no re-render on every keystroke.
              if (description !== spokenFlag.current) setFlagAtCursor((spokenFlag.current = description));
            }
          }),
          EditorView.scrollMargins.of(() => SCROLL_MARGINS),
          EditorView.domEventHandlers({
            click(event, editor) {
              const flag = flagClicked(editor, event);
              if (!flag) return false;
              const opened = openQuickFix(editor, flag, false);
              underlineClick.current(flag.candidateId, opened ? false : undefined);
              return false;
            },
            contextmenu: openTextMenu,
          }),
        ],
      }),
    });
    view.current = editor;
    // The quick fix sits next to its word: scrolling the text away from it closes it.
    const closeQuickFix = () => setQuickFix(null);
    editor.scrollDOM.addEventListener('scroll', closeQuickFix);
    // Positions count a line break as one character, as doc.toString() (LF) does; sliceDoc() may be CRLF.
    caretReader.current = () => (editor.hasFocus ? { text: editor.state.doc.toString(), offset: editor.state.selection.main.head } : null);
    if (doc.editable) editor.focus();
    return () => {
      editor.scrollDOM.removeEventListener('scroll', closeQuickFix);
      setQuickFix(null);
      editor.destroy();
      view.current = null;
      caretReader.current = () => null;
    };
    // Keyed on the document id, not its text: the editor's own edits flow out through editText.
  }, [doc?.id, controller]);

  useEffect(() => {
    view.current?.dispatch({ effects: labels.current.reconfigure(editorLabels(t)) });
  }, [t]);

  // Runs after the effects of a closing dialog (the command palette), so its focus return doesn't undo this.
  useEffect(() => {
    if (findRequest && view.current) openFind(view.current);
  }, [findRequest]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !doc || !state.session) return;
    const marks = documentMarks(t, doc, editor.state.sliceDoc(), state.session);
    if (marks) editor.dispatch({ effects: setMarks.of(marks) });
  }, [state.revision, state.session, doc, t]);

  // The current card's text gets a focus ring and is scrolled to the upper third of the pane, except
  // while the user is typing in it: then the view stays where the caret is.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !doc || !state.session || !focus) return;
    const at = locateCandidate(doc, editor.state.sliceDoc(), state.session, focus.candidate);
    if (!at) return;
    const position = toEditorPosition(doc.text, doc.lineSeparator);
    const from = position(at.from);
    const to = position(at.to);
    const ring = setFocusMark.of(to > from ? Decoration.set([FOCUS_MARK.range(from, to)]) : Decoration.none);
    const scroll = EditorView.scrollIntoView(from, { y: 'start', yMargin: editor.scrollDOM.clientHeight / 3 });
    editor.dispatch({ effects: editor.hasFocus ? [ring] : [ring, scroll] });
    // Only a new card or click moves the view; re-renders from checks don't.
  }, [focus?.seq]);

  /** Looks up the selected word or the word at the cursor; false when there is none (Ctrl+D then does nothing). */
  const lookUpAtCursor = () => {
    const word = view.current ? wordAtSelection(view.current) : null;
    if (word) lookUp.current?.(word);
    return word !== null;
  };
  useEffect(() => {
    lookUpAtCaret.current = lookUpAtCursor;
  });
  useLookUpKey(onLookUp !== null && doc !== null, lookUpAtCursor);

  // Ctrl+I outside the text (the panel, the toolbar); inside it, the editor's keymap answers first.
  useImproveKey(aiOn && doc !== null, () => improveAtCaret.current());

  // Visual only: the screen reader hears "Checking document…" and the result from the app's announcements.
  const busy = state.opening ? t.t('doc.opening', { name: state.opening }) : state.phase === 'checking' ? t.t('panel.checking') : null;
  const busyLine = busy && (
    <p className="busy" aria-hidden="true">
      {busy}
    </p>
  );
  if (!doc && busyLine) return <section className="document empty">{busyLine}</section>;
  if (!doc) {
    return (
      <EmptyState onOpen={onOpen} onPaste={onPaste} onSample={onSample} recent={state.recentReviews} onOpenRecent={onOpenRecent} lookUp={onLookUp !== null} />
    );
  }
  return (
    <section className="document" aria-label={doc.name}>
      {busyLine}
      {doc.note && <p className="note">{t.format(doc.note)}</p>}
      <div className="editor" ref={host} />
      <p id={FLAG_AT_CURSOR_ID} className="visually-hidden" aria-live="polite">
        {flagAtCursor}
      </p>
      {textMenu}
      {quickFixPopover()}
    </section>
  );

  /** The open quick fix, while its card is still a single card waiting for a decision. */
  function quickFixPopover() {
    const open = quickFix;
    const session = state.session;
    if (!open || !session) return null;
    const decision = quickFixDecision(open.candidateId);
    const candidate = session.candidates().find((c) => c.id === open.candidateId);
    if (!decision || !candidate) return null;
    const close = (returnFocus: boolean) => {
      setQuickFix(null);
      if (!returnFocus) return;
      if (open.returnTo instanceof HTMLElement && open.returnTo.isConnected) open.returnTo.focus();
      else view.current?.focus();
    };
    return (
      <QuickFixPopover key={open.candidateId} controller={controller} decision={decision} candidate={candidate} at={open.at} takeFocus={open.takeFocus} onClose={close} />
    );
  }

  /** The single card holding `candidateId`; null for a batch (the simple-fixes card too) or the word cards. */
  function quickFixDecision(candidateId: string): Decision | null {
    const decisions = controller.getState().session?.decisions();
    const decision = decisions && decisionWith(decisions.top, decisions.more, candidateId);
    return decision && decision.kind === 'single' ? decision : null;
  }

  /**
   * Opens the quick fix of `flag`'s underline, when its card is a single one. Only the keyboard opener moves focus
   * into it (`takeFocus`); after a click, focus stays where it was (Task F24, F23 review I-6).
   */
  function openQuickFix(editor: EditorView, flag: FlagMark, takeFocus: boolean): boolean {
    if (!quickFixDecision(flag.candidateId)) return false;
    setQuickFix({ candidateId: flag.candidateId, at: wordBox(editor, flag.from, flag.to), returnTo: document.activeElement, takeFocus });
    return true;
  }

  /** Alt+Enter in the text: the quick fix of the underline at the cursor, and its card in the panel. */
  function quickFixAtCursor(editor: EditorView): boolean {
    const flag = flagAt(editor.state, editor.state.selection.main.head);
    if (!flag) return false;
    const opened = openQuickFix(editor, flag, true);
    underlineClick.current(flag.candidateId, opened ? false : undefined);
    return true;
  }

  /** "Improve this sentence" for the sentence at `position` (a CodeMirror position), or says why there is none. */
  function improveAt(position: number | null): void {
    const editor = view.current;
    const session = state.session;
    if (!editor || !doc || !session || position === null) return controller.ai.noSentenceAtCursor('noCaret');
    const at = paragraphAt(doc, editor.state.sliceDoc(), session, position);
    if (!at) return controller.ai.noSentenceAtCursor('waitForCheck');
    controller.ai.improveSentence(at.paraId, at.offset);
  }

  /** Ctrl+I in the text, while AI rewrites are on. */
  function improveAtCursor(editor: EditorView): boolean {
    if (!improve.current) return false;
    improve.current(caretPosition(editor));
    return true;
  }

  /** Ctrl+. in the text: brings up the card of the underline at the cursor and moves focus to it. */
  function showCardAtCursor(editor: EditorView): boolean {
    const flag = flagAt(editor.state, editor.state.selection.main.head);
    if (!flag) return false;
    underlineClick.current(flag.candidateId, true);
    return true;
  }
}
