import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { closeSearchPanel, openSearchPanel, search, searchPanelOpen } from '@codemirror/search';
import { focusIfConnected } from './focus';
import type { Translator } from './i18n/translator';

/** The panel's Find field (CodeMirror marks it as the panel's main field). */
const FIND_FIELD = '.cm-search [main-field]';

/** Where focus was when Find opened, per editor. */
const focusBefore = new WeakMap<EditorView, Element | null>();

/** Ctrl+F (F23b): opens the Find panel, or brings focus back to its field when it is open. Always handles the key. */
export function openFind(view: EditorView): boolean {
  if (!searchPanelOpen(view.state)) focusBefore.set(view, document.activeElement);
  openSearchPanel(view);
  view.dom.querySelector<HTMLElement>(FIND_FIELD)?.focus();
  return true;
}

/**
 * When the panel closes, CodeMirror gives focus to an editable text itself. A read-only text can't take focus, so
 * it goes back where it was when Find opened (a card, a toolbar button) instead of being lost.
 */
const focusBackOnClose = EditorView.updateListener.of((update) => {
  if (!searchPanelOpen(update.startState) || searchPanelOpen(update.state)) return;
  const before = focusBefore.get(update.view);
  focusBefore.delete(update.view);
  if (update.state.facet(EditorView.editable)) return;
  // Only focus that was in the panel (or went with it) moves; focus already elsewhere stays there.
  const active = document.activeElement;
  if (active && active !== document.body && !update.view.dom.contains(active)) return;
  focusIfConnected(before);
});

/**
 * Find in the document: CodeMirror's search panel above the text. A read-only document gets no Replace
 * (CodeMirror leaves it out of the panel and refuses it); in an editable one, a replace is an edit like typing, so
 * it reaches the controller through the editor's update listener. Escape closes it.
 * Only these keys: CodeMirror's full search keymap would take Ctrl+D (Look up) for "select next occurrence".
 */
export const findInDocument: Extension = [
  search({ top: true }),
  keymap.of([
    { key: 'Mod-f', run: openFind, scope: 'editor search-panel' },
    { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
  ]),
  focusBackOnClose,
];

/** The panel's words in the UI language. CodeMirror puts a number where its phrases have "$". */
export function findPhrases(t: Translator): Extension {
  return EditorState.phrases.of({
    Find: t.t('find.find'),
    Replace: t.t('find.replaceWith'),
    next: t.t('find.next'),
    previous: t.t('find.previous'),
    all: t.t('find.all'),
    'match case': t.t('find.matchCase'),
    regexp: t.t('find.regexp'),
    'by word': t.t('find.byWord'),
    replace: t.t('find.replace'),
    'replace all': t.t('find.replaceAll'),
    close: t.t('find.close'),
    'current match': t.t('find.currentMatch'),
    'on line': t.t('find.onLine'),
    'replaced match on line $': t.t('find.replacedOnLine', { line: '$' }),
    'replaced $ matches': t.t('find.replacedCount', { matches: '$' }),
  });
}
