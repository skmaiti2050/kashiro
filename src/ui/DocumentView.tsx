import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { EmptyState } from './EmptyState';
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

/** A pending flag's underline: its candidate and its spoken "Correctness: message" description. */
interface FlagMark {
  candidateId: string;
  description: string;
}

/** The pending flag whose underline covers `pos`, from the marks' `candidateId` and `description`. */
function flagAt(state: EditorState, pos: number): FlagMark | null {
  let found: FlagMark | null = null;
  state.field(marksField).between(pos, pos, (from, to, mark) => {
    const { candidateId, description } = mark.spec as Partial<FlagMark>;
    if (typeof candidateId !== 'string' || pos < from || pos > to) return;
    found = { candidateId, description: description ?? '' };
    return false;
  });
  return found;
}

/** The pending flag whose underline was clicked. */
function candidateAt(view: EditorView, event: MouseEvent): string | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  return pos === null ? null : (flagAt(view.state, pos)?.candidateId ?? null);
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
    EditorView.contentAttributes.of({ 'aria-label': t.t('doc.textLabel'), 'aria-describedby': FLAG_AT_CURSOR_ID, lang: 'en', dir: 'ltr' }),
  ];
}

/** Room kept around a scrolled-to underline, so it never sits flush against the pane's edges. */
const SCROLL_MARGINS = { top: 32, bottom: 32 };

interface Props {
  controller: SessionController;
  state: ControllerState;
  focus: DocumentFocus | null;
  /** Clicking an underline (or Ctrl+. on it, `fromKeyboard`) brings up its card. */
  onUnderlineClick(candidateId: string, fromKeyboard: boolean): void;
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
}

/** CodeMirror view of the document: read-only for .docx, editable (and re-checked as you type) for text. */
export function DocumentView({ controller, state, focus, onUnderlineClick, onOpen, onPaste, onSample, onOpenRecent, caretReader, onLookUp, aiOn, improveAtCaret }: Props) {
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
  const doc = state.document;

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
          keymap.of([{ key: 'Mod-.', run: showCardAtCursor }, { key: 'Mod-i', run: improveAtCursor }, ...defaultKeymap, ...historyKeymap]),
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
              const id = candidateAt(editor, event);
              if (id) underlineClick.current(id, false);
              return false;
            },
            contextmenu: openTextMenu,
          }),
        ],
      }),
    });
    view.current = editor;
    // Positions count a line break as one character, as doc.toString() (LF) does; sliceDoc() may be CRLF.
    caretReader.current = () => (editor.hasFocus ? { text: editor.state.doc.toString(), offset: editor.state.selection.main.head } : null);
    if (doc.editable) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
      caretReader.current = () => null;
    };
    // Keyed on the document id, not its text: the editor's own edits flow out through editText.
  }, [doc?.id, controller]);

  useEffect(() => {
    view.current?.dispatch({ effects: labels.current.reconfigure(editorLabels(t)) });
  }, [t]);

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

  useLookUpKey(onLookUp !== null && doc !== null, () => {
    const word = view.current ? wordAtSelection(view.current) : null;
    if (word) lookUp.current?.(word);
    return word !== null;
  });

  // Ctrl+I outside the text (the panel, the toolbar); inside it, the editor's keymap answers first.
  useImproveKey(aiOn && doc !== null, () => improveAtCaret.current());

  if (!doc) return <EmptyState onOpen={onOpen} onPaste={onPaste} onSample={onSample} recent={state.recentReviews} onOpenRecent={onOpenRecent} />;
  return (
    <section className="document" aria-label={doc.name}>
      {doc.note && <p className="note">{t.format(doc.note)}</p>}
      <div className="editor" ref={host} />
      <p id={FLAG_AT_CURSOR_ID} className="visually-hidden" aria-live="polite">
        {flagAtCursor}
      </p>
      {textMenu}
    </section>
  );

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
