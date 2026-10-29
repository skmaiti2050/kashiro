import { useEffect, useState } from 'react';

/** How long the toast stays when nobody is on it: long enough to read it and reach Undo with Tab. */
const TOAST_MS = 8000;

interface Props {
  /** "Rejected 600 suggestions". */
  message: string;
  undoLabel: string;
  onUndo(): void;
  onDismiss(): void;
}

/**
 * A short-lived status after a big action, with an Undo (Task F21b item 8). It is a polite status message, its Undo
 * is an ordinary button in the tab order, and it never times out while it has focus or the pointer is on it
 * (WCAG 2.2.1); Escape inside it dismisses it.
 */
export function UndoToast({ message, undoLabel, onUndo, onDismiss }: Props) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (focused || hovered) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [focused, hovered, onDismiss]);

  return (
    <div
      className="undo-toast"
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDismiss();
      }}
    >
      <span>{message}</span>
      <button className="undo-toast-undo" onClick={onUndo}>
        {undoLabel}
      </button>
    </div>
  );
}
