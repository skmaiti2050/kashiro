/**
 * Moves focus to `el` when it is an element still on the page (where focus was before a dialog or menu opened may have
 * gone with a re-render). Returns whether it did.
 */
export function focusIfConnected(el: unknown): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  el.focus();
  return true;
}

/** Moves focus to the button at `index` in `list` (in document order). Returns whether there was one. */
export function focusButtonAt(list: Element | null, index: number): boolean {
  const button = list?.querySelectorAll('button')[index];
  button?.focus();
  return button !== undefined;
}
