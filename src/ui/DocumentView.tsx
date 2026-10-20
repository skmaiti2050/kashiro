import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { highlightRanges, locateCandidate, toEditorPosition } from './state/highlights';
import type { ControllerState, OpenDocument, SessionController } from './state/sessionController';

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
function documentMarks(doc: OpenDocument, viewText: string, session: CheckSession): DecorationSet | null {
  const highlights = highlightRanges(doc, viewText, session);
  if (!highlights) return null;
  const at = toEditorPosition(doc.text, doc.lineSeparator);
  const ranges: Range<Decoration>[] = [];
  for (const h of highlights) {
    const from = at(h.from);
    const to = at(h.to);
    if (h.kind === 'pending') {
      ranges.push(Decoration.mark({ class: 'cm-pending', attributes: { title: h.message ?? '' } }).range(from, to));
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

interface Props {
  controller: SessionController;
  state: ControllerState;
  focus: DocumentFocus | null;
}

/** CodeMirror view of the document: read-only for .docx, editable (and re-checked as you type) for text. */
export function DocumentView({ controller, state, focus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
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
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder('Paste or type your text here.'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) controller.editText(update.state.sliceDoc());
          }),
        ],
      }),
    });
    view.current = editor;
    if (doc.editable) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Keyed on the document id, not its text: the editor's own edits flow out through editText.
  }, [doc?.id, controller]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !doc || !state.session) return;
    const marks = documentMarks(doc, editor.state.sliceDoc(), state.session);
    if (marks) editor.dispatch({ effects: setMarks.of(marks) });
  }, [state.revision, state.session, doc]);

  // Clicking a review item outlines its text and scrolls it into view.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !doc || !state.session || !focus) return;
    const at = locateCandidate(doc, editor.state.sliceDoc(), state.session, focus.candidate);
    if (!at) return;
    const position = toEditorPosition(doc.text, doc.lineSeparator);
    const from = position(at.from);
    const to = position(at.to);
    editor.dispatch({
      effects: [setFocusMark.of(to > from ? Decoration.set([FOCUS_MARK.range(from, to)]) : Decoration.none), EditorView.scrollIntoView(from, { y: 'center' })],
    });
    // Only a new click moves the view; re-renders from checks don't.
  }, [focus?.seq]);

  if (!doc) {
    return (
      <section className="document empty">
        <p>Open a .docx, .txt or .md file, or paste your text.</p>
        <p className="hint">Nothing leaves this computer: the check runs here, offline.</p>
      </section>
    );
  }
  return (
    <section className="document">
      {doc.note && <p className="note">{doc.note}</p>}
      <div className="editor" ref={host} />
    </section>
  );
}
