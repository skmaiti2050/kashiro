import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { moveInMenu } from './DismissMenu';
import { usePopup } from './usePopup';
import { Kbd } from './Kbd';
import { useT } from './i18n/useT';

export interface MoreMenuItem {
  label: string;
  /** The key hint shown on the item and given as aria-keyshortcuts ("Ctrl+D"). */
  keys?: string;
  onChoose(): void;
}

/** "Ctrl+D" → "Control+D" (aria-keyshortcuts names the Control key in full). */
const ariaKeys = (keys: string) => keys.replace(/^Ctrl\+/, 'Control+').replace(/\+,$/, '+Comma');

/**
 * The toolbar's ⋯ menu (Task U3: a calmer toolbar): the less used actions in one keyboard-accessible menu
 * (WAI-ARIA menu button: Enter or Space opens it on its first item, Up and Down move and wrap, Home and End
 * jump, Escape closes it and returns to ⋯, a click or focus outside closes it). Placed and kept the only open
 * popup by usePopup.
 */
export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // At the toolbar's end: it opens towards the start when both sides fit (Task F17).
  const placement = usePopup({ open, close, anchor: root, menu, prefer: 'start' });

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    const menuItems = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') moveInMenu(root.current, e.key === 'ArrowDown' ? 1 : -1);
    else if (e.key === 'Home') menuItems[0]?.focus();
    else if (e.key === 'End') menuItems.at(-1)?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Tab') return; // Tab moves on, as from any menu
      trigger.current?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const choose = (item: MoreMenuItem) => {
    setOpen(false);
    trigger.current?.focus();
    item.onChoose();
  };

  return (
    <div className="menu-anchor more-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        className="quiet"
        aria-label={t.t('toolbar.more')}
        title={t.t('toolbar.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={t.t('toolbar.more')} ref={menu} style={placement}>
          {items.map((item) => (
            <button key={item.label} role="menuitem" aria-keyshortcuts={item.keys && ariaKeys(item.keys)} onClick={() => choose(item)}>
              {item.label} {item.keys && <Kbd>{item.keys}</Kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
