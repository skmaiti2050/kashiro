import { useCallback, useEffect, useRef, useState } from 'react';
import { usePopup } from './usePopup';
import { useT } from './i18n/useT';
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
export function moveInMenu(root: HTMLElement | null, step: 1 | -1): void {
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
  const t = useT();
  const label = kindLabel(t, kind);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // On a review card it opens towards the end, unless that would run past the panel (Task F20 item 7).
  const placement = usePopup({ open, close, anchor: root, menu, prefer: 'end' });

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
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
        {t.t('dismiss.button')}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={t.t('dismiss.menu')} ref={menu} style={placement}>
          <button role="menuitem" onClick={() => choose(onThisOne)}>
            {thisOneLabel}
          </button>
          <button role="menuitem" onClick={() => choose(() => onRule('document'))}>
            {t.t('dismiss.inDocument', { kind: label })}
          </button>
          <button role="menuitem" onClick={() => choose(() => onRule('everywhere'))}>
            {t.t('dismiss.everywhere', { kind: label })} <span className="hint">{t.t('dismiss.undoHint')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
