import { useEffect, useRef } from 'react';
import { moveInMenu } from './DismissMenu';
import { useT } from './i18n/useT';

interface Props {
  /** Where the right-click happened (viewport pixels). */
  at: { x: number; y: number };
  /** The word "Look up" shows. */
  word: string;
  /** Shows Copy (the system menu this replaces offered it for a selection). */
  canCopy: boolean;
  onLookUp(): void;
  onCopy(): void;
  /** `returnFocus`: put the focus back where it was (Escape, Tab); not after a click elsewhere. */
  onClose(returnFocus: boolean): void;
}

/**
 * The right-click menu on the document text: "Look up “word”", and Copy when text is selected (WAI-ARIA menu:
 * first item focused, Up / Down move, Escape closes). Nothing in it changes the text.
 */
export function TextMenu({ at, word, canCopy, onLookUp, onCopy, onClose }: Props) {
  const t = useT();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, []);

  return (
    <div
      ref={menu}
      className="menu text-menu"
      role="menu"
      aria-label={t.t('doc.textMenu')}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveInMenu(menu.current, e.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (e.key !== 'Escape' && e.key !== 'Tab') return;
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
      }}
    >
      <button role="menuitem" onClick={onLookUp}>
        {t.t('doc.lookUpWord', { word })}
      </button>
      {canCopy && (
        <button role="menuitem" onClick={onCopy}>
          {t.t('doc.copy')}
        </button>
      )}
    </div>
  );
}
