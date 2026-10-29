import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from './i18n/useT';
import { clampPanelWidth, PANEL_MAX, PANEL_MIN, panelWidthAfterKey } from './state/panelLayout';

interface Props {
  /** The review panel's width in CSS px. */
  width: number;
  onResize(width: number): void;
}

const directionOf = (el: Element) => (el.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');

/**
 * The divider between the document and the review panel (F23 item 3): a WAI-ARIA window splitter. Its value is the
 * panel's width; the mouse drags it, the arrow keys move it 16 px, Home and End jump to the narrowest and widest.
 */
export function PanelDivider({ width, onResize }: Props) {
  const t = useT();
  const dragging = useRef(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = panelWidthAfterKey(e.key, width, directionOf(e.currentTarget));
    if (next === null) return;
    e.preventDefault();
    onResize(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const workspace = e.currentTarget.parentElement!.getBoundingClientRect();
    // The panel runs from the pointer to the workspace's inline end.
    const panel = directionOf(e.currentTarget) === 'ltr' ? workspace.right - e.clientX : e.clientX - workspace.left;
    onResize(clampPanelWidth(panel));
  };

  return (
    <div
      className="panel-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={t.t('split.resize')}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    />
  );
}
