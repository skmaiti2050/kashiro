/** The keys of a keydown, without the DOM. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Where the keydown happened, without the DOM (see useReviewKeys for how it is read). */
export interface KeyTarget {
  /** The review panel, the document pane (or nothing focused), or anywhere else (toolbar, dialogs, log). */
  place: 'panel' | 'document' | 'other';
  /** text-entry: a text field or the editable document; control: a button, checkbox, select or link. */
  control: 'text-entry' | 'control' | 'none';
  /** The open document can be typed in (.txt, .md). */
  documentEditable: boolean;
  /** Some text is selected (copying must keep working). */
  textSelected: boolean;
}

export type ReviewKeyAction = 'accept' | 'reject' | 'next' | 'previous';

/**
 * The review loop's keys: Enter accepts the current card, Backspace or Delete rejects or dismisses it,
 * J / K move to the next / previous card without deciding. They only fire in the review panel, or in a
 * read-only document with nothing selected, so typing in the editable document is never taken over.
 * Enter on a focused button or checkbox does that control's own job instead.
 */
export function reviewKeyAction(press: KeyPress, target: KeyTarget): ReviewKeyAction | null {
  if (press.ctrlKey || press.altKey || press.metaKey) return null;
  if (target.place === 'other' || target.control === 'text-entry') return null;
  if (target.place === 'document' && (target.documentEditable || target.textSelected)) return null;
  switch (press.key) {
    case 'Enter':
      return target.control === 'control' ? null : 'accept';
    case 'Backspace':
    case 'Delete':
      return 'reject';
    case 'j':
    case 'J':
      return 'next';
    case 'k':
    case 'K':
      return 'previous';
    default:
      return null;
  }
}

export type AppShortcut = 'open' | 'paste';

/**
 * App-wide shortcuts: Ctrl+O opens a file; Ctrl+V on the empty start screen pastes as a new document
 * (once a document is open, Ctrl+V is the editor's own paste).
 */
export function appShortcut(press: KeyPress, hasDocument: boolean, control: KeyTarget['control']): AppShortcut | null {
  if (!press.ctrlKey || press.altKey || press.metaKey || press.shiftKey) return null;
  const key = press.key.toLowerCase();
  if (key === 'o') return 'open';
  if (key === 'v' && !hasDocument && control !== 'text-entry') return 'paste';
  return null;
}
