import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** The way a popup opens along the line: towards the inline end (the default) or towards the inline start. */
export type Side = 'start' | 'end';

interface Size {
  width: number;
  height: number;
}

/** Space kept between a capped popup and the edge of the box that clips it. */
const EDGE_GAP = 8;

/**
 * Where a popup goes (Task F20 item 7): towards `prefer` if its width fits between its anchor and the clipping
 * box's edge, else towards the other side if that fits, else towards the side with more room; below its anchor
 * unless only above has room. Its width is capped to the room on its side, so its text wraps instead of being cut.
 * `anchor` and `box` are viewport rectangles; in a right-to-left layout the inline end is on the left.
 */
export function placePopup(anchor: DOMRect, menu: Size, box: DOMRect, dir: 'ltr' | 'rtl', prefer: Side): { side: Side; up: boolean; maxWidth: number } {
  const toRight = box.right - anchor.left;
  const toLeft = anchor.right - box.left;
  const room: Record<Side, number> = dir === 'ltr' ? { end: toRight, start: toLeft } : { end: toLeft, start: toRight };
  const other: Side = prefer === 'end' ? 'start' : 'end';
  const side: Side = room[prefer] >= menu.width ? prefer : room[other] >= menu.width ? other : room[prefer] >= room[other] ? prefer : other;
  const below = box.bottom - anchor.bottom;
  const above = anchor.top - box.top;
  const up = below < menu.height && above > below;
  return { side, up, maxWidth: Math.max(0, Math.min(room[side], box.width) - EDGE_GAP) };
}

const CLIPS = /auto|scroll|hidden|clip/;

/** The box `el` is clipped by: its nearest ancestor that clips or scrolls (the review panel), within the window. */
function clippingBox(el: HTMLElement): DOMRect {
  const window_ = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (!CLIPS.test(overflowX) && !CLIPS.test(overflowY)) continue;
    const r = parent.getBoundingClientRect();
    const left = Math.max(r.left, 0);
    const top = Math.max(r.top, 0);
    return new DOMRect(left, top, Math.min(r.right, window_.right) - left, Math.min(r.bottom, window_.bottom) - top);
  }
  return window_;
}

/** Closes the popup open now, so opening another leaves one open (owner, Task F20 item 7). */
let closeOpenPopup: (() => void) | null = null;

interface Options {
  open: boolean;
  close(): void;
  /** The positioned box the popup is placed against (.menu-anchor, .save-group); outside it, a click or focus closes the popup. */
  anchor: RefObject<HTMLElement | null>;
  menu: RefObject<HTMLElement | null>;
  /** The side it opens towards when both fit: the toolbar's end menus prefer the start. */
  prefer: Side;
}

/**
 * One popup menu's behaviour, shared by ⋯, Save ▾ and Dismiss ▾: only one is open at a time; a click or focus
 * outside its anchor closes it; on opening, and on a window resize while open, it is placed inside the box that
 * clips it (placePopup). Returns the popup's inline style. Escape stays with each menu: each returns focus its way.
 */
export function usePopup({ open, close, anchor, menu, prefer }: Options): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    if (closeOpenPopup !== close) closeOpenPopup?.();
    closeOpenPopup = close;
    const closeOutside = (e: Event) => {
      if (!anchor.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      if (closeOpenPopup === close) closeOpenPopup = null;
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [open, close, anchor]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = menu.current;
      if (!anchor.current || !el) return;
      const dir = anchor.current.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
      // Its own width, not the cap from the last placement (put back at once: React only writes a changed value).
      const capped = el.style.maxWidth;
      el.style.maxWidth = '';
      const { width, height } = el.getBoundingClientRect();
      el.style.maxWidth = capped;
      // Not laid out (display: none, or no layout engine): the CSS placement stands.
      if (width === 0 && height === 0) return;
      const { side, up, maxWidth } = placePopup(anchor.current.getBoundingClientRect(), { width, height }, clippingBox(anchor.current), dir, prefer);
      setStyle({
        insetInlineStart: side === 'end' ? 0 : 'auto',
        insetInlineEnd: side === 'end' ? 'auto' : 0,
        top: up ? 'auto' : '100%',
        bottom: up ? '100%' : 'auto',
        maxWidth,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, menu, prefer]);

  return open ? style : {};
}
