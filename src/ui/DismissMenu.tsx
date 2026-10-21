import { useEffect, useRef, useState } from 'react';
import { kindLabel } from './state/kindLabels';

interface Props {
  /** The kind of suggestion ("WordChoice"); the menu shows its label ("Word choice"). */
  kind: string;
  /** Batch cards dismiss all their places with "This one". */
  thisOneLabel: string;
  onThisOne(): void;
  onRule(scope: 'document' | 'everywhere'): void;
}

/** Up / Down move between the menu's items, wrapping at the ends (WAI-ARIA menu pattern). */
function moveInMenu(root: HTMLElement | null, step: 1 | -1): void {
  const items = [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + step + items.length) % items.length].focus();
}

/**
 * Dismiss ▾ with its scope in every item (UI/UX research §3, LanguageTool's "ignore in this text" vs
 * "turn off everywhere"). "Everywhere" can be undone in Settings › Ignored rules.
 */
export function DismissMenu({ kind, thisOneLabel, onThisOne, onRule }: Props) {
  const label = kindLabel(kind);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOutside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div
      className="menu-anchor"
      ref={root}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveInMenu(root.current, e.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Dismiss ▾
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Dismiss">
          <button role="menuitem" onClick={() => choose(onThisOne)}>
            {thisOneLabel}
          </button>
          <button role="menuitem" onClick={() => choose(() => onRule('document'))}>
            All “{label}” suggestions in this document
          </button>
          <button role="menuitem" onClick={() => choose(() => onRule('everywhere'))}>
            All “{label}” suggestions everywhere <span className="hint">· undo in Settings</span>
          </button>
        </div>
      )}
    </div>
  );
}
