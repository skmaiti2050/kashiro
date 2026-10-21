import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useT } from './i18n/useT';

/** Controls Tab can reach inside a dialog. */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose(): void;
  /** alertdialog: a question to answer (no Close button, no closing by clicking outside; Escape still cancels). */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  /** The id of the text that explains the dialog (read after its title). */
  describedBy?: string;
  /** The control focused on open; the first control by default. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * A modal dialog (WCAG 2.1.2, 2.4.3): labelled by its title, aria-modal, focus moved in on open, Tab kept
 * inside, Escape closes, and focus goes back to where it was (the button that opened it) on close.
 */
export function Dialog({ title, onClose, role = 'dialog', className, describedBy, initialFocus, children }: Props) {
  const t = useT();
  const backdrop = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement;
    const restorePage = backdrop.current ? inertOutside(backdrop.current) : () => {};
    const first = initialFocus?.current ?? focusableIn(box.current)[0] ?? box.current;
    first?.focus();
    return () => {
      // The page first: an inert element can't take focus back.
      restorePage();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') keepTabInside(e, box.current);
  };

  return (
    <div ref={backdrop} className="dialog-backdrop" onClick={role === 'dialog' ? onClose : undefined}>
      <section
        ref={box}
        className={className ? `dialog ${className}` : 'dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Not a <header>: inside a dialog that would be a second "banner" landmark. */}
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {role === 'dialog' && (
            <button className="quiet" onClick={onClose}>
              {t.t('dialog.close')}
            </button>
          )}
        </div>
        {children}
      </section>
    </div>
  );
}

/**
 * Makes the rest of the page inert (no focus, no clicks, out of the accessibility tree) while the dialog is
 * open: every sibling of the dialog and of each of its ancestors up to <body>. Returns the undo, which
 * clears only what it set.
 */
function inertOutside(dialog: HTMLElement): () => void {
  const madeInert: Element[] = [];
  for (let el: Element = dialog; el.parentElement && el !== document.body; el = el.parentElement) {
    for (const sibling of el.parentElement.children) {
      if (sibling === el || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      madeInert.push(sibling);
    }
  }
  return () => madeInert.forEach((el) => el.removeAttribute('inert'));
}

/** The controls inside `box` in document order (matches() per element: jsdom's querySelectorAll groups a selector list). */
function focusableIn(box: HTMLElement | null): HTMLElement[] {
  return [...(box?.querySelectorAll<HTMLElement>('*') ?? [])].filter((el) => el.matches(FOCUSABLE));
}

/** Tab from the last control goes to the first, Shift+Tab from the first to the last. */
function keepTabInside(e: KeyboardEvent<HTMLElement>, box: HTMLElement | null): void {
  const controls = focusableIn(box);
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !box?.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !box?.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
