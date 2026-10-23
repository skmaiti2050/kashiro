import { useCallback, useState, type ReactNode, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { TextMenu } from './TextMenu';
import { positionAtPointer, selectedText, wordAtPointer } from './editorWords';
import { msg } from './i18n/message';
import { explain } from './state/errors';
import type { SessionController } from './state/sessionController';

/** The right-click menu: where it opened, its word and position, the selected text (for Copy) and where focus goes back to. */
interface TextMenuState {
  at: { x: number; y: number };
  /** The word to look up, or null when lookup is off or there is no word there. */
  word: string | null;
  /** Where in the text it opened, for "Improve this sentence" (null when AI rewrites are off). */
  position: number | null;
  selected: string;
  returnTo: Element | null;
}

/**
 * The document's right-click menu ("Look up “word”", "Improve this sentence", Copy). `openTextMenu` is the
 * editor's contextmenu handler: it takes over only in a read-only document, on a word while lookup is on
 * (`lookUp` set) or anywhere while AI rewrites are on (`improve` set). Editable text keeps the system menu with
 * Cut, Paste and Select all; there Look up is Ctrl+D and Improve is Ctrl+I or the toolbar.
 */
export function useTextMenu(
  lookUp: RefObject<((word: string) => void) | null>,
  improve: RefObject<((position: number | null) => void) | null>,
  controller: SessionController,
) {
  const [textMenu, setTextMenu] = useState<TextMenuState | null>(null);

  // Stable: the editor registers it once per document.
  const openTextMenu = useCallback((event: MouseEvent, editor: EditorView): boolean => {
    if (!editor.state.readOnly) return false;
    const word = lookUp.current ? wordAtPointer(editor, event) : null;
    const position = improve.current ? positionAtPointer(editor, event) : null;
    if (!word && position === null) return false;
    event.preventDefault();
    setTextMenu({ at: { x: event.clientX, y: event.clientY }, word, position, selected: selectedText(editor), returnTo: document.activeElement });
    return true;
  }, []);

  /** With `returnFocus`, focus goes back to where it was before the menu opened. */
  const close = (returnFocus: boolean) => {
    if (returnFocus && textMenu?.returnTo instanceof HTMLElement && textMenu.returnTo.isConnected) textMenu.returnTo.focus();
    setTextMenu(null);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      controller.showError(explain(msg('error.copy'), e, msg('error.copyNext')));
    }
  };

  const menu: ReactNode = textMenu && (
    <TextMenu
      at={textMenu.at}
      word={textMenu.word}
      canImprove={textMenu.position !== null}
      canCopy={textMenu.selected !== ''}
      onLookUp={() => {
        close(true);
        if (textMenu.word) lookUp.current?.(textMenu.word);
      }}
      onImprove={() => {
        close(true);
        improve.current?.(textMenu.position);
      }}
      onCopy={() => {
        close(true);
        void copy(textMenu.selected);
      }}
      onClose={close}
    />
  );

  return { openTextMenu, textMenu: menu };
}
