import { useEffect, useRef } from 'react';
import { appShortcut, reviewKeyAction, type AppShortcut, type KeyTarget, type ReviewKeyAction } from './state/reviewKeys';

/** Fields where keys type text: shortcuts never fire there (a select counts: letters pick an option). */
const TEXT_ENTRY = 'textarea, select, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="number"]';
/** Controls whose own Enter or Space does their job. */
const CONTROL = 'button, input, a[href], summary';

/** Reads where a keydown happened, for the pure rules in state/reviewKeys.ts. */
export function keyTargetOf(target: EventTarget | null, documentEditable: boolean): KeyTarget {
  const el = target instanceof Element && target !== document.body ? target : null;
  const place = !el || el.closest('.document') ? 'document' : el.closest('.review') ? 'panel' : 'other';
  const control = el?.closest(TEXT_ENTRY) ? 'text-entry' : el?.closest(CONTROL) ? 'control' : 'none';
  const selection = window.getSelection();
  return { place, control, documentEditable, textSelected: selection !== null && !selection.isCollapsed };
}

/** Calls `onAction` for the review loop's keys (Enter, Backspace/Delete, J, K) while `enabled`. */
export function useReviewKeys(enabled: boolean, documentEditable: boolean, onAction: (action: ReviewKeyAction) => void): void {
  const latest = useRef(onAction);
  useEffect(() => {
    latest.current = onAction;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = reviewKeyAction(e, keyTargetOf(e.target, documentEditable));
      if (!action) return;
      e.preventDefault();
      latest.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, documentEditable]);
}

/** Calls `onShortcut` for Ctrl+O, and Ctrl+V on the start screen. */
export function useAppShortcuts(hasDocument: boolean, onShortcut: (shortcut: AppShortcut) => void): void {
  const latest = useRef(onShortcut);
  useEffect(() => {
    latest.current = onShortcut;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const shortcut = appShortcut(e, hasDocument, keyTargetOf(e.target, false).control);
      if (!shortcut) return;
      e.preventDefault();
      latest.current(shortcut);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasDocument]);
}
