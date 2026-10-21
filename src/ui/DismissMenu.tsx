import { useEffect, useRef, useState } from 'react';

interface Props {
  /** The rule as the user sees it ("Readability"). */
  rule: string;
  /** Batch cards dismiss all their places with "This one". */
  thisOneLabel: string;
  onThisOne(): void;
  onRule(scope: 'document' | 'everywhere'): void;
}

/**
 * Dismiss ▾ with its scope in every item (UI/UX research §3, LanguageTool's "ignore in this text" vs
 * "turn off everywhere"). "Everywhere" can be undone in Settings › Ignored rules.
 */
export function DismissMenu({ rule, thisOneLabel, onThisOne, onRule }: Props) {
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
        if (e.key !== 'Escape' || !open) return;
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
            This rule ({rule}) in this document
          </button>
          <button role="menuitem" onClick={() => choose(() => onRule('everywhere'))}>
            This rule ({rule}) everywhere <span className="hint">· undo in Settings</span>
          </button>
        </div>
      )}
    </div>
  );
}
