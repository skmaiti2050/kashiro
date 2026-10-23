import type { ReadTarget } from './readAloud';

/** The keys of a keydown, without the DOM. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** The key is held down and auto-repeating. */
  repeat: boolean;
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
 * Enter on a focused button or checkbox does that control's own job instead. A held Enter or Backspace
 * decides one card only (auto-repeat would accept or reject a run of cards unseen); held J / K keep moving.
 */
export function reviewKeyAction(press: KeyPress, target: KeyTarget): ReviewKeyAction | null {
  if (press.ctrlKey || press.altKey || press.metaKey) return null;
  if (target.place === 'other' || target.control === 'text-entry') return null;
  if (target.place === 'document' && (target.documentEditable || target.textSelected)) return null;
  switch (press.key) {
    case 'Enter':
      return target.control === 'control' || press.repeat ? null : 'accept';
    case 'Backspace':
    case 'Delete':
      return press.repeat ? null : 'reject';
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

export type AppShortcut = 'open' | 'paste' | 'settings' | 'shortcuts';

/**
 * App-wide shortcuts: Ctrl+O opens a file; Ctrl+V on the empty start screen pastes as a new document
 * (once a document is open, Ctrl+V is the editor's own paste); Ctrl+, opens Settings; F1, or ? where it
 * would not type a question mark, opens the keyboard shortcuts.
 */
export function appShortcut(press: KeyPress, hasDocument: boolean, control: KeyTarget['control']): AppShortcut | null {
  if (press.altKey || press.metaKey) return null;
  if (!press.ctrlKey) {
    if (press.key === 'F1' && !press.shiftKey) return 'shortcuts';
    return press.key === '?' && control !== 'text-entry' ? 'shortcuts' : null;
  }
  if (press.shiftKey) return null;
  const key = press.key.toLowerCase();
  if (key === 'o') return 'open';
  if (key === ',') return 'settings';
  if (key === 'v' && !hasDocument && control !== 'text-entry') return 'paste';
  return null;
}

/** Ctrl and `letter` alone, once per press (a held key acts once). */
function isCtrlLetter(press: KeyPress, letter: string): boolean {
  if (!press.ctrlKey || press.altKey || press.metaKey || press.shiftKey || press.repeat) return false;
  return press.key.toLowerCase() === letter;
}

/** Ctrl+D: look up the selected word, or the word at the cursor. A held key opens the panel once. */
export function isLookUpKey(press: KeyPress): boolean {
  return isCtrlLetter(press, 'd');
}

/** Ctrl+I: "Improve this sentence" for the sentence at the cursor (AI helper). */
export function isImproveKey(press: KeyPress): boolean {
  return isCtrlLetter(press, 'i');
}

const READ_KEYS: Record<string, ReadTarget> = { s: 'sentence', r: 'suggestion', p: 'paragraph' };

/**
 * Read aloud: Alt+S the sentence, Alt+R the suggestion, Alt+P the paragraph, from anywhere (Alt+letter types
 * nothing). Only Alt: Ctrl+Alt is AltGr on many keyboards, which types letters.
 */
export function readAloudKey(press: KeyPress): ReadTarget | null {
  if (!press.altKey || press.ctrlKey || press.metaKey || press.shiftKey || press.repeat) return null;
  return READ_KEYS[press.key.toLowerCase()] ?? null;
}
