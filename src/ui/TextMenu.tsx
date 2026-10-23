import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { moveInMenu } from './DismissMenu';
import { useT } from './i18n/useT';

interface Size {
  width: number;
  height: number;
}

/** Room kept between the menu and the window's edges. */
const EDGE_MARGIN = 4;

/** Where a menu of `size` opened at `at` goes so it stays inside `viewport`: moved left / up near the edges. */
export function placeInViewport(at: { x: number; y: number }, size: Size, viewport: Size): { x: number; y: number } {
  const x = Math.max(EDGE_MARGIN, Math.min(at.x, viewport.width - size.width - EDGE_MARGIN));
  const y = Math.max(EDGE_MARGIN, Math.min(at.y, viewport.height - size.height - EDGE_MARGIN));
  return { x, y };
}

interface Props {
  /** Where the right-click happened (viewport pixels). */
  at: { x: number; y: number };
  /** The word "Look up" shows; null hides Look up (lookup is off, or no word is there). */
  word: string | null;
  /** Shows "Improve this sentence" (AI rewrites are on). */
  canImprove: boolean;
  /** Shows Copy (the system menu this replaces offered it for a selection). */
  canCopy: boolean;
  onLookUp(): void;
  onImprove(): void;
  onCopy(): void;
  /** `returnFocus`: put the focus back where it was (Escape, Tab); not after a click elsewhere. */
  onClose(returnFocus: boolean): void;
}

/**
 * The right-click menu on the document text: "Look up “word”", "Improve this sentence", and Copy when text is
 * selected (WAI-ARIA menu: first item focused, Up / Down move, Escape closes). Nothing in it changes the text:
 * an AI suggestion only joins the review.
 */
export function TextMenu({ at, word, canImprove, canCopy, onLookUp, onImprove, onCopy, onClose }: Props) {
  const t = useT();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);

  // Measured before paint, so a menu opened near the window's edge never shows cut off.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box) setPosition(placeInViewport(at, box, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const closeOutside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose(false);
    };
    // The menu is placed in window pixels: once the text scrolls or the window resizes, it points at the wrong word.
    const closeMoved = () => onClose(false);
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('scroll', closeMoved, true);
    window.addEventListener('resize', closeMoved);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('scroll', closeMoved, true);
      window.removeEventListener('resize', closeMoved);
    };
  }, []);

  return (
    <div
      ref={menu}
      className="menu text-menu"
      role="menu"
      aria-label={t.t('doc.textMenu')}
      style={{ left: position.x, top: position.y }}
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
      {word !== null && (
        <button role="menuitem" onClick={onLookUp}>
          {t.t('doc.lookUpWord', { word })}
        </button>
      )}
      {canImprove && (
        <button role="menuitem" onClick={onImprove}>
          {t.t('ai.improve')}
        </button>
      )}
      {canCopy && (
        <button role="menuitem" onClick={onCopy}>
          {t.t('doc.copy')}
        </button>
      )}
    </div>
  );
}
