import { useLayoutEffect, useRef, useState } from 'react';
import type { CheckSession } from '@/engine/session';

interface Opened<T> {
  value: T;
  /** The check the preview opened on, whether typed text was then waiting for its re-check, and the text changes so far. */
  session: CheckSession;
  checking: boolean;
  textChanges: number;
}

export interface OpenPreview<T> {
  /** What the open preview shows (a card's replacement index, say), or null while it is closed. */
  shown: T | null;
  open(value: T): void;
  close(): void;
  /** BatchPreview's onCloseWithFocus: once the preview has closed, `focusOpener` takes the focus. */
  closingWithFocus(): void;
}

/**
 * A batch preview's open state, on a card or in the AI group. Any change to the document text, and any re-check,
 * closes it (owner decision 2026-10-27, Task F13): ids are offsets, so after a re-check the same id can mean another
 * place, and no comparison of members told every such place apart (Tasks F11 and F12). A re-check brings a new
 * session; `textChanges` (ControllerState) moves on every change to the text, typed or applied in place (an AI
 * suggestion, another card, the change log: Task F14); and a check that fails turns `checking` off. Each closes the
 * preview, and opening it again shows Kashiro's current ticks.
 *
 * When the preview closes with focus inside it, `focusOpener(value)` runs after the render that removed it, so focus
 * goes to the button that opens it again instead of the page.
 */
export function useOpenPreview<T>(session: CheckSession, checking: boolean, textChanges: number, focusOpener: (value: T) => void): OpenPreview<T> {
  const [opened, setOpened] = useState<Opened<T> | null>(null);
  /** The last value opened, while focus waits to go back to its opener. */
  const focusBack = useRef<{ value: T; pending: boolean } | null>(null);
  const outdated = opened !== null && (opened.session !== session || opened.checking !== checking || opened.textChanges !== textChanges);
  // Setting state while rendering is React's pattern for resetting state when a prop changes.
  if (outdated) setOpened(null);
  const shown = opened && !outdated ? opened.value : null;

  useLayoutEffect(() => {
    if (shown !== null || !focusBack.current?.pending) return;
    focusBack.current.pending = false;
    focusOpener(focusBack.current.value);
  });

  return {
    shown,
    open: (value) => {
      focusBack.current = { value, pending: false };
      setOpened({ value, session, checking, textChanges });
    },
    close: () => setOpened(null),
    closingWithFocus: () => {
      if (focusBack.current) focusBack.current.pending = true;
    },
  };
}
