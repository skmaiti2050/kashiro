import type { EditorView } from '@codemirror/view';
import { wordToLookUp } from './state/wordLookup';

/**
 * The selection in the text: the editor's own while it has focus, else the page's selection when it lies in the
 * text (a click in a read-only .docx moves no editor selection).
 */
function textSelection(editor: EditorView): { from: number; to: number } | null {
  if (editor.hasFocus) return editor.state.selection.main;
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (!selection || !anchorNode || !focusNode || !editor.contentDOM.contains(anchorNode) || !editor.contentDOM.contains(focusNode)) return null;
  const anchor = editor.posAtDOM(anchorNode, selection.anchorOffset);
  const head = editor.posAtDOM(focusNode, selection.focusOffset);
  return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
}

/** The selected text with the document's own line breaks (for Copy), or "" when nothing is selected. */
export function selectedText(editor: EditorView): string {
  const range = textSelection(editor);
  return range && range.from < range.to ? editor.state.sliceDoc(range.from, range.to) : '';
}

/** What Ctrl+D looks up: the selection, or the word at the cursor. */
export function wordAtSelection(editor: EditorView): string | null {
  const range = textSelection(editor);
  return range ? wordToLookUp(editor.state.doc.toString(), range.from, range.to) : null;
}

/** What a right-click looks up: the selection if there is one, else the word under the pointer. */
export function wordAtPointer(editor: EditorView, event: MouseEvent): string | null {
  const range = textSelection(editor);
  const text = editor.state.doc.toString();
  if (range && range.from < range.to) return wordToLookUp(text, range.from, range.to);
  // No pointer position (0, 0: the Menu key): the word at the cursor.
  const pointer = event.clientX || event.clientY ? editor.posAtCoords({ x: event.clientX, y: event.clientY }) : null;
  const at = pointer ?? range?.from;
  return at === undefined ? null : wordToLookUp(text, at, at);
}
