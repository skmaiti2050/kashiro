import { useCallback, useState, type ReactNode, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { TextMenu } from './TextMenu';
import { selectedText, wordAtPointer } from './editorWords';
import { msg } from './i18n/message';
import { explain } from './state/errors';
import type { SessionController } from './state/sessionController';

/** The right-click menu: where it opened, its word, the selected text (for Copy) and where focus goes back to. */
interface TextMenuState {
  at: { x: number; y: number };
  word: string;
  selected: string;
  returnTo: Element | null;
}

/**
 * The document's right-click menu ("Look up “word”", Copy). `openTextMenu` is the editor's contextmenu handler:
 * it takes over only in a read-only document on a word while lookup is on (`lookUp` set). Editable text keeps the
 * system menu with Cut, Paste and Select all; there Look up is Ctrl+D or the card's button.
 */
export function useTextMenu(lookUp: RefObject<((word: string) => void) | null>, controller: SessionController) {
  const [textMenu, setTextMenu] = useState<TextMenuState | null>(null);

  // Stable: the editor registers it once per document.
  const openTextMenu = useCallback((event: MouseEvent, editor: EditorView): boolean => {
    const word = lookUp.current && editor.state.readOnly ? wordAtPointer(editor, event) : null;
    if (!word) return false;
    event.preventDefault();
    setTextMenu({ at: { x: event.clientX, y: event.clientY }, word, selected: selectedText(editor), returnTo: document.activeElement });
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
      canCopy={textMenu.selected !== ''}
      onLookUp={() => {
        close(true);
        lookUp.current?.(textMenu.word);
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
