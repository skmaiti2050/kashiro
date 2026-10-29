import { useEffect, useRef } from 'react';
import { appShortcut, isImproveKey, isLookUpKey, reviewKeyAction, type AppShortcut, type KeyTarget, type ReviewKeyAction } from './state/reviewKeys';

/** Fields where keys type text: shortcuts never fire there (a select counts: letters pick an option). */
const TEXT_ENTRY = 'textarea, select, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="number"]';
/** Controls whose own Enter or Space does their job. */
const CONTROL = 'button, input, a[href], summary';

/** CodeMirror's panels (the Find panel) sit inside the document pane but are controls, not the text. */
const EDITOR_PANELS = '.cm-panels';

/** Reads where a keydown happened, for the pure rules in state/reviewKeys.ts. */
export function keyTargetOf(target: EventTarget | null, documentEditable: boolean): KeyTarget {
  const el = target instanceof Element && target !== document.body ? target : null;
  const place = placeOf(el);
  const control = el?.closest(TEXT_ENTRY) ? 'text-entry' : el?.closest(CONTROL) ? 'control' : 'none';
  const selection = window.getSelection();
  return { place, control, documentEditable, textSelected: selection !== null && !selection.isCollapsed };
}

function placeOf(el: Element | null): KeyTarget['place'] {
  if (!el) return 'document';
  if (el.closest(EDITOR_PANELS)) return 'other';
  if (el.closest('.document')) return 'document';
  return el.closest('.review') ? 'panel' : 'other';
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

/** Calls `onPress` on Ctrl+D while `enabled`; it returns true when it acted, and only then is the key's default stopped. */
export function useLookUpKey(enabled: boolean, onPress: () => boolean): void {
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !isLookUpKey(e)) return;
      if (latest.current()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Calls `onPress` on Ctrl+I while `enabled` ("Improve this sentence"), outside text fields. */
export function useImproveKey(enabled: boolean, onPress: () => void): void {
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !isImproveKey(e) || keyTargetOf(e.target, false).control === 'text-entry') return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
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
