import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { CheckSession } from '@/engine/session';
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

/**
 * Highlights for the session's state: applied edits (auto-fixes subtle) as old text struck through
 * plus the new text, pending decisions underlined. Null when the session was checked against other
 * text than the view shows (a re-check is on its way).
 */
function documentMarks(doc: OpenDocument, viewText: string, session: CheckSession): DecorationSet | null {
  if (viewText !== doc.text) return null;
  const starts = new Map<number, number>();
  for (const p of session.paragraphs()) {
    const start = doc.paraStarts.get(p.id);
    if (start === undefined || doc.text.slice(start, start + p.text.length) !== p.text) return null;
    starts.set(p.id, start);
  }
  const { top, more } = session.decisions();
  const pending = new Set([...top, ...more].flatMap((d) => d.candidateIds));
  const ranges: Range<Decoration>[] = [];
  for (const o of session.outcomes()) {
    const base = starts.get(o.candidate.paraId)!;
    const from = base + o.candidate.span.start;
    const to = base + o.candidate.span.end;
    if (o.status === 'applied') {
      if (to > from) ranges.push(Decoration.mark({ class: o.auto ? 'cm-old cm-old-auto' : 'cm-old' }).range(from, to));
      if (o.replacement) ranges.push(Decoration.widget({ widget: new ReplacementWidget(o.replacement, o.auto), side: 1 }).range(to));
    } else if (pending.has(o.candidate.id) && to > from) {
      ranges.push(Decoration.mark({ class: 'cm-pending', attributes: { title: o.candidate.message } }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
}

interface Props {
  controller: SessionController;
  state: ControllerState;
}

/** CodeMirror view of the document: read-only for .docx, editable (and re-checked as you type) for text. */
export function DocumentView({ controller, state }: Props) {
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
          EditorView.lineWrapping,
          EditorView.editable.of(doc.editable),
          EditorState.readOnly.of(!doc.editable),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder('Paste or type your text here.'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) controller.editText(update.state.doc.toString());
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
    const marks = documentMarks(doc, editor.state.doc.toString(), state.session);
    if (marks) editor.dispatch({ effects: setMarks.of(marks) });
  }, [state.revision, state.session, doc]);

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
