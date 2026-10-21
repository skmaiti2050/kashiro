import type { ReactNode } from 'react';

/** A muted key hint on a button ("Enter"). The button carries aria-keyshortcuts; the hint is for sighted users. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="key-hint" aria-hidden="true">
      {children}
    </kbd>
  );
}
